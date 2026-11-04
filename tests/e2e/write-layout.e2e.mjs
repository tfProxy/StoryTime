// The writing page: the two model pickers sit once at the top, and the Finish section (summary and choices)
// stays folded until the chapter has text.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const json = async (method, url, body) =>
  (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();

const made = await json("POST", "/api/stories", { title: "Layout tale", premise: "p", style: "s", chapter: { title: "Start", body: "It began.", choices: ["Onward"] } });
const choice = (await json("GET", `/api/chapters/${made.chapter_id}`)).choices?.[0]?.id ?? made.choice_ids[0];

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
try {
  await page.goto(`${BASE}/c/${made.chapter_id}/write?choice=${choice}`);
  await page.getByLabel("Chapter title").waitFor();

  ok((await page.getByLabel("Model for writing").count()) === 1, "one writing-model picker, not one beside each button");
  ok((await page.getByLabel("Model for suggestions").count()) === 1, "one picker for the summaries and choices model");
  const picker = await page.getByLabel("Model for writing").boundingBox();
  const direction = await page.getByRole("heading", { name: "Direction" }).boundingBox();
  ok(picker.y < direction.y, "the pickers come before the Direction section");

  const finish = page.locator("details.ai-panel", { has: page.getByRole("heading", { name: "Finish" }) });
  ok((await finish.getAttribute("open")) === null, "Finish is folded while the chapter has no text");
  ok(!(await page.getByLabel(/^Summary/).isVisible()), "…so the summary field is hidden");

  await page.getByLabel("Chapter text").fill("The road went on.");
  await page.waitForFunction(() => document.querySelector("details.ai-panel[open] .inline-heading"));
  ok(await page.getByLabel(/^Summary/).isVisible(), "Finish opens once there is text");

  await finish.locator("summary").click();
  ok((await finish.getAttribute("open")) === null, "…and can be folded again by hand");

  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll at phone width");
} finally {
  await browser.close();
}
if (failed) process.exit(1);
