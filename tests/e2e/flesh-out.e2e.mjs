import { launch, useMockAi } from "./browser.mjs";

// "Flesh out" under a codex card: the form (stay close, focus), the run it makes, and where the button is not offered.
// The queue is paused, so no AI is called (the AI side is covered by tests/api/flesh-out.test.mjs).
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);
const clearQueue = async () => {
  for (const item of (await send("GET", "/api/queue")).items ?? []) await fetch(`${BASE}/api/queue/items/${item.key}`, { method: "DELETE" });
};

const ai = await useMockAi(BASE);
const browser = await launch();
try {
  const story = await post("/api/stories", { title: "Flesh Tale", premise: "p", chapter: { title: "Root", body: "Wren stood there.", choices: ["Go on"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const wren = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Wren", type: "character", content: "" })).entry_id;
  await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "The Hollow", type: "place", content: "" });

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  await send("PUT", "/api/queue/paused", { paused: true });

  await page.goto(`${BASE}/c/${R}/codex`);
  const card = page.locator(".entry-cards li", { hasText: "Wren" });
  await card.waitFor();
  ok((await page.getByRole("button", { name: /^Flesh out/ }).count()) === 2, "every entry card has a Flesh out button");
  ok((await card.locator("a.entry-card").count()) === 1 && (await card.locator("a.entry-card button").count()) === 0, "…which is beside the card's link, not inside it");

  // the form: invent by default
  await card.getByRole("button", { name: /^Flesh out/ }).click();
  const stay = card.getByLabel(/Stay close to the story/);
  ok(!(await stay.isChecked()), "the default is to add new details");
  await card.getByLabel(/Focus/).fill("her family");
  const queued = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/flesh-out`) && r.request().method() === "POST");
  await card.getByRole("button", { name: "Suggest facts" }).click();
  const made = await (await queued).json();
  const run = await send("GET", `/api/ai-runs/${made.run_id}`);
  ok(made.tasks === 1 && run.tasks[0].kind === "expand" && run.tasks[0].entryId === wren && run.tasks[0].mode === "invent" && run.tasks[0].hint === "her family" && run.tasks[0].chapterId === R, "the button makes an 'invent' run for this entry at this chapter, with the focus");
  ok((await card.getByRole("button", { name: /^Flesh out/ }).count()) === 0, "…and the button gives way to the run's progress");
  await clearQueue();

  // stay close
  await page.goto(`${BASE}/c/${R}/codex`);
  const card2 = page.locator(".entry-cards li", { hasText: "The Hollow" });
  await card2.getByRole("button", { name: /^Flesh out/ }).click();
  await card2.getByLabel(/Stay close to the story/).check();
  const queued2 = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/flesh-out`) && r.request().method() === "POST");
  await card2.getByRole("button", { name: "Suggest facts" }).click();
  const made2 = await (await queued2).json();
  ok((await send("GET", `/api/ai-runs/${made2.run_id}`)).tasks[0].mode === "close", "'Stay close' makes a 'close' run");
  await clearQueue();

  // cancel
  await page.goto(`${BASE}/c/${R}/codex`);
  const card3 = page.locator(".entry-cards li", { hasText: "Wren" });
  await card3.getByRole("button", { name: /^Flesh out/ }).click();
  await card3.getByRole("button", { name: "Cancel" }).click();
  ok(await card3.getByRole("button", { name: /^Flesh out/ }).isVisible(), "Cancel closes the form");

  // not offered on the story's details page (whole-story codex) or in the writing drawer
  await page.goto(`${BASE}/s/${sid}/details`);
  await page.getByText("Wren").first().waitFor();
  ok((await page.getByRole("button", { name: /^Flesh out/ }).count()) === 0, "not on the story details page's codex");

  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/c/${R}/codex`);
  await page.locator(".entry-cards li", { hasText: "Wren" }).getByRole("button", { name: /^Flesh out/ }).click();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the open form fits a phone screen");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await clearQueue();
  await send("PUT", "/api/queue/paused", { paused: false });
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
