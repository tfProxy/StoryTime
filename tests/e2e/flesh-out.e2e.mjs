import { launch, useMockAi } from "./browser.mjs";

// "Flesh out" on a codex entry's own page: the form (stay close, focus), the run it makes, and where it is not offered.
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
  const hollow = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "The Hollow", type: "place", content: "" })).entry_id;
  const entryUrl = (id) => `${BASE}/s/${sid}/codex/${id}?at=${R}`;

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  await send("PUT", "/api/queue/paused", { paused: true });

  // not on the list of entries
  await page.goto(`${BASE}/c/${R}/codex`);
  await page.locator(".entry-card", { hasText: "Wren" }).waitFor();
  ok((await page.getByRole("button", { name: /^Flesh out/ }).count()) === 0, "the list of entries has no Flesh out button");

  // on the entry's page: invent by default
  await page.goto(entryUrl(wren));
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Flesh out with AI", exact: true }) });
  await section.waitFor();
  await section.getByRole("button", { name: /^Flesh out/ }).click();
  const stay = section.getByLabel(/Stay close to the story/);
  ok(!(await stay.isChecked()), "the default is to add new details");
  await section.getByLabel(/Focus/).fill("her family");
  const queued = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/flesh-out`) && r.request().method() === "POST");
  await section.getByRole("button", { name: "Suggest facts" }).click();
  const made = await (await queued).json();
  const run = await send("GET", `/api/ai-runs/${made.run_id}`);
  ok(made.tasks === 1 && run.tasks[0].kind === "expand" && run.tasks[0].entryId === wren && run.tasks[0].mode === "invent" && run.tasks[0].hint === "her family" && run.tasks[0].chapterId === R, "the button makes an 'invent' run for this entry at this chapter, with the focus");
  ok((await section.getByRole("button", { name: /^Flesh out/ }).count()) === 0, "…and the button gives way to the run's progress");
  await clearQueue();

  // stay close, on another entry
  await page.goto(entryUrl(hollow));
  const section2 = page.locator("section", { has: page.getByRole("heading", { name: "Flesh out with AI", exact: true }) });
  await section2.getByRole("button", { name: /^Flesh out/ }).click();
  await section2.getByLabel(/Stay close to the story/).check();
  const queued2 = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/flesh-out`) && r.request().method() === "POST");
  await section2.getByRole("button", { name: "Suggest facts" }).click();
  const made2 = await (await queued2).json();
  const run2 = await send("GET", `/api/ai-runs/${made2.run_id}`);
  ok(run2.tasks[0].mode === "close" && run2.tasks[0].entryId === hollow, "'Stay close' makes a 'close' run for that entry");
  await clearQueue();

  // cancel
  await page.goto(entryUrl(wren));
  await section.getByRole("button", { name: /^Flesh out/ }).click();
  await section.getByRole("button", { name: "Cancel" }).click();
  ok(await section.getByRole("button", { name: /^Flesh out/ }).isVisible(), "Cancel closes the form");

  // what the AI suggested is shown on this page, under the section, with no trip to the inbox
  const rev = (await send("GET", `/api/chapters/${R}`)).chapter.revision;
  await post(`/api/chapters/${R}/codex-suggestions`, {
    revision: rev,
    source: "expand",
    entry_id: wren,
    suggestions: [
      { kind: "set", entry_id: wren, aspect: "Voice", form: "", after: "low and dry", quote: "" },
      { kind: "set", entry_id: wren, aspect: "Family", form: "", after: "an older brother", quote: "" },
    ],
  });
  await page.goto(entryUrl(wren));
  const suggested = page.locator(".codex-inbox");
  await suggested.getByRole("heading", { name: "Suggested facts" }).waitFor();
  ok((await suggested.locator("article.inbox-card").count()) === 2, "the suggested facts are listed on the entry's page");
  const askBox = await section.boundingBox();
  const listBox = await suggested.boundingBox();
  ok(listBox.y >= askBox.y + askBox.height - 1, "…right below Flesh out with AI");
  await suggested.getByRole("button", { name: "Accept all for Wren" }).click();
  await page.locator(".fact-line", { hasText: "low and dry" }).waitFor();
  ok((await page.locator(".fact-line", { hasText: "an older brother" }).count()) === 1, "'Accept all' adds them to the entry, here");

  // not in the writing page's drawer
  await send("PUT", "/api/queue/paused", { paused: false });
  await page.goto(`${BASE}/c/${R}/write`);
  await page.locator(".site-menu > summary").click();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  const drawer = page.locator("aside.codex-drawer");
  await drawer.waitFor();
  await drawer.locator(".entry-card", { hasText: "Wren" }).click();
  await drawer.getByRole("heading", { name: "Wren" }).waitFor();
  ok((await drawer.getByRole("button", { name: /^Flesh out/ }).count()) === 0, "not offered in the writing page's drawer");

  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(entryUrl(wren));
  await section.getByRole("button", { name: /^Flesh out/ }).click();
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
