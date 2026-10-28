import http from "node:http";
import { draftEntry, extractJson, parseFields } from "../../src/lib/ai/codexAi.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- mock model: replies depend on what the prompt contains ----
const prompts: { system: string; user: string; model: string }[] = [];
let handler: (user: string) => string = () => '{"changes":[]}';
const server = http.createServer((req, res) => {
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data);
    const user = body.messages.at(-1).content;
    prompts.push({ system: body.messages[0].content, user, model: body.model });
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: handler(user) } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as any).port}/v1`;
const settings: any = { ...DEFAULT_SETTINGS, connections: [{ id: "t", name: "Test", kind: "custom" as const, baseUrl: base, apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } };

// ---- parsing ----
ok((extractJson('Sure!\n```json\n{"a":1}\n```\nHope it helps') as any).a === 1, "extractJson: fenced + chatter");
try { extractJson("no json here"); ok(false, "should throw"); } catch (e) { ok(/couldn't read|anything/.test((e as Error).message), "extractJson: no json -> friendly error"); }
try { extractJson("{broken"); ok(false, "should throw"); } catch (e) { ok(/valid JSON|anything/.test((e as Error).message), "extractJson: bad json -> friendly error"); }
ok(parseFields({ name: " Mira ", type: "Character", aliases: ["a", 5, ""], content: "x", always_include: "yes" })?.type === "character", "parseFields: normalises type");
ok(parseFields({ name: "X", type: "dragon" })?.type === "note", "parseFields: unknown type -> note");
ok(parseFields({ type: "place" }) === null && parseFields("x") === null, "parseFields: needs a name");
ok(parseFields({ name: "X", always_include: "yes" })!.always_include === false, "parseFields: always_include must be boolean true");

const ch = (id: string, depth: number, title: string, body: string) => ({ id, depth, title, body, summary: null, path_summary: null });
const story = { title: "Tale", premise: "A thief." };
const path = [ch("c1", 0, "Root", "Mira stood."), ch("c2", 1, "Two", "Mira became a horse.")];

// ---- draftEntry ----
handler = () => '```json\n{"name":"Old Tam","type":"character","aliases":["the ferryman"],"content":"A grizzled ferryman.","always_include":false}\n```';
let r = await draftEntry(settings, { story, path, codex: [], direction: "a grizzled ferryman", existing: null, mode: "draft" });
ok(r.fields.name === "Old Tam" && r.fields.aliases[0] === "the ferryman" && r.changedInChapterId === null, "draft new entry");
ok(prompts.at(-1)!.user.includes("Create a new codex entry for: a grizzled ferryman"), "draft prompt carries the request");
try { await draftEntry(settings, { story, path, codex: [], direction: " ", existing: null, mode: "draft" }); ok(false, "needs direction"); } catch (e) { ok(/Describe what you want/.test((e as Error).message), "draft needs a description"); }
const mira = { name: "Mira", type: "character" as const, aliases: [], content: "A human thief.", always_include: false };
try { await draftEntry(settings, { story, path, codex: [], direction: "", existing: mira, mode: "draft" }); ok(false, "needs direction"); } catch (e) { ok(/what to change/.test((e as Error).message), "rewrite needs an instruction"); }
handler = () => '{"name":"Mira","type":"character","aliases":[],"content":"A horse, guarded.","always_include":false}';
r = await draftEntry(settings, { story, path, codex: [], direction: "make her guarded", existing: mira, mode: "draft" });
ok(r.fields.content === "A horse, guarded." && prompts.at(-1)!.user.includes("Rewrite the entry according to this instruction: make her guarded") && prompts.at(-1)!.user.includes('"A human thief."'), "rewrite includes the current entry");
handler = () => '{"name":"Mira","type":"character","aliases":[],"content":"A horse.","always_include":false,"changed_in":2}';
const since = [ch("c1", 0, "Root", "Mira stood."), ch("c2", 1, "Two", "Mira became a horse.")];
r = await draftEntry(settings, { story, path, codex: [], direction: "", existing: mira, mode: "update", since });
ok(r.changedInChapterId === "c2", "update maps changed_in back to a chapter id");
ok(prompts.at(-1)!.user.includes('Chapter 2: "Two"') && prompts.at(-1)!.user.includes("Mira became a horse."), "update prompt numbers the chapters");
handler = () => '{"name":"Mira","type":"character","content":"x","changed_in":9}';
ok((await draftEntry(settings, { story, path, codex: [], direction: "", existing: mira, mode: "update", since })).changedInChapterId === null, "update: out-of-range changed_in ignored");
// ---- [bracketed notes] in an entry request ----
handler = () => '{"name":"Old Tam","type":"character","content":"x"}';
await draftEntry(settings, { story, path, codex: [], direction: "a ferryman [he is secretly blind]", existing: null, mode: "draft" });
let dp = prompts.at(-1)!.user;
ok(dp.includes("Create a new codex entry for: a ferryman") && !dp.includes("[he is") && dp.includes("- he is secretly blind"), "entry request: bracketed text becomes additional instructions");
await draftEntry(settings, { story, path, codex: [], direction: "[a ferryman]", existing: null, mode: "draft" });
ok(prompts.at(-1)!.user.includes("Create a new codex entry for: a ferryman"), "entry request: notes alone are the request");

// ---- the entry-writing prompt carries the quality guide ----
const sysDraft = prompts.at(-1)!.system;
ok(sysDraft.includes("What makes a good entry") && sysDraft.includes("Aliases:") && sysDraft.includes("always_include: almost always false"), "draft system prompt includes the codex guide");
ok(sysDraft.includes("Reply with JSON only:"), "guide doesn't displace the JSON reply instructions");
server.close();
