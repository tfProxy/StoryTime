// The "view prompt" windows show the same request the buttons send: each preview is compared with
// what a mock model actually receives.
import http from "node:http";
import { draftEntry, entryRequest, analyzePath, scanRequest } from "../../src/lib/ai/codexAi.ts";
import { summarizeChapter, summaryRequest } from "../../src/lib/ai/summaries.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const sent: { system: string; user: string }[] = [];
let reply = "";
const server = http.createServer((req, res) => {
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data);
    sent.push({ system: body.messages[0].content, user: body.messages.at(-1).content });
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as any).port}/v1`;
const settings: any = { ...DEFAULT_SETTINGS, activeProvider: "custom", providers: { ...DEFAULT_SETTINGS.providers, custom: { baseUrl: base, apiKey: "", model: "main", summaryModel: "cheap" } } };
const tokens = settings.contextTokens;

const ch = (id: string, depth: number, title: string, body: string) => ({ id, depth, title, body, summary: null, path_summary: null });
const story = { title: "Tale", premise: "A thief." };
const path = [ch("c1", 0, "Root", "Mira stood."), ch("c2", 1, "Two", "Mira became a horse.")];

// ---- summary ----
reply = "SUMMARY:\nA.\nSTORY SO FAR:\nB.";
const sOpts = { story, previous: "Before.", chapter: { title: "Two", body: "Mira became a horse." } };
await summarizeChapter(settings, sOpts);
const sr = summaryRequest(tokens, sOpts);
ok(sent.at(-1)!.system === sr.system && sent.at(-1)!.user === sr.message, "summary preview is what summarizing sends");
ok(sr.message.includes("Before.") && sr.message.includes("Mira became a horse."), "…and holds the previous summary and the chapter");

// ---- codex scan ----
reply = '{"changes":[]}';
await analyzePath(settings, { story, path, ops: [], scope: "chapter" });
const scan = scanRequest(tokens, { story, path, ops: [], scope: "chapter" });
ok(sent.at(-1)!.system === scan.system && sent.at(-1)!.user === scan.message, "scan preview (this chapter) is what scanning sends");
ok(scan.message.includes("Mira became a horse.") && !scan.message.includes('Chapter to read: "Root"'), "…and reads the last chapter");
sent.length = 0;
await analyzePath(settings, { story, path, ops: [], scope: "path" });
const first = scanRequest(tokens, { story, path, ops: [], scope: "path" });
ok(sent[0].user === first.message && first.message.includes('Chapter to read: "Root"'), "scan preview (every chapter) is the first request of the scan");

// ---- codex entry ----
reply = '{"name":"Old Tam","type":"character","aliases":[],"content":"A ferryman.","always_include":false}';
const eOpts = { story, path, codex: [], direction: "a grizzled ferryman [gruff]", existing: null, mode: "draft" as const, since: [] };
await draftEntry(settings, eOpts);
const er = entryRequest(tokens, eOpts);
ok(sent.at(-1)!.system === er.system && sent.at(-1)!.user === er.message, "entry preview is what drafting sends");
ok(er.message.includes("Create a new codex entry for: a grizzled ferryman") && er.message.includes("- gruff"), "…with the bracketed note as an instruction");
let threw = "";
try { entryRequest(tokens, { ...eOpts, direction: "" }); } catch (e) { threw = (e as Error).message; }
ok(/Describe what you want/.test(threw), "an entry preview with nothing asked explains what is missing");

server.close();
