import http from "node:http";
import { analyzePath, applyProposals, draftEntry, extractJson, parseFields } from "../../src/lib/ai/codexAi.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settings.ts";
import type { CodexOp } from "../../src/lib/codex.ts";

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
const settings: any = { ...DEFAULT_SETTINGS, activeProvider: "custom", providers: { ...DEFAULT_SETTINGS.providers, custom: { baseUrl: base, apiKey: "", model: "main", summaryModel: "cheap" } } };

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

// ---- single chapter scan, with an existing codex ----
const existingOp: CodexOp = { id: "o1", anchor_chapter_id: "c1", anchor_depth: 0, entry_id: "E-MIRA", op: "create", name: "Mira", type: "character", aliases: ["the thief"], content: "A human thief.", always_include: false, author_name: "", posted_at: 1 };
handler = () => JSON.stringify({ changes: [
  { action: "create", name: "Bram", type: "character", aliases: ["smith"], content: "A smith.", reason: "new" },
  { action: "replace", entry: "the thief", name: "Mira", type: "character", aliases: ["the thief"], content: "Now a horse.", reason: "transformed" },
  { action: "create", name: "mira", type: "character", content: "dup of Mira", reason: "should become a replace" },
  { action: "retire", entry: "Nobody", reason: "unknown, dropped" },
  { action: "explode", name: "X" },
  { action: "create", type: "place", content: "no name" },
  { action: "replace", entry: "Mira", name: "Mira", type: "character", aliases: ["the thief"], content: "A human thief.", reason: "unchanged -> dropped" },
] });
const path = [ch("c1", 0, "Root", "Mira stood."), ch("c2", 1, "Two", "Mira became a horse.")];
let progress: string[] = [];
let ps = await analyzePath(settings, { story, path, ops: [existingOp], scope: "chapter", onProgress: (d, t) => progress.push(`${d}/${t}`) });
ok(ps.length === 3, "chapter scan keeps 3 valid proposals: " + ps.map((p) => p.action + ":" + p.name).join());
ok(ps[0].action === "create" && ps[0].isNew && ps[0].ref.startsWith("new-") && ps[0].anchorChapterId === "c2", "create is anchored at the scanned chapter");
ok(ps[1].action === "replace" && ps[1].ref === "E-MIRA" && !ps[1].isNew && ps[1].previous?.content === "A human thief.", "replace resolves alias to the existing entry, keeps 'before'");
ok(ps[2].action === "replace" && ps[2].ref === "E-MIRA", "a create of an existing name becomes a replace");
ok(progress[0] === "0/1" && progress.at(-1) === "1/1", "progress reported");
const p0 = prompts.at(-1)!;
ok(p0.user.includes("Mira [character] (also: the thief): A human thief.") && p0.user.includes("Mira became a horse.") && p0.user.includes("Earlier in the story") || p0.user.includes("Root"), "prompt carries codex, chapter, and earlier story");
ok(p0.model === "main", "single-chapter scan uses the main model");

// ---- whole path: later chapters see earlier proposals; apply handles dependencies ----
let call = 0;
handler = (user) => {
  call++;
  if (user.includes('Chapter to read: "One"')) return JSON.stringify({ changes: [{ action: "create", name: "Mira", type: "character", content: "A thief.", reason: "intro" }] });
  if (user.includes('Chapter to read: "Two"')) {
    // the proposal from chapter One must be visible as codex state
    const sees = user.includes("Mira [character]: A thief.");
    return JSON.stringify({ changes: [{ action: "replace", entry: "Mira", name: "Mira", type: "character", content: sees ? "A horse." : "SAW NOTHING", reason: "transformed" }] });
  }
  return JSON.stringify({ changes: [{ action: "retire", entry: "Mira", reason: "gone" }] });
};
prompts.length = 0;
const p3 = [ch("a", 0, "One", "x"), ch("b", 1, "Two", "y"), ch("c", 2, "Three", "z")];
ps = await analyzePath(settings, { story, path: p3, ops: [], scope: "path" });
ok(ps.map((p) => p.action).join() === "create,replace,retire", "path scan: create, replace, retire in order");
ok(ps[1].content === "A horse." && ps[1].ref === ps[0].ref && ps[1].isNew, "chapter Two saw the proposed Mira and referred to it");
ok(ps[2].ref === ps[0].ref, "retire refers to the same entry");
ok(ps.map((p) => p.anchorChapterId).join() === "a,b,c", "each proposal anchored at its own chapter");
ok(prompts.length === 3 && prompts.every((p) => p.model === "cheap"), "path scan: one call per chapter, cheaper model");

// apply: everything accepted
const sent: any[] = [];
const sender = async (b: any) => { sent.push(b); return b.op === "create" ? `REAL-${sent.length}` : b.entry_id; };
let n = await applyProposals(ps, sender);
ok(n === 3 && sent[0].op === "create" && sent[1].op === "replace" && sent[1].entry_id === "REAL-1" && sent[2].op === "retire" && sent[2].entry_id === "REAL-1", "apply: later ops use the real id of the created entry");
ok(sent[0].anchor_chapter_id === "a" && sent[1].anchor_chapter_id === "b" && sent[2].anchor_chapter_id === "c", "apply: anchors preserved");
// create rejected, replace accepted -> becomes a create; retire alone -> skipped
sent.length = 0; n = await applyProposals([ps[1]], sender);
ok(n === 1 && sent[0].op === "create" && sent[0].name === "Mira", "apply: replace whose create was rejected becomes a create");
sent.length = 0; n = await applyProposals([ps[2]], sender);
ok(n === 0 && sent.length === 0, "apply: retire of a never-created entry is skipped");
sent.length = 0; n = await applyProposals([ps[1], ps[2]], sender);
ok(n === 2 && sent[0].op === "create" && sent[1].op === "retire" && sent[1].entry_id === "REAL-1", "apply: created-by-replace entry can then be retired");
// failure part-way reports how far it got
let k = 0;
try { await applyProposals(ps, async (b) => { if (++k === 2) throw new Error("boom"); return "R"; }); ok(false, "should throw"); } catch (e) { ok((e as Error).message === "boom", "apply: errors propagate"); }

// ---- bad model output ----
handler = () => "I could not find anything";
try { await analyzePath(settings, { story, path, ops: [], scope: "chapter" }); ok(false, "should throw"); } catch (e) { ok(/anything/.test((e as Error).message), "scan: unreadable reply -> friendly error"); }
handler = () => '{"changes": "nope"}';
ok((await analyzePath(settings, { story, path, ops: [], scope: "chapter" })).length === 0, "scan: malformed changes -> none");
// abort
const ctl = new AbortController(); ctl.abort();
try { await analyzePath(settings, { story, path: p3, ops: [], scope: "path", signal: ctl.signal }); ok(false, "should abort"); } catch (e) { ok((e as any).name === "AbortError", "scan: aborts"); }

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
server.close();
