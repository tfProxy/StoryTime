import { startFakeAi } from "../fakeAi.mjs";
import { launch, useMockAi } from "./browser.mjs";

// The writing desk on a phone (390×844, touch): only the chapter's box, in the order prompt, length, model, Generate,
// drafts, text, Update, with the "→" line and the title at its top; a bottom bar (Path, Write, Codex, Illustrate,
// Next n) opening each part full screen over the box and closing it again, with what is typed in the box kept; the
// codex to read (Preview text and facts, nothing to edit); ✎ in the path and a choice moving the desk; Illustrate and
// Next greyed out on a new chapter; no sideways scrolling, and the bar never covering Update.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const fake = await startFakeAi({ port: 3222, delay: 5, reply: () => "1. Run\n2. Hide" });
const ai = await useMockAi(BASE, { autoSuggestChoices: false });
const browser = await launch();
const drafts = [];
try {
  // Root -> A ("Go on") -> B ("Climb"); B has "Written next" (C) and "Unwritten one".
  const story = await post("/api/stories", { title: "Phone Tale", premise: "p", chapter: { title: "Root", body: "It began in the Hollow.", choices: ["Go on"] } });
  const R = story.chapter_id;
  const choiceOf = async (id, label) => (await send("GET", `/api/chapters/${id}`)).choices.find((c) => c.label === label);
  const A = (await post("/api/chapters", { choice_id: (await choiceOf(R, "Go on")).id, title: "Chapter A", body: "A walked on.", choices: ["Climb"] })).chapter_id;
  const B = (await post("/api/chapters", { choice_id: (await choiceOf(A, "Climb")).id, title: "Chapter B", body: "B climbed.", choices: ["Written next", "Unwritten one"] })).chapter_id;
  const C = (await post("/api/chapters", { choice_id: (await choiceOf(B, "Written next")).id, title: "Chapter C", body: "C came next." })).chapter_id;
  const unwritten = await choiceOf(B, "Unwritten one");
  drafts.push(`edit:${R}`, `edit:${A}`, `edit:${B}`, `edit:${C}`, `fill:${unwritten.id}`);
  const wren = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Wren", type: "character", aliases: [], content: "" })).entry_id;
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: wren, op: "set", aspect: "Hair", text: "short and brown" });
  await send("PUT", "/api/queue/paused", { paused: true });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const bar = page.locator("nav.desk-tabbar");
  const tab = (name) => bar.getByRole("button", { name, exact: true });
  const head = page.locator(".desk-sheet-head");
  const close = () => head.getByRole("button", { name: "Close" }).click();
  const box = page.locator("section.desk-box");
  const text = box.getByLabel("Chapter text");
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const top = async (l) => (await l.boundingBox())?.y ?? -1;

  // ---- the box ----
  await page.goto(`${BASE}/c/${B}/desk`);
  await box.getByLabel("Chapter title").waitFor();
  await bar.waitFor();
  const parts = [
    page.locator(".desk-here .desk-via"),
    box.getByLabel("Chapter title"),
    box.getByLabel("Prompt", { exact: true }),
    box.getByLabel("Length"),
    box.getByLabel("Model for writing"),
    box.getByRole("button", { name: /^Generate/ }),
    box.getByRole("group", { name: "Drafts" }),
    text,
    box.getByRole("button", { name: "Update chapter" }),
  ];
  const tops = [];
  for (const p of parts) tops.push(await top(p));
  ok(tops.every((y, i) => y >= 0 && (i === 0 || y >= tops[i - 1])), `the box reads → line, title, prompt, length, model, Generate, drafts, text, Update, top to bottom (${tops.map(Math.round).join(", ")})`);
  ok((await box.getByRole("button", { name: /Prompt and drafts/ }).getAttribute("aria-expanded")) === "true", "on a phone \"Prompt and drafts\" starts unfolded, on a posted chapter too");
  ok(!(await page.locator(".desk-path").isVisible()) && !(await page.locator(".desk-side").isVisible()) && !(await page.locator(".desk-next").isVisible()), "the path, the codex and the choices aren't on the page");
  ok((await bar.getByRole("button").allInnerTexts()).join("|") === "Path|Write|Codex|Illustrate|Next 2", "the bottom bar: Path, Write, Codex, Illustrate, Next 2");
  ok((await tab("Write").getAttribute("aria-pressed")) === "true", "…with Write on");
  ok(await noSideScroll(), "nothing scrolls sideways");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const update = await box.getByRole("button", { name: "Update chapter" }).boundingBox();
  const barBox = await bar.boundingBox();
  ok(update.y + update.height <= barBox.y, "scrolled to the end, Update chapter sits above the bar");
  ok(Math.round(barBox.y + barBox.height) === 844, "the bar is along the bottom of the screen");

  // ---- typing survives the sheets ----
  await text.fill("B climbed, typed on a phone.");
  const kept = async () => (await text.inputValue()) === "B climbed, typed on a phone.";

  // Path
  await tab("Path").click();
  const path = page.locator(".desk-path");
  ok(await path.isVisible(), "Path opens the path");
  ok((await head.locator("h2").innerText()) === "The path so far" && (await page.locator("article.desk-block").count()) === 2, "…full screen, named, with the two earlier chapters");
  ok(await page.evaluate(() => { const r = document.querySelector(".desk-path").getBoundingClientRect(); return r.top === 0 && r.width === window.innerWidth; }), "…over the whole screen above the bar");
  ok(await noSideScroll(), "…not scrolling sideways");
  await close();
  ok(!(await path.isVisible()) && (await kept()), "× closes it, and the typing in the box is still there");

  // Codex
  await tab("Codex").click();
  const side = page.locator("aside.desk-side");
  ok(await side.isVisible() && (await side.getByLabel("Search entries").isVisible()), "Codex opens the codex list, with its search");
  ok(!(await side.getByRole("button", { name: "New entry" }).isVisible()) && !(await side.getByRole("button", { name: "Fold the codex" }).isVisible()), "…with no + or « (entries are made on a wide screen)");
  ok(!(await side.locator(".desk-modes").isVisible()), "…and no Codex | Illustrate switch (the bar does that)");
  ok((await side.locator(".desk-group > summary").allTextContents()).some((t) => t.trim().startsWith("Characters")), "…grouped, Characters among them");
  await side.getByLabel("Search entries").fill("wr");
  ok((await side.locator(".desk-row").count()) === 1, "the search narrows the list");
  await side.locator(".desk-row", { hasText: "Wren" }).first().click();
  const entry = page.locator("section.desk-phone-entry");
  await entry.waitFor();
  ok((await entry.locator(".fact-ai").innerText()).includes("short and brown"), "tapping Wren shows what the AI is told");
  ok((await entry.locator(".desk-read-facts").innerText()).includes("Hair") && (await entry.locator(".desk-read-facts").innerText()).includes("short and brown"), "…and its facts");
  ok((await entry.locator("input, textarea, select").count()) === 0 && (await entry.getByRole("button").count()) === 0, "…to read only: nothing to type in or press");
  ok(!(await page.locator("section.desk-entry").isVisible()), "the entry column isn't shown");
  await head.getByRole("button", { name: "‹ Codex" }).click();
  ok(!(await entry.isVisible()) && (await side.isVisible()), "‹ Codex goes back to the list");
  await close();
  ok(!(await side.isVisible()) && (await kept()), "× closes the codex, the typing kept");

  // Next
  await tab("Next 2").click();
  const next = page.locator(".desk-next");
  ok(await next.isVisible() && (await next.getByText("Written next").isVisible()) && (await next.getByText("Unwritten one").isVisible()), "Next opens What happens next?, with both choices");
  await tab("Next 2").click();
  ok(!(await next.isVisible()) && (await kept()), "tapping Next again closes it, the typing kept");

  // Illustrate
  await tab("Illustrate").click();
  await page.waitForURL(/side=illustrate/);
  const pictures = page.locator(".desk-pictures");
  ok(await pictures.isVisible() && (await head.locator("h2").innerText()) === "Illustrate", "Illustrate opens Illustrate mode full screen");
  ok(await page.locator(".desk-illus-side").isVisible(), "…with the picture controls");
  ok(await noSideScroll(), "…not scrolling sideways");
  await close();
  await page.waitForURL((u) => !u.search.includes("side=illustrate"));
  ok(!(await pictures.isVisible()) && (await text.isVisible()) && (await kept()), "× goes back to the box, the typing kept");
  await tab("Path").click();
  await tab("Write").click();
  ok(!(await path.isVisible()) && (await text.isVisible()), "Write goes back to the box too");

  // ---- ✎ in the path moves the desk ----
  await tab("Path").click();
  await page.locator('article.desk-block[aria-label^="Chapter 2:"]').getByRole("link", { name: "Edit “Chapter A”" }).click();
  await page.waitForURL(`**/c/${A}/desk`);
  await box.getByLabel("Chapter title").waitFor();
  ok((await box.getByLabel("Chapter title").inputValue()) === "Chapter A", "✎ on Chapter A opens it on the desk");
  ok((await page.locator(".desk-phone-open").count()) === 0 && (await text.isVisible()), "…with its box showing, no sheet open");
  ok((await bar.getByRole("button").allInnerTexts()).join("|") === "Path|Write|Codex|Illustrate|Next 1", "…and its own count of choices");

  // ---- a choice opens its chapter ----
  await page.goto(`${BASE}/c/${B}/desk`);
  await bar.waitFor();
  ok((await text.inputValue()) === "B climbed, typed on a phone.", "back on B, the typing was kept in its draft");
  await tab("Next 2").click();
  await page.locator(".desk-next").getByRole("link", { name: /Written next/ }).click();
  await page.waitForURL(`**/c/${C}/desk`);
  await box.getByLabel("Chapter title").waitFor();
  ok((await box.getByLabel("Chapter title").inputValue()) === "Chapter C", "a written choice opens its chapter on the desk");

  // ---- a new chapter ----
  await page.goto(`${BASE}/c/${B}/desk?choice=${unwritten.id}`);
  await bar.waitFor();
  await box.getByRole("button", { name: "Post chapter" }).waitFor();
  ok(await tab("Illustrate").isDisabled() && (await tab("Illustrate").getAttribute("title")) === "Post the chapter first", "on a new chapter Illustrate is greyed out: Post the chapter first");
  ok(await tab("Next").isDisabled() && (await tab("Next").getAttribute("title")) === "Post the chapter first", "…and Next too");
  ok(await box.getByLabel("Prompt", { exact: true }).isVisible(), "…the prompt is there to write in");
  await tab("Path").click();
  ok((await page.locator("article.desk-block").count()) === 3, "its path has the three chapters before it");
  await close();
  ok(await noSideScroll(), "nothing scrolls sideways on a new chapter");

  // ---- the first chapter has no path ----
  await page.goto(`${BASE}/c/${R}/desk`);
  await bar.waitFor();
  ok(await tab("Path").isDisabled(), "on the story's first chapter Path is greyed out");

  // ---- a wide screen has no bar ----
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  ok((await bar.count()) === 0 && (await page.locator(".desk-side").isVisible()), "at desktop width there is no bar and the codex column is back");
  await context.close();
} finally {
  for (const key of drafts) await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  await send("PUT", "/api/queue/paused", { paused: false });
  await ai.restore();
  await fake.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
