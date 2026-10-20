// The Illustrate page shows the chapter being illustrated: its summary, the whole text and the story so far
// (folded away, and remembered), in a column beside the prompt on a wide screen and above it on a phone.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();

const story = await call("POST", "/api/stories", {
  title: "Seen while illustrating",
  chapter: { title: "Before", body: "Mara found the lantern in the cellar.", choices: ["Light it"] },
});
await call("PATCH", `/api/chapters/${story.chapter_id}`, { base_revision: 1, title: "Before", body: "Mara found the lantern in the cellar.", summary: "Mara finds a lantern.", path_summary: "Mara went down to the cellar and found a lantern." });
const choice = (await call("GET", `/api/chapters/${story.chapter_id}`)).choices[0];
const bodyText = "The lantern flared blue.\n\nMara stepped back as the walls began to glow.";
const lit = (await call("POST", "/api/chapters", { choice_id: choice.id, title: "Lit", body: bodyText })).chapter_id;
await call("PATCH", `/api/chapters/${lit}`, { base_revision: 1, title: "Lit", body: bodyText, summary: "The lantern glows blue and so do the walls." });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const panel = page.getByRole("complementary", { name: "The chapter" });

try {
  await page.goto(`${BASE}/c/${lit}/illustrate`);
  await panel.waitFor();
  ok((await panel.innerText()).includes("The lantern glows blue and so do the walls."), "the chapter's summary is shown");
  const text = panel.locator("details", { hasText: "Show the whole chapter" });
  ok(!(await text.evaluate((d) => d.open)), "the whole chapter starts folded");
  ok(!(await panel.getByText("Mara stepped back").isVisible()), "…and its text is out of sight");
  await text.locator("summary").click();
  ok(await panel.getByText("Mara stepped back as the walls began to glow.").isVisible() && await panel.getByText("The lantern flared blue.").isVisible(), "opening it shows the whole chapter, paragraph by paragraph");
  ok((await text.locator(".prose p").count()) === 2, "…as two paragraphs");

  // beside the prompt, and in view while the page is scrolled
  const side = await panel.boundingBox();
  const prompt = await page.locator(".image-prompt").boundingBox();
  ok(side.x > prompt.x + prompt.width - 1, `on a wide screen the chapter is in a column beside the prompt (chapter ${Math.round(side.x)}px, prompt ends ${Math.round(prompt.x + prompt.width)}px)`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolled = await panel.boundingBox();
  ok(scrolled.y >= 0 && scrolled.y < 100, `…and it stays in view when the page is scrolled to the bottom (top at ${Math.round(scrolled.y)}px)`);

  // the story so far is the previous chapter's running summary
  const earlier = panel.locator("details", { hasText: "Story so far" });
  ok(!(await earlier.evaluate((d) => d.open)), "the story so far starts folded");
  await earlier.locator("summary").click();
  ok(await panel.getByText("Mara went down to the cellar and found a lantern.").isVisible(), "the story so far is the previous chapter's running summary");

  // folds stay as they were left (the browser saves them a moment after the click)
  const saved = (n) => page.waitForFunction((n) => Object.values(JSON.parse(localStorage.getItem("storytime.illustrate.open") ?? "{}")).filter(Boolean).length === n, n);
  await saved(2);
  await page.reload();
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".illustrate-fold[open]").length === 2);
  ok(true, "both folds are still open after reloading");
  await text.locator("summary").click();
  await saved(1);
  await page.reload();
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".illustrate-fold[open]").length === 1);
  ok(await panel.getByText("Mara went down").isVisible() && !(await panel.getByText("Mara stepped back").isVisible()), "closing the chapter is remembered too");

  // the first chapter has no earlier story, and this one has no summary yet
  await page.goto(`${BASE}/c/${story.chapter_id}/illustrate`);
  await panel.waitFor();
  ok((await panel.getByText("Story so far").count()) === 0, "the first chapter has no story-so-far fold");

  // a chapter without a summary says so and points to where one is written
  const second = await call("POST", "/api/stories", { title: "No summary", chapter: { title: "Plain", body: "Just words here." } });
  await page.goto(`${BASE}/c/${second.chapter_id}/illustrate`);
  await panel.waitFor();
  ok(await panel.getByText("No summary yet.").isVisible(), "a chapter without a summary says so");
  const link = panel.getByRole("link", { name: "Write one" });
  ok((await link.getAttribute("href")) === `/c/${second.chapter_id}/summary`, "…with a link to the summary page");

  // phone: the chapter comes first, folded, and nothing runs off the side
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/c/${lit}/illustrate`);
  await panel.waitFor();
  await page.locator(".illustrate-fold summary").first().click();
  const small = await page.evaluate(() => {
    const side = document.querySelector(".illustrate-side").getBoundingClientRect();
    const main = document.querySelector(".illustrate-main").getBoundingClientRect();
    const wide = [...document.querySelectorAll(".illustrate-side *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length;
    return { above: side.bottom <= main.top + 1, scroll: document.documentElement.scrollWidth, inner: window.innerWidth, wide };
  });
  ok(small.above, "on a phone the chapter is above the prompt");
  ok(small.scroll <= small.inner && small.wide === 0, `no sideways scrolling at 390px wide (page ${small.scroll}px, window ${small.inner}px)`);

  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-chapter-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/c/${lit}/illustrate`);
    await panel.waitFor();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-chapter-1280.png` });
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
