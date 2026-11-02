import { launch, useMockAi } from "./browser.mjs";

// A chapter's reading page: the optional list of codex entries at the bottom (the "List the codex entries at the bottom of
// a chapter" setting), and the combo button for "Suggest choices" / "Draft a different idea".
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE); // showCodexList is off here
const browser = await launch();
try {
  const story = await post("/api/stories", { title: "Reading Tale", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Go on", "Wait"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${R}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Zed arrived.", choices: [] })).chapter_id;
  const mira = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Mira", type: "character" })).entry_id;
  const zed = (await post("/api/codex", { anchor_chapter_id: A, op: "create", name: "Zed", type: "character" })).entry_id;
  await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "The Hollow", type: "place" });

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  // ---- the list is off by default ----
  await page.goto(`${BASE}/c/${A}`);
  await page.getByRole("heading", { name: "Chapter A", level: 1 }).waitFor();
  ok((await page.locator(".chapter-codex").count()) === 0, "no codex list unless the setting is on");

  // ---- on: the entries live at this chapter, as [A, B, C] ----
  const before = (await send("GET", "/api/settings")).settings;
  await send("PUT", "/api/settings", { ...before, showCodexList: true });
  await page.goto(`${BASE}/c/${A}`);
  const list = page.locator(".chapter-codex");
  await list.waitFor();
  ok((await list.innerText()).replace(/\s+/g, " ").trim() === "[Mira, Zed, The Hollow]", "the list shows the entries at this chapter, in the codex's order (by type, then name): " + (await list.innerText()));
  await page.goto(`${BASE}/c/${R}`);
  await page.locator(".chapter-codex").waitFor();
  ok((await page.locator(".chapter-codex").innerText()).replace(/\s+/g, " ").trim() === "[Mira, The Hollow]", "…and only those: an earlier chapter doesn't list Zed");
  const bottom = await page.locator(".chapter-codex").boundingBox();
  const choices = await page.locator("section.choices").boundingBox();
  ok(bottom.y >= choices.y + choices.height - 1, "…below the choices");

  // an entry opens its page for this chapter
  await page.goto(`${BASE}/c/${A}`);
  await page.locator(".chapter-codex").getByRole("link", { name: "Zed" }).click();
  await page.getByRole("heading", { name: "Zed", level: 1 }).waitFor();
  ok(page.url() === `${BASE}/s/${sid}/codex/${zed}?at=${A}`, "clicking an entry opens its page at this chapter: " + page.url());
  await page.goto(`${BASE}/c/${A}`);
  ok((await page.locator(".chapter-codex").getByRole("link", { name: "Mira" }).getAttribute("href")) === `/s/${sid}/codex/${mira}?at=${A}`, "an entry from an earlier chapter links the same way");
  await send("PUT", "/api/settings", { ...before, showCodexList: false });
  await page.goto(`${BASE}/c/${A}`);
  await page.getByRole("heading", { name: "Chapter A", level: 1 }).waitFor();
  ok((await page.locator(".chapter-codex").count()) === 0, "turned off again, the list is gone");

  // ---- the combo button ----
  await page.goto(`${BASE}/c/${R}`);
  const main = page.getByRole("button", { name: "Suggest choices" });
  await main.waitFor();
  ok((await page.getByRole("link", { name: "Draft a different idea" }).count()) === 0, "there is no separate Draft a different idea button");
  ok((await page.locator(".split-button").count()) === 1, "one combo button");
  await page.getByRole("button", { name: "More ways to continue" }).click();
  const items = page.getByRole("menuitemradio");
  ok((await items.count()) === 2 && (await items.first().getAttribute("aria-checked")) === "true", "its menu has both actions, Suggest choices chosen");
  await items.nth(1).click();
  await page.getByRole("button", { name: "Draft a different idea" }).waitFor();
  ok((await page.getByRole("button", { name: "Suggest choices" }).count()) === 0, "picking the other one changes the main button");
  await page.getByRole("button", { name: "Draft a different idea" }).click();
  await page.waitForURL(new RegExp(`/c/${R}/write$`));
  ok(true, "the main button then opens the writing page");

  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/c/${R}`);
  await page.getByRole("button", { name: "More ways to continue" }).click();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the open menu fits a phone screen");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
