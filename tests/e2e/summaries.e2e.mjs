import http from "node:http";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const calls = [];
let summaryMode = "ok"; // "ok" | "bad"
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
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

const browser = await launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  if (!localStorage.getItem("storytime.settings.v1")) {
    // A small context budget so older chapters have to be condensed.
    localStorage.setItem("storytime.settings.v1", JSON.stringify({ authorName: "Ann", activeProvider: "ollama", contextTokens: 1000,
      providers: { ollama: { baseUrl: "http://localhost:3222/v1", apiKey: "", model: "main", summaryModel: "cheap" } } }));
  }
});
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// ---- A: a first chapter gets summaries when posted ----
await page.goto(`${BASE}/new`);
await page.getByLabel("Story title").fill("Summary story");
await page.getByLabel("Chapter title").fill("First");
await page.getByLabel("Chapter text").fill("Mira found a key.");
await page.getByPlaceholder("Choice 1").fill("Next");
await page.getByRole("button", { name: "Summarize chapter" }).click();
await page.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => t.value === "SUM(First)"));
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\//);
const root = idFromUrl(page.url());
const sumCalls = () => calls.filter((c) => c.isSummary);
ok(sumCalls().length === 1 && sumCalls()[0].user.includes("first chapter") && sumCalls()[0].model === "cheap", "posting a first chapter makes one summary call on the cheaper model");
let c = (await chapter(root)).chapter;
ok(c.summary === "SUM(First)" && c.path_summary === "SOFAR(First)", "the summaries were posted with the chapter");

// ---- B: a second chapter builds on its parent's story-so-far ----
const choice = (await chapter(root)).choices[0];
await page.goto(`${BASE}/c/${root}/write?choice=${choice.id}`);
await page.getByLabel("Chapter title").fill("Second");
await page.getByLabel("Chapter text").fill("She opened the door.");
await page.getByRole("button", { name: "Summarize chapter" }).click();
await page.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => t.value === "SUM(Second)"));
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/(?!.*write)/);
const second = idFromUrl(page.url());
ok(sumCalls().length === 2 && sumCalls()[1].user.includes("Summary of the story before this chapter:\nSOFAR(First)"), "the next chapter's summary builds on its parent's");
c = (await chapter(second)).chapter;
ok(c.path_summary === "SOFAR(Second)", "…and is stored");

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
await page.goto(`${BASE}/c/${lastId}/write?ai=1`);
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Generated text here."), null, { timeout: 20000 });
ok(true, "?ai=1 starts generating without a click");
const made = sumCalls().length - before;
ok(made === 4, `summarized the 4 older chapters before generating (${made} calls)`);
const gen = calls.at(-1);
ok(
  !gen.isSummary && gen.user.includes("chapter by chapter:\n- L1: SUM(L1)\n- L2: SUM(L2)\n- L3: SUM(L3)\n- L4: SUM(L4)") && !gen.user.includes("- L1: The quick"),
  "the prompt uses the new per-chapter summaries instead of excerpts: " + JSON.stringify(gen.user.slice(0, 300)),
);
const repaired = (await chapter(lastId)).path;
ok(repaired.slice(0, 4).every((p, i) => p.path_summary === `SOFAR(L${i + 1})`) && repaired[4].path_summary === null, "the repaired summaries were saved to the server");

// the next writer reuses them (no new summary calls)
const again = sumCalls().length;
const page2 = await (await browser.newContext()).newPage();
await page2.context().addInitScript(() => {
  localStorage.setItem("storytime.settings.v1", JSON.stringify({ authorName: "Bo", activeProvider: "ollama", contextTokens: 1000,
    providers: { ollama: { baseUrl: "http://localhost:3222/v1", apiKey: "", model: "main", summaryModel: "cheap" } } }));
});
await page2.goto(`${BASE}/c/${lastId}/write?ai=1`);
await page2.getByRole("button", { name: "Edit text" }).click();
await page2.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Generated text here."), null, { timeout: 20000 });
ok(sumCalls().length === again, "another browser reuses the saved summaries (no new calls)");
await page2.context().close();

// ---- D: a failed summary doesn't block posting, and can be generated afterwards ----
summaryMode = "bad";
await page.goto(`${BASE}/c/${second}/write`);
await page.getByLabel(/Choice text/).fill("Wait");
await page.getByLabel("Chapter title").fill("Third");
await page.getByLabel("Chapter text").fill("Nothing happened.");
ok(await page.getByRole("button", { name: "Post chapter" }).isDisabled() && (await page.getByText(/Add a summary in step 3/).isVisible()), "posting is blocked until there is a summary");
await page.getByLabel(/^Summary/).fill("Nothing happened.");
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
const third = idFromUrl(page.url());
c = (await chapter(third)).chapter;
ok(c.title === "Third" && c.summary === "Nothing happened." && c.path_summary === null, "the author's summary is posted even when the story-so-far fails");
summaryMode = "ok";

// ---- E: editing keeps the chapter's summary unless the author changes it; those below are cleared ----
await page.goto(`${BASE}/c/${second}/edit`);
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.length > 0);
ok((await page.getByLabel(/^Summary/).inputValue()) === "SUM(Second)", "the edit form starts with the chapter's summary");
await page.getByLabel("Chapter text").fill("She opened the door, then the window.");
ok(await page.getByText(/current summary, and it will be kept/).isVisible(), "it says the summary will be kept");
let beforeEdit = sumCalls().length;
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForURL(`${BASE}/c/${second}`);
ok(sumCalls().length === beforeEdit, "a small edit doesn't make a new summary");
c = (await chapter(second)).chapter;
ok(c.summary === "SUM(Second)" && c.path_summary === "SOFAR(Second)" && c.revision === 2, "the summaries are kept");
ok((await chapter(third)).chapter.path_summary === null, "chapters below it were cleared");
// a changed summary is kept as written, with the story-so-far redone around it
await page.goto(`${BASE}/c/${second}/edit`);
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.length > 0);
await page.getByLabel(/^Summary/).fill("She opened the door and a window.");
beforeEdit = sumCalls().length;
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForURL(`${BASE}/c/${second}`);
c = (await chapter(second)).chapter;
ok(sumCalls().length === beforeEdit + 1 && c.summary === "She opened the door and a window." && c.path_summary === "SOFAR(Second)" && c.revision === 3, "an edited summary is saved and the story-so-far regenerated");
ok(sumCalls().at(-1).user.includes("SOFAR(First)"), "…building on the parent's story-so-far");

// an edit draft saved before summaries were carried into it picks up the chapter's summary
await page.goto(`${BASE}/c/${second}/edit`);
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.length > 0);
await page.evaluate(async (key) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("storytime", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => {
    const tx = db.transaction("drafts", "readwrite");
    tx.objectStore("drafts").put({ key, href: "/", label: "old", updatedAt: Date.now(), storyTitle: "", premise: "", newChoiceLabel: "", title: "Second", body: "An old draft body.", choices: [""], prompt: "", undo: [], baseRevision: 3 });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}, `edit:${second}`);
await page.goto(`${BASE}/c/${second}/edit`);
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value === "An old draft body.");
ok((await page.getByLabel(/^Summary/).inputValue()) === "She opened the door and a window.", "an older edit draft starts with the chapter's summary");
await page.evaluate(async (key) => {
  const db = await new Promise((res) => { const r = indexedDB.open("storytime", 1); r.onsuccess = () => res(r.result); });
  await new Promise((res) => { const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").delete(key); tx.oncomplete = res; });
  db.close();
}, `edit:${second}`);

// ---- F: the author's own summary is posted as written ----
await page.goto(`${BASE}/c/${second}/write`);
await page.getByLabel(/Choice text/).fill("Listen");
await page.getByLabel("Chapter title").fill("Fourth");
await page.getByLabel("Chapter text").fill("A bell rang somewhere below.");
await page.getByLabel(/^Summary/).fill("MY OWN SUMMARY");
ok(await page.getByRole("button", { name: "Post chapter" }).isEnabled(), "posting is allowed once there is a summary");
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
c = (await chapter(idFromUrl(page.url()))).chapter;
ok(c.summary === "MY OWN SUMMARY" && c.path_summary === "SOFAR(Fourth)", "the author's summary is kept; the story-so-far is generated around it");
ok(sumCalls().at(-1).user.includes("The author has already summarized this chapter") && sumCalls().at(-1).user.includes("MY OWN SUMMARY"), "the model is given the author's summary");

// ---- G: a summary made in step 3 is reused when posting ----
await page.goto(`${BASE}/c/${second}/write`);
await page.getByLabel(/Choice text/).fill("Run");
await page.getByLabel("Chapter title").fill("Fifth");
await page.getByLabel("Chapter text").fill("She ran for the stairs.");
ok(await page.getByRole("button", { name: "Post chapter" }).isDisabled(), "posting without a summary is blocked");
await page.getByRole("button", { name: "Summarize chapter" }).click();
await page.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => t.value === "SUM(Fifth)"));
ok(true, "Summarize chapter fills in the summary");
await page.getByLabel("Chapter text").fill("She ran for the stairs, then stopped.");
ok(await page.getByText(/changed since this summary was made/).isVisible(), "an outdated summary is flagged");
await page.getByRole("button", { name: "Summarize again" }).click();
await page.getByText(/changed since this summary was made/).waitFor({ state: "hidden" });
const beforePost = sumCalls().length;
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
ok(sumCalls().length === beforePost, "posting reuses the summary made in step 3");
c = (await chapter(idFromUrl(page.url()))).chapter;
ok(c.summary === "SUM(Fifth)" && c.path_summary === "SOFAR(Fifth)", "…and stores it");

await browser.close(); mock.close();
process.exit(failed ? 1 : 0);
