// The prompt history: the table (trimming, cutting, the never-migrated drop-and-recreate) and the recorder in the chat client.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytime-ailog-"));
process.env.STORYTIME_DB = path.join(dir, "log.db");
const { db } = await import("../../src/lib/db.ts");
const log = await import("../../src/lib/aiLog.ts");
const { streamChat, completeChat, setChatRecorder } = await import("../../src/lib/ai/client.ts");
const { DEFAULT_SETTINGS } = await import("../../src/lib/settingsSchema.ts");

const d = db();
const T = log.AI_LOG_TABLE;
const count = () => (d.prepare(`SELECT COUNT(*) AS n FROM ${T}`).get() as { n: number }).n;
const row = (over: Partial<Parameters<typeof log.recordAiCall>[1]> = {}) => ({
  at: Date.now(), ms: 5, side: "server" as const, source: "Test", messages: [{ role: "user", content: "hi" }], status: "ok" as const, ...over,
});

// ---- the table ----
ok(count() === 0, "the table is made when the database opens");
const id = log.recordAiCall(d, row({ source: undefined, reply: "r", system: "s", thinkingOff: true, temperature: 0.5, model: "m", connection: "C", role: "cheap" }));
const one = log.getAiCall(d, id)!;
ok(one.source === "Other" && one.reply === "r" && one.system === "s" && one.thinking_off === true && one.temperature === 0.5 && one.role === "cheap" && one.messages[0].content === "hi", "a row with no label is 'Other'; the full row reads back");
ok(log.getAiCall(d, "nope") === null, "an unknown id is null");

// cutting
const big = "x".repeat(log.AI_LOG_FIELD_LIMIT + 1234);
const cutId = log.recordAiCall(d, row({ system: big, reply: big, error: big, messages: [{ role: "user", content: big }] }));
const cut = log.getAiCall(d, cutId)!;
const marker = "…[cut: 1234 more characters]";
ok(cut.system!.length === log.AI_LOG_FIELD_LIMIT + marker.length && cut.system!.endsWith(marker), "system is cut with a marker");
ok(cut.reply!.endsWith(marker) && cut.error!.endsWith(marker) && cut.messages[0].content.endsWith(marker), "reply, error and messages are cut too");
ok(log.cutText("short") === "short", "short text is left alone");

// trimming to 200 rows
d.exec(`DELETE FROM ${T}`);
const base = Date.now() - 100_000;
for (let i = 0; i < 205; i++) log.recordAiCall(d, row({ at: base + i, source: `S${i}` }));
ok(count() === 200, "only the newest 200 rows stay: " + count());
const sources = log.listAiSources(d);
ok(!sources.includes("S0") && !sources.includes("S4") && sources.includes("S5") && sources.includes("S204"), "…and the oldest went");
const listed = log.listAiCalls(d, { limit: 3 });
ok(listed.length === 3 && listed[0].source === "S204" && listed[2].source === "S202" && !("reply" in listed[0]), "the list is newest first, with a limit, without the texts");

// trimming to 3 days
d.exec(`DELETE FROM ${T}`);
const raw = (at: number, source: string) =>
  d.prepare(`INSERT INTO ${T} (id, at, ms, side, source, messages, status) VALUES (?, ?, 1, 'server', ?, '[]', 'ok')`).run(`raw-${source}`, at, source);
raw(Date.now() - 4 * 86_400_000, "old");
raw(Date.now() - 2 * 86_400_000, "recent");
ok(count() === 2, "two raw rows");
log.recordAiCall(d, row({ source: "new" }));
ok(JSON.stringify(log.listAiSources(d)) === JSON.stringify(["new", "recent"]), "a row older than 3 days goes on the next insert: " + log.listAiSources(d));

// filters
d.exec(`DELETE FROM ${T}`);
d.prepare(`INSERT INTO stories (id, title, root_chapter_id, created_at) VALUES ('st1', 'Fox Tale', 'rc', 1)`).run();
log.recordAiCall(d, row({ source: "Tags", storyId: "st1", chapterId: "ch1", runId: "r1" }));
log.recordAiCall(d, row({ source: "Summary", storyId: "st1", chapterId: "ch2", status: "failed", error: "boom" }));
log.recordAiCall(d, row({ source: "Tags", storyId: "gone-story" }));
ok(log.listAiCalls(d, { source: "Tags" }).length === 2, "filter by source");
ok(log.listAiCalls(d, { storyId: "st1" }).length === 2 && log.listAiCalls(d, { chapterId: "ch2" }).length === 1 && log.listAiCalls(d, { runId: "r1" }).length === 1, "filter by story, chapter, run");
ok(log.listAiCalls(d, { failedOnly: true }).length === 1 && log.listAiCalls(d, { failedOnly: true })[0].error === "boom", "failed only");
ok(log.listAiCalls(d, { storyId: "st1" })[0].story_title === "Fox Tale", "the story's title is joined");
ok(log.listAiCalls(d, { storyId: "gone-story" })[0].story_title === null, "a deleted story still lists, with no title");

// never migrated: another version's table is dropped, the current one kept
d.exec(`CREATE TABLE ai_calls_v0 (x INTEGER); CREATE TABLE ai_calls_v9 (y INTEGER); CREATE TABLE ai_calls_other_thing (z INTEGER)`);
const before = count();
log.ensureAiLog(d);
const names = (d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai%'`).all() as { name: string }[]).map((r) => r.name);
ok(!names.includes("ai_calls_v0") && !names.includes("ai_calls_v9") && names.includes(T), "other ai_calls_v* tables are dropped, the current one kept");
ok(names.includes("ai_calls_other_thing"), "a table that is not a version is left alone");
ok(count() === before, "the current table's rows survive");
const fresh = new Database(path.join(dir, "fresh.db"));
fresh.exec(`CREATE TABLE ai_calls_v1_old (a INTEGER)`);
log.ensureAiLog(fresh);
ok(fresh.prepare(`SELECT name FROM sqlite_master WHERE name = 'ai_calls_v1_old'`).get() === undefined, "ai_calls_v1_old is another version, so it goes");
fresh.close();

// ---- the recorder in the chat client ----
let mode = "ok";
const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (mode === "fail") { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: "model fell over" } })); }
    res.setHeader("content-type", "text/event-stream");
    res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
    setTimeout(() => { res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'); res.end("data: [DONE]\n\n"); }, 20);
  });
});
await new Promise<void>((r) => server.listen(0, r));
const base2 = `http://localhost:${(server.address() as any).port}`;
const settings = {
  ...DEFAULT_SETTINGS,
  temperature: 0.3,
  connections: [{ id: "c1", name: "My model", kind: "custom", baseUrl: base2, apiKey: "SECRET-KEY-123", freeComfy: false, freeForPictures: false }],
  defaults: { main: { connectionId: "c1", model: "m1" }, cheap: { connectionId: "c1", model: "m1" } },
} as any;
const seen: any[] = [];
setChatRecorder((r) => { seen.push(r); });
const msgs = [{ role: "user" as const, content: "hello" }];

let reply = await completeChat(settings, { system: "sys", messages: msgs, role: "cheap", source: { label: "Unit", chapterId: "c9" } });
const okRec = seen.at(-1);
ok(reply === "Hello" && seen.length === 1, "a call is recorded once");
ok(okRec.status === "ok" && okRec.reply === "Hello" && okRec.model === "m1" && okRec.connection === "My model" && okRec.role === "cheap" && okRec.system === "sys" && okRec.temperature === 0.3 && okRec.thinkingOff === false, "…with the request and the reply");
ok(okRec.source.label === "Unit" && okRec.source.chapterId === "c9" && okRec.ms >= 15 && okRec.at > 0, "…its source and its time");
ok(!JSON.stringify(okRec).includes("SECRET-KEY-123"), "…and never the key");

mode = "fail";
try { await completeChat(settings, { messages: msgs }); ok(false, "should throw"); } catch (e) { ok(/model fell over/.test((e as Error).message), "a failed call still throws"); }
ok(seen.at(-1).status === "failed" && /model fell over/.test(seen.at(-1).error) && seen.length === 2, "…and is recorded as failed with the message");

try { await completeChat({ ...DEFAULT_SETTINGS } as any, { messages: msgs }); } catch { /* expected */ }
ok(seen.at(-1).status === "failed" && /No model is chosen/.test(seen.at(-1).error) && seen.at(-1).connection === null, "'no model chosen' is recorded as failed");

mode = "ok";
const ctl = new AbortController();
try {
  for await (const _ of streamChat(settings, { messages: msgs, signal: ctl.signal })) ctl.abort();
} catch { /* an abort */ }
ok(seen.at(-1).status === "stopped" && seen.length === 4, "an aborted call is recorded as stopped");
for await (const piece of streamChat(settings, { messages: msgs })) { void piece; break; }
ok(seen.at(-1).status === "stopped" && seen.at(-1).reply === "Hel" && seen.length === 5, "a consumer that stops reading early is recorded as stopped, with the text so far");

// a recorder that throws, now or later, changes nothing
setChatRecorder(() => { throw new Error("recorder broke"); });
reply = await completeChat(settings, { messages: msgs });
ok(reply === "Hello", "a recorder that throws does not break the call");
setChatRecorder(() => Promise.reject(new Error("async recorder broke")));
reply = await completeChat(settings, { messages: msgs });
await new Promise((r) => setTimeout(r, 20));
ok(reply === "Hello", "a recorder whose promise rejects does not break the call (or crash the process)");
mode = "fail";
setChatRecorder(() => { throw new Error("recorder broke"); });
try { await completeChat(settings, { messages: msgs }); } catch (e) { ok(/model fell over/.test((e as Error).message), "a throwing recorder does not hide the call's own error"); }

// ---- kept requests (calls that wrote chapter text, kept for good) ----
const kept = await import("../../src/lib/keptRequests.ts");
log.installAiRecorder(d);
mode = "ok";
const keptCount = () => (d.prepare(`SELECT COUNT(*) AS n FROM ai_requests`).get() as { n: number }).n;
await completeChat(settings, { messages: msgs });
ok(keptCount() === 0, "a call without onKeep is not kept");
let keptId = "";
reply = await completeChat(settings, { system: "sys", messages: msgs, job: "write", maxTokens: 99, source: { label: "Generate", storyId: "s1" }, onKeep: (i) => (keptId = i) });
const [k] = kept.getKeptRequests(d, [keptId, "missing"]);
ok(/^[0-9a-f-]{36}$/.test(keptId) && keptCount() === 1 && !!k, "a call with onKeep is told its id and kept; unknown ids are left out");
ok(k.connectionId === "c1" && k.connection === "My model" && k.kind === "custom" && k.baseUrl === base2 && k.model === "m1" && k.role === null && k.job === "write", "…with the connection and model");
ok(k.temperature === 0.3 && k.thinkingOff === false && k.maxTokens === 99 && k.system === "sys" && k.messages[0].content === "hello" && k.reply === "Hello", "…the settings, the prompt and the reply");
ok(k.ms >= 15 && k.firstTextMs !== null && k.firstTextMs <= k.ms && k.source === "Generate" && k.storyId === "s1" && k.status === "ok", "…how long it took and until the first text, and where it came from");
ok(!d.prepare(`SELECT data FROM ai_requests`).all().some((r: any) => r.data.includes("SECRET-KEY-123")), "…and never the key");

// Pruning: old ones no draft or chapter writing mentions go; mentioned or recent ones stay.
const old = Date.now() - (kept.KEPT_UNREFERENCED_DAYS + 1) * 24 * 60 * 60 * 1000;
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
for (const i of ids) d.prepare(`INSERT INTO ai_requests (id, at, data) VALUES (?, ?, '{}')`).run(i, old);
d.prepare(`INSERT INTO drafts (key, data, updated_at) VALUES ('k1', ?, 1)`).run(JSON.stringify({ ai: [ids[0]] }));
d.prepare(`INSERT INTO stories (id, title, created_at) VALUES ('st', 't', 1)`).run();
d.prepare(`INSERT INTO chapters (id, story_id, depth, title, body, posted_at) VALUES ('ch', 'st', 0, 't', 'b', 1)`).run();
d.prepare(`INSERT INTO chapter_writing (chapter_id, data, updated_at) VALUES ('ch', ?, 1)`).run(JSON.stringify({ versions: [{ ai: [ids[1]] }] }));
ok(kept.pruneKeptRequests(d, true) === 1 && kept.getKeptRequests(d, [...ids, keptId]).length === 3, "pruning removes only old, unmentioned kept requests");

setChatRecorder(undefined);
server.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(process.exitCode ?? 0);
