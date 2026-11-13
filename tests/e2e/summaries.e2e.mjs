// Chapter summaries for chapters written on the writing desk: written by the server after Post (on the cheaper
// model, building on the parent's story-so-far), repaired for a long story before a Generate (`?ai=1`, from the old
// Write page's address too), the author's own summary kept as written, and a failed story-so-far not blocking Post.
import http from "node:http";
import { launch, startStory, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const calls = [];
let summaryMode = "ok"; // "ok" | "bad"
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  // Which models Ollama has loaded (asked before a summary or suggestions): none.
  if (req.url?.endsWith("/api/ps")) { res.setHeader("content-type", "application/json"); return res.end('{"models":[]}'); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content, user = body.messages.at(-1).content;
    const isSummary = system.includes("running summary");
    calls.push({ system, user, model: body.model, isSummary });
    let text;
    if (isSummary) {
      const title = /Chapter: "([^"]*)"/.exec(user)?.[1];
      text = summaryMode === "ok" ? JSON.stringify({ summary: `SUM(${title})`, story_so_far: `SOFAR(${title})` }) : "I'd rather not.";
    } else if (system.includes("button text and nothing else")) {
      text = "Onward";
    } else {
      text = "# Generated\n\nGenerated text here.";
    }
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const chapter = async (id) => (await (await fetch(`${BASE}/api/chapters/${id}`)).json());
const idFromUrl = (u) => /\/c\/([^/?]+)/.exec(u)[1];
const until = async (fn, ms = 15000) => { const stop = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > stop) return null; await new Promise((r) => setTimeout(r, 100)); } };

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const ai = await useMockAi(BASE, { contextTokens: 1000, autoSuggestChoices: false });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());
const box = page.locator("section.desk-box");
/** Post chapter on the desk; resolves to the posted chapter's id. */
const postChapter = async () => {
  await box.getByRole("button", { name: "Post chapter" }).click();
  await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1/);
  return idFromUrl(page.url());
};
const writeOwnSummary = async (text) => {
  await box.getByRole("button", { name: /^▸ Summary/ }).click();
  await box.getByLabel("Summary", { exact: true }).fill(text);
  await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
  await page.waitForTimeout(600);
};

// ---- A: a first chapter gets summaries after it is posted ----
await startStory(page, BASE, { title: "Summary story" });
await box.getByLabel("Chapter title").fill("First");
await box.getByLabel("Chapter text").fill("Mira found a key.");
await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
const root = await postChapter();
const sumCalls = () => calls.filter((c) => c.isSummary);
let c = await until(async () => { const ch = (await chapter(root)).chapter; return ch.path_summary && ch; });
ok(sumCalls().length === 1 && sumCalls()[0].user.includes("first chapter") && sumCalls()[0].model === "cheap", "posting a first chapter makes one summary call on the cheaper model");
ok(c?.summary === "SUM(First)" && c?.path_summary === "SOFAR(First)", "the summaries are saved with the chapter");

// ---- B: a second chapter builds on its parent's story-so-far ----
await post(`/api/chapters/${root}/choices`, { label: "Next" });
const choice = (await chapter(root)).choices[0];
await page.goto(`${BASE}/c/${root}/desk?choice=${choice.id}`);
await box.getByLabel("Chapter title").fill("Second");
await box.getByLabel("Chapter text").fill("She opened the door.");
await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
const second = await postChapter();
c = await until(async () => { const ch = (await chapter(second)).chapter; return ch.path_summary && ch; });
ok(sumCalls().length === 2 && sumCalls()[1].user.includes("Summary of the story before this chapter:\nSOFAR(First)"), "the next chapter's summary builds on its parent's");
ok(c?.path_summary === "SOFAR(Second)", "…and is stored");

// ---- C: a long story with no summaries gets repaired before generating ----
const filler = "The quick brown fox jumped over the lazy dog. ".repeat(32); // ~1500 chars
const s = await post("/api/stories", { title: "Long tale", chapter: { title: "L1", body: filler, choices: ["on"] } });
let prev = s.chapter_id;
const lengthIds = [prev];
for (let i = 2; i <= 5; i++) {
  const ch = (await chapter(prev)).choices[0];
  const r = await post("/api/chapters", { choice_id: ch.id, title: `L${i}`, body: filler, choices: ["on"] });
  prev = r.chapter_id; lengthIds.push(prev);
}
const lastId = lengthIds.at(-1);
const before = sumCalls().length;
// The old Write page's address, with ?ai=1, opens a new choice's chapter on the desk and generates at once.
await page.goto(`${BASE}/c/${lastId}/write?ai=1`);
await page.waitForURL(new RegExp(`/c/${lastId}/desk\\?ai=1&new=$`));
await box.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Generated text here."), null, { timeout: 20000 });
ok(true, "?ai=1 starts generating without a click");
const made = sumCalls().length - before;
ok(made === 4, `summarized the 4 older chapters before generating (${made} calls)`);
const gen = calls.filter((x) => x.system.includes("Output format")).at(-1);
ok(
  gen && gen.user.includes("chapter by chapter:\n- L1: SUM(L1)\n- L2: SUM(L2)\n- L3: SUM(L3)\n- L4: SUM(L4)") && !gen.user.includes("- L1: The quick"),
  "the prompt uses the new per-chapter summaries instead of excerpts: " + JSON.stringify(gen?.user.slice(0, 300)),
);
const repaired = (await chapter(lastId)).path;
ok(repaired.slice(0, 4).every((p, i) => p.path_summary === `SOFAR(L${i + 1})`) && repaired[4].path_summary === null, "the repaired summaries were saved to the server");

// the next writer reuses them (no new summary calls)
const again = sumCalls().length;
// The first browser's draft (with the generated text) is saved on the server, and a draft that
// already has text doesn't auto-generate. Wait for that save, then drop the draft, so the second
// browser starts fresh rather than racing it.
const draftUrl = `${BASE}/api/drafts/${encodeURIComponent(`new:${lastId}`)}`;
for (let i = 0; i < 100 && !(await (await fetch(draftUrl)).json()).draft?.body; i++) await new Promise((r) => setTimeout(r, 100));
// Leave the desk first: while it is open its autosave can put the draft back after the delete.
await page.goto("about:blank");
await fetch(draftUrl, { method: "DELETE" });
const page2 = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page2.goto(`${BASE}/c/${lastId}/desk?new=&ai=1`);
await page2.getByRole("button", { name: "Edit text" }).click();
await page2.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Generated text here."), null, { timeout: 20000 });
ok(sumCalls().length === again, "another browser reuses the saved summaries (no new calls)");
await page2.goto("about:blank");
for (let i = 0; i < 50 && !(await (await fetch(draftUrl)).json()).draft?.body; i++) await new Promise((r) => setTimeout(r, 100));
await fetch(draftUrl, { method: "DELETE" });
await page2.context().close();

// ---- D: a failed story-so-far doesn't block posting, and the author's summary is kept ----
summaryMode = "bad";
await page.goto(`${BASE}/c/${second}/desk?new=Wait`);
await box.getByLabel("Chapter title").fill("Third");
await box.getByLabel("Chapter text").fill("Nothing happened.");
ok(await box.getByRole("button", { name: "Post chapter" }).isEnabled(), "a summary is optional: Post is on without one");
await writeOwnSummary("Nothing happened.");
const third = await postChapter();
await until(async () => sumCalls().some((x) => x.user.includes('Chapter: "Third"')));
await page.waitForTimeout(500);
c = (await chapter(third)).chapter;
ok(c.title === "Third" && c.summary === "Nothing happened." && c.path_summary === null, "the author's summary is posted even when the story-so-far fails");
summaryMode = "ok";

// ---- F: the author's own summary is posted as written, and left alone ----
await page.goto(`${BASE}/c/${second}/desk?new=Listen`);
await box.getByLabel("Chapter title").fill("Fourth");
await box.getByLabel("Chapter text").fill("A bell rang somewhere below.");
await writeOwnSummary("MY OWN SUMMARY");
const fourth = await postChapter();
await page.waitForTimeout(1500);
c = (await chapter(fourth)).chapter;
ok(c.summary === "MY OWN SUMMARY", "the author's summary is posted as written");
ok(!sumCalls().some((x) => x.user.includes('Chapter: "Fourth"')), "…and the AI is not asked to rewrite it");
const mark = await page.locator("section.desk-box .desk-fold .desk-chip").innerText().catch(() => "");
ok(mark === "yours · not rewritten", "the desk marks it yours · not rewritten: " + mark);

await browser.close(); mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
