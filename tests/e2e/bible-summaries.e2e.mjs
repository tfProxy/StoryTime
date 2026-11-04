import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

// The Story Bible's Summaries section: one chapter's editor with its ▾ combo button, the whole story's card with its
// counts and chapter list, and the old chapter summary page redirecting here. The fake AI writes summaries (in the
// browser) and answers the summary check (on the server).
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

const calls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const user = body.messages.at(-1).content;
    calls.push(user);
    const title = /Chapter: "([^"]*)"/.exec(user)?.[1];
    const out = user.includes("Summary to check:") ? { ok: true } : { summary: `SUM(${title})`, story_so_far: `SOFAR(${title})` };
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(out) } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE);
const browser = await launch();
try {
  // Gate -> River (edited after its summary was made), Gate -> Ridge (no summary).
  const story = await post("/api/stories", { title: "Summary Tale", premise: "p", chapter: { title: "Gate", body: "Mara stood at the gate.", summary: "Mara at the gate.", path_summary: "Mara arrives.", choices: ["River", "Ridge"] } });
  const storyId = story.story_id;
  const gate = story.chapter_id;
  const choices = (await send("GET", `/api/chapters/${gate}`)).choices;
  const river = (await post("/api/chapters", { choice_id: choices[0].id, title: "River", body: "first text", summary: "Mara reaches the river.", path_summary: "Mara went to the river." })).chapter_id;
  await send("PATCH", `/api/chapters/${river}`, { base_revision: 1, title: "River", body: "second text, much changed", summary: "Mara reaches the river." });
  // (an edit clears the story-so-far, so put it back)
  await send("PUT", `/api/chapters/${river}/summary`, { revision: 2, summary: "Mara reaches the river.", path_summary: "Mara went to the river." });
  const ridge = (await post("/api/chapters", { choice_id: choices[1].id, title: "Ridge", body: "She climbed the ridge." })).chapter_id;

  const url = (chapter, extra = "") => `${BASE}/s/${storyId}/review?tab=summaries${chapter ? `&chapter=${chapter}` : ""}${extra}`;
  const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const got = async (id) => (await send("GET", `/api/chapters/${id}`)).chapter;

  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  // ---- the whole story ----
  await page.goto(url());
  ok(await page.getByText("2 of 3 chapters have a summary").isVisible(), "the card counts the chapters that have a summary");
  ok(await page.getByText("1 missing · 1 out of date").isVisible(), "…and the missing and out-of-date ones");
  const row = (t) => page.locator(".summary-chapters li", { hasText: t });
  ok((await row("Gate").innerText()).includes("Done") && (await row("River").innerText()).includes("Out of date") && (await row("Ridge").innerText()).includes("Missing"), "the chapter list shows each chapter's status");
  const pad = (t) => row(t).evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
  ok((await pad("River")) > (await pad("Gate")), "the list is indented like the chapter tree");
  ok(await page.getByRole("button", { name: "Fix the 2 summaries" }).isVisible(), "the main button fixes the missing and out-of-date summaries");
  await page.getByRole("button", { name: "More ways to fix summaries" }).click();
  const items = await page.getByRole("menuitemradio").allInnerTexts();
  ok(items.length === 3 && /^Fix the 2 summaries/.test(items[0]) && /^Redo them all/.test(items[1]) && /^Check every summary with AI/.test(items[2]), "the ▾ menu offers Fix, Redo them all and Check every summary with AI: " + items.map((x) => x.split("\n")[0]).join(" | "));
  await page.keyboard.press("Escape");

  // ---- a chapter link switches to that chapter ----
  await row("River").getByRole("link", { name: "River" }).click();
  await page.waitForURL(url(river));
  await page.getByLabel("This chapter").waitFor();
  ok(/Showing .*River/.test(await page.locator(".bible-scope").innerText()), "a chapter link narrows the section to it");
  ok(await page.getByText("The chapter was edited after this summary was made.").isVisible(), "an out-of-date summary is flagged");
  ok((await page.getByLabel("This chapter").inputValue()) === "Mara reaches the river." && (await page.getByLabel("The story so far").inputValue()) === "Mara went to the river.", "the two boxes hold the saved summaries");
  const save = page.locator(".split-button > button").first();
  ok((await save.innerText()) === "Save" && (await save.isDisabled()), "the main button is Save, off until something changes");
  await page.getByLabel("This chapter").fill("Mara reaches the river and meets Oda.");
  await save.click();
  await page.getByText("Saved.").waitFor();
  ok((await got(river)).summary === "Mara reaches the river and meets Oda.", "Save keeps the edited summary");
  await page.getByText("The chapter was edited after this summary was made.").waitFor({ state: "hidden" });
  ok(true, "…and the out-of-date notice goes");

  // ---- the ▾ menu: Write it again, Check it ----
  await page.getByRole("button", { name: "More ways to fix this summary" }).click();
  const chapterItems = await page.getByRole("menuitemradio").allInnerTexts();
  ok(chapterItems.length === 3 && /^Save/.test(chapterItems[0]) && /^Write it again with AI/.test(chapterItems[1]) && /^Check it with AI/.test(chapterItems[2]), "the ▾ menu offers Save, Write it again with AI and Check it with AI");
  await page.getByRole("menuitemradio", { name: /^Write it again with AI/ }).click();
  await page.locator(".split-button > button").first().click();
  await page.getByText("Written again and saved.").waitFor({ timeout: 20000 });
  ok((await got(river)).summary === "SUM(River)" && (await got(river)).path_summary === "SOFAR(River)", "Write it again with AI replaces both summaries");
  await page.getByRole("button", { name: "More ways to fix this summary" }).click();
  await page.getByRole("menuitemradio", { name: /^Check it with AI/ }).click();
  ok((await page.locator(".split-button > button").first().innerText()) === "Check it with AI", "picking a menu item changes the main button");
  await page.locator(".split-button > button").first().click();
  await page.getByText("Every summary matches its chapter.").waitFor({ timeout: 30000 });
  ok(calls.some((c) => c.includes("Summary to check:") && c.includes("SUM(River)")), "Check it with AI sends the chapter and its summary");

  // ---- a chapter with no summary ----
  await page.goto(url(ridge));
  ok(await page.getByText("This chapter has no summary yet.").isVisible(), "a missing summary is flagged");
  ok((await page.locator(".split-button > button").first().innerText()) === "Write it with AI", "…and the main button writes it");

  // ---- the old page redirects, keeping failed ----
  await page.goto(`${BASE}/c/${ridge}/summary?failed=${encodeURIComponent("no key")}`);
  ok(page.url() === url(ridge, `&failed=${encodeURIComponent("no key")}`), "/c/<id>/summary goes to the Summaries section at that chapter: " + page.url());
  ok(await page.getByText(/couldn't summarize it: no key/).isVisible(), "…and keeps the failed notice");
  await page.goto(`${BASE}/c/${ridge}/summary`);
  ok(page.url() === url(ridge), "…without failed it is a plain link");

  // ---- Fix the summaries writes the missing and the out-of-date ones ----
  const now = await got(river);
  await send("PUT", `/api/chapters/${river}/summary`, { revision: now.revision, summary: "An old summary.", path_summary: "An old story so far." });
  await send("PATCH", `/api/chapters/${river}`, { base_revision: now.revision, title: "River", body: "third text, changed again", summary: "An old summary." });
  await page.goto(url());
  calls.length = 0;
  await page.getByRole("button", { name: /^Fix the \d summar/ }).click();
  await page.getByText(/\d written\./).waitFor({ timeout: 30000 });
  ok((await got(ridge)).summary === "SUM(Ridge)", "Fix writes the chapter that had none");
  ok(!calls.some((c) => c.includes('Chapter: "Gate"')), "…and leaves the good one alone");
  await page.getByText("Every summary is up to date.").waitFor({ timeout: 5000 }).catch(async () => { console.log(await page.locator("main").innerText()); throw new Error("not up to date"); });
  ok(await page.getByRole("button", { name: "Redo them all" }).isVisible(), "with nothing to fix the main button is Redo them all");

  // ---- a phone ----
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  phone.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  await phone.goto(url());
  ok(await sideways(phone), "no sideways scroll at 390px, whole story");
  await phone.getByRole("button", { name: "More ways to fix summaries" }).click();
  const menu = await phone.locator(".split-menu").boundingBox();
  ok(menu.x >= 0 && menu.x + menu.width <= 390, "the whole-story menu fits the screen");
  ok(await sideways(phone), "…without a sideways scroll");
  await phone.goto(url(river));
  ok(await sideways(phone), "no sideways scroll at 390px, one chapter");
  await phone.getByRole("button", { name: "More ways to fix this summary" }).click();
  const menu2 = await phone.locator(".split-menu").boundingBox();
  ok(menu2.x >= 0 && menu2.x + menu2.width <= 390 && (await sideways(phone)), "the chapter menu fits the screen too");
} finally {
  mock.close();
  await ai.restore();
  await browser.close();
}
process.exit(failed ? 1 : 0);
