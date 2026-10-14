import http from "node:http";
import { ensurePathSummaries, neededSummaryIndex, parseSummaryReply, summarizeChapter, summaryWords } from "../../src/lib/ai/summaries.ts";
import { buildStorySoFar, summaryCoverageIndex } from "../../src/lib/ai/prompts.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settings.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- fake model ----
const prompts: { system: string; user: string; model: string }[] = [];
let reply = (user: string) => JSON.stringify({ summary: `SUM(${/Chapter: "([^"]*)"/.exec(user)?.[1]})`, story_so_far: `SOFAR(${/Chapter: "([^"]*)"/.exec(user)?.[1]})` });
const server = http.createServer((req, res) => {
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data);
    const user = body.messages.at(-1).content;
    prompts.push({ system: body.messages[0].content, user, model: body.model });
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply(user) } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as { port: number }).port}/v1`;
const settings = { ...DEFAULT_SETTINGS, activeProvider: "custom" as const, providers: { ...DEFAULT_SETTINGS.providers, custom: { baseUrl: base, apiKey: "", model: "main", summaryModel: "cheap" } } };

// Relative URLs (the app's own API) can't be fetched from Node, so intercept them.
const saved: { url: string; body: Record<string, unknown> }[] = [];
let saveStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/api/")) {
    saved.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ error: "nope" }), { status: saveStatus });
  }
  return realFetch(input, init);
}) as typeof fetch;

const story = { title: "Tale", premise: "A thief." };
const ch = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `id${n}`, revision: 1, title: `C${n}`, body: `body ${n}. `.repeat(20), summary: null as string | null, path_summary: null as string | null, ...extra,
});

// ---- summarizeChapter ----
let s = await summarizeChapter(settings, { story, previous: null, chapter: { title: "C1", body: "Mira ran." } });
ok(s.summary === "SUM(C1)" && s.path_summary === "SOFAR(C1)", "parses summary + story_so_far");
ok(prompts.at(-1)!.model === "cheap", "uses the cheaper model");
ok(prompts.at(-1)!.user.includes("first chapter") && prompts.at(-1)!.user.includes("Premise: A thief."), "first chapter prompt");
s = await summarizeChapter(settings, { story, previous: "Earlier things.", chapter: { title: "C2", body: "More." } });
ok(prompts.at(-1)!.user.includes("Summary of the story before this chapter:\nEarlier things."), "previous summary is passed along");
const old = reply;
reply = () => JSON.stringify({ summary: "only one field" });
try { await summarizeChapter(settings, { story, previous: null, chapter: { title: "x", body: "y" } }); ok(false, "should throw"); } catch (e) { ok(/incomplete/.test((e as Error).message), "incomplete reply rejected"); }
reply = () => "I refuse";
try { await summarizeChapter(settings, { story, previous: null, chapter: { title: "x", body: "y" } }); ok(false, "should throw"); } catch (e) { ok(/anything|JSON/.test((e as Error).message), "non-JSON reply rejected"); }
reply = () => JSON.stringify({ summary: "s".repeat(9000), story_so_far: "t".repeat(9000) });
s = await summarizeChapter(settings, { story, previous: null, chapter: { title: "x", body: "y" } });
ok(s.summary.length === 5000 && s.path_summary.length === 5000, "over-long summaries are clipped to the server limit");
reply = old;
// labelled format, tolerant of markdown, and retry on a bad first reply
const lab = parseSummaryReply(["**SUMMARY:**", "Mira ran.", "", "**STORY SO FAR:**", "Mira fled the city."].join("\n"));
ok(lab.summary === "Mira ran." && lab.path_summary === "Mira fled the city.", "parses the labelled format");
const keep = reply; let n = 0;
reply = () => (++n === 1 ? "Sorry, I can't." : ["SUMMARY:", "A.", "STORY SO FAR:", "B."].join("\n"));
s = await summarizeChapter(settings, { story, previous: null, chapter: { title: "x", body: "y" } });
ok(n === 2 && s.summary === "A." && s.path_summary === "B.", "a bad first reply is retried once");
reply = keep;

// the author's own summary is kept; only the story-so-far comes from the model
s = await summarizeChapter(settings, { story, previous: null, chapter: { title: "C1", body: "Mira ran." }, summary: "  Mine.  " });
ok(s.summary === "Mine." && s.path_summary === "SOFAR(C1)" && prompts.at(-1)!.user.includes("Use it unchanged as the SUMMARY:\nMine."), "an author's summary is used as written");
ok(prompts.at(-2)!.user.includes("Make the SUMMARY about 40 words"), "a generated summary is asked for at a set length");
ok(summaryWords("w ".repeat(100)) === 40 && summaryWords("w ".repeat(600)) === 80 && summaryWords("w ".repeat(5000)) === 150, "summary length scales with the chapter, within limits");

const huge = "A".repeat(5000) + "MIDDLE" + "Z".repeat(200000);
await summarizeChapter({ ...settings, contextTokens: 2000 }, { story, previous: null, chapter: { title: "big", body: huge } });
ok(prompts.at(-1)!.user.length < 20000 && prompts.at(-1)!.user.includes("[…]") && !prompts.at(-1)!.user.includes("MIDDLE"), "huge chapters are trimmed (start and end kept)");

// ---- ensurePathSummaries ----
const path = [ch(1), ch(2), ch(3), ch(4), ch(5)];
prompts.length = 0; saved.length = 0;
let made = await ensurePathSummaries(settings, path, 3, { story });
ok(Object.keys(made).join() === "id1,id2,id3,id4" && prompts.length === 4, "walks from the start when nothing is summarized: 4 calls");
ok(prompts[1].user.includes("SOFAR(C1)") && prompts[3].user.includes("SOFAR(C3)"), "each step builds on the previous one");
ok(saved.length === 4 && saved[0].url === "/api/chapters/id1/summary" && saved[0].body.revision === 1 && saved[0].body.path_summary === "SOFAR(C1)", "each result is saved to the server");

const partly = [ch(1, { path_summary: "KNOWN1" }), ch(2, { path_summary: "KNOWN2" }), ch(3), ch(4), ch(5)];
prompts.length = 0;
made = await ensurePathSummaries(settings, partly, 3, { story });
ok(prompts.length === 2 && Object.keys(made).join() === "id3,id4" && prompts[0].user.includes("KNOWN2"), "starts after the nearest summarized chapter");
prompts.length = 0;
made = await ensurePathSummaries(settings, partly, 1, { story });
ok(prompts.length === 0 && Object.keys(made).length === 0, "nothing to do when the target already has one");
ok(Object.keys(await ensurePathSummaries(settings, partly, -1, { story })).length === 0, "negative index is a no-op");

saveStatus = 409; prompts.length = 0;
made = await ensurePathSummaries(settings, [ch(1), ch(2)], 1, { story });
ok(Object.keys(made).length === 2, "a failed save doesn't lose the summaries (409 ignored)");
saveStatus = 200;

const prog: string[] = [];
await ensurePathSummaries(settings, [ch(1), ch(2), ch(3)], 2, { story, onProgress: (d, t) => prog.push(`${d}/${t}`) });
ok(prog.join() === "0/3,1/3,2/3,3/3", "progress reported: " + prog.join());
const ctl = new AbortController(); ctl.abort();
try { await ensurePathSummaries(settings, [ch(1), ch(2)], 1, { story, signal: ctl.signal }); ok(false, "should abort"); } catch (e) { ok((e as { name: string }).name === "AbortError", "aborts"); }
reply = () => "garbage";
try { await ensurePathSummaries(settings, [ch(1)], 0, { story }); ok(false, "should throw"); } catch { ok(true, "a failed summary stops the walk with an error"); }
reply = old;

// ---- coverage index drives when summaries are needed ----
const long = Array.from({ length: 12 }, (_, i) => ch(i + 1, { body: "word ".repeat(400) }));
const idx = summaryCoverageIndex(long, 4000);
ok(idx > 0 && idx < 11, `long story under a small budget needs a summary at index ${idx}`);
ok(summaryCoverageIndex(long, 200000) === -1, "a huge budget needs none");
ok(summaryCoverageIndex([], 4000) === -1, "empty path needs none");
ok(neededSummaryIndex(long, 4000) === idx, "needed index reported when missing");
const withSummary = long.map((c, i) => (i === idx ? { ...c, path_summary: "HAVE IT" } : c));
ok(neededSummaryIndex(withSummary, 4000) === -1, "…and not once it exists");
// a roomier prompt than the tightest one still gets the stored summary
const roomy = buildStorySoFar(withSummary, 9000);
ok(roomy.includes("Most recent chapters") && (roomy.includes("HAVE IT") || !roomy.includes("Earlier in the story")), "stored summary is used (or the window already covers everything)");
const used = buildStorySoFar(withSummary, Math.floor((4000 - 1500) * 0.5 * 0.75));
ok(used.includes("Earlier in the story:\nHAVE IT"), "the tightest prompt uses the stored summary instead of excerpts");
ok(!buildStorySoFar(long, Math.floor((4000 - 1500) * 0.5 * 0.75)).includes("HAVE IT") && buildStorySoFar(long, 1900).includes("- C1:"), "without one it falls back to excerpts");

globalThis.fetch = realFetch;
server.close();
