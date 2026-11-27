// "Ready" in the header means finished and not looked at yet: a finished run or Generate whose page is not open counts;
// opening it (the header list's Open link, or its own page being open) takes it out of the count and the header list,
// while the queue page's Finished section still lists it; "Clear finished" in the header only marks finished writing as
// looked at. The items are made through the test-only route, so nothing needs the AI.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? "/tmp";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// No automatic codex check of the chapters made here: its run would show in the queue.
const before = (await call("GET", "/api/settings")).settings;
await putSettings({ ...(before ?? {}), autoCodex: false });

const story = await call("POST", "/api/stories", { title: "Seen tale", chapter: { title: "Chapter One", body: "one", choices: ["on"] } });
const other = await call("POST", "/api/stories", { title: "Other seen tale", chapter: { title: "Elsewhere", body: "else", choices: [] } });
const makeItem = (key, type, state, data) => call("POST", "/api/queue/test-items", { key, type, state, data });
const run = (id, extra = {}) => ({ runId: id, storyId: story.story_id, storyTitle: "Seen tale", startChapterId: null, startTitle: "", mode: "fill", done: 2, total: 2, ...extra });
const gen = (draftKey, label) => ({ draftKey, href: `/c/${story.chapter_id}/desk?new=`, label, request: {} });
const items = async () => (await call("GET", "/api/queue")).items;
const itemOf = async (key) => (await items()).find((i) => i.key === key);
const made = [];
const add = async (key, type, state, data) => { made.push(key); await makeItem(key, type, state, data); };

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1100 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const badge = page.locator(".site-header .picture-queue-button");
const panel = page.getByRole("region", { name: "Queue" });
const label = async () => ((await badge.count()) ? await badge.getAttribute("aria-label") : "");
const finished = () => page.getByRole("region", { name: "Finished", exact: true }).getByRole("listitem");

try {
  // ---- finished and not looked at: ready ----
  await add("run:seen-e2e-a", "run", "done", run("seen-e2e-a"));
  await add("run:seen-e2e-b", "run", "done", run("seen-e2e-b", { mode: "tree" }));
  await add("gen:seen-e2e-g", "generate", "done", gen("seen-e2e-g", "Seen generate"));
  await page.goto(`${BASE}/settings`);
  ok(await until(async () => (await label()) === "Queue: 3 ready", "three ready"), "a finished run, run and Generate whose pages are not open count as ready: " + (await label()));
  await badge.click();
  ok((await panel.getByRole("listitem").count()) === 3, "…and the header list shows all three");

  // ---- opening one takes it out of the count and the list ----
  await panel.getByRole("listitem", { name: /^Writing Seen generate/ }).getByRole("link", { name: "Open", exact: true }).click();
  await page.waitForURL(`${BASE}/c/${story.chapter_id}/desk?new=`);
  ok(await until(async () => (await itemOf("gen:seen-e2e-g"))?.data.seen === true, "the Generate to be marked seen on the server"), "Open marks the Generate seen on the server");
  ok(await until(async () => (await label()) === "Queue: 2 ready", "two ready"), "…and the header counts two ready: " + (await label()));
  ok((await itemOf("gen:seen-e2e-g"))?.state === "done", "…the item itself is kept, still done");
  await badge.click();
  ok((await panel.getByRole("listitem").count()) === 2 && (await panel.getByRole("listitem", { name: /^Writing Seen generate/ }).count()) === 0, "…and the header list no longer shows it");
  await page.screenshot({ path: `${SHOTS}/queue-seen-header-desktop.png` });

  // ---- the queue page still lists it ----
  await page.goto(`${BASE}/queue`);
  ok(await until(async () => (await finished().count()) === 3, "three under Finished"), "the queue page's Finished section still lists all three");
  ok((await finished().filter({ hasText: "Seen generate" }).count()) === 1, "…including the one that has been looked at");
  ok((await label()) === "Queue: 2 ready", "…while the header still counts two");

  // ---- Clear finished marks the writing as looked at, and keeps it on the queue page ----
  await badge.click();
  await panel.getByRole("button", { name: "Clear finished" }).click();
  ok(await until(async () => (await badge.count()) === 0, "the header to clear"), "Clear finished empties the header");
  ok(await until(async () => (await itemOf("run:seen-e2e-a"))?.data.seen === true && (await itemOf("run:seen-e2e-b"))?.data.seen === true, "both runs seen on the server"), "…by marking the finished runs seen on the server");
  ok((await items()).filter((i) => made.includes(i.key)).length === 3, "…and nothing was removed from the queue");
  ok((await finished().count()) === 3, "…the queue page still lists all three under Finished");
  await page.reload();
  await page.getByRole("heading", { name: "Finished" }).waitFor();
  ok((await finished().count()) === 3 && (await badge.count()) === 0, "after a reload they are still listed there and the header stays clear");
  await page.screenshot({ path: `${SHOTS}/queue-seen-page-desktop.png`, fullPage: true });

  // ---- a Generate whose own page is open is looked at as soon as it finishes ----
  await add("gen:new:" + story.chapter_id, "generate", "done", gen("new:" + story.chapter_id, "Own page"));
  await page.goto(`${BASE}/settings`);
  ok(await until(async () => (await label()) === "Queue: 1 ready", "its Generate ready"), "a finished Generate of a draft that is not open counts as ready");
  await page.goto(`${BASE}/c/${story.chapter_id}/desk?new=`);
  ok(await until(async () => (await itemOf("gen:new:" + story.chapter_id))?.data.seen === true, "seen"), "with that draft's page open it is marked seen at once");
  ok(await until(async () => (await badge.count()) === 0, "the header to clear"), "…and the header does not count it");

  // ---- an automatic review of a chapter: ready until that chapter's desk is open ----
  const review = { mode: "review", automatic: true, startChapterId: story.chapter_id, startTitle: "Chapter One", total: 1, done: 1 };
  // (Made while on another page: the desk we are leaving would take a review of its own chapter as looked at.)
  await page.goto(`${BASE}/settings`);
  await add("run:seen-e2e-review", "run", "done", run("seen-e2e-review", review));
  await add("run:seen-e2e-review-other", "run", "done", run("seen-e2e-review-other", { ...review, storyId: other.story_id, storyTitle: "Other seen tale", startChapterId: other.chapter_id, startTitle: "Elsewhere" }));
  ok(await until(async () => (await label()) === "Queue: 2 ready", "two reviews ready"), "automatic reviews of chapters count as ready while their desks are not open: " + (await label()) + " " + JSON.stringify((await items()).map((i) => [i.key, i.state, i.data.seen])));
  await badge.click();
  const reviewRow = panel.getByRole("listitem", { name: /^Review, Seen tale · Chapter One/ });
  ok((await reviewRow.getByRole("link", { name: "Open", exact: true }).getAttribute("href")) === `/c/${story.chapter_id}/desk`, "an automatic review's Open link goes to that chapter's desk");
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/c/${story.chapter_id}/desk`);
  ok(await until(async () => (await itemOf("run:seen-e2e-review"))?.data.seen === true, "the review seen"), "opening the chapter's desk marks its finished automatic review seen");
  ok(await until(async () => (await label()) === "Queue: 1 ready", "one ready"), "…the header then counts only the other chapter's review: " + (await label()));
  ok((await itemOf("run:seen-e2e-review-other"))?.data.seen === undefined, "…which was left alone");
  // With the desk open, a review of its chapter that finishes is looked at as it arrives, and the header never counts it.
  await add("run:seen-e2e-live", "run", "done", run("seen-e2e-live", review));
  ok(await until(async () => (await itemOf("run:seen-e2e-live"))?.data.seen === true, "the live review seen"), "a review of the open desk's chapter that finishes meanwhile is marked seen");
  ok((await label()) === "Queue: 1 ready", "…and the header still counts only the other chapter's review: " + (await label()));
  await page.setViewportSize({ width: 400, height: 900 });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px the desk doesn't scroll sideways");
} finally {
  for (const key of made) await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(key)}`).catch(() => {});
  await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent("gen:new:" + story.chapter_id)}`).catch(() => {});
  await call("DELETE", `/api/drafts/${encodeURIComponent("new:" + story.chapter_id)}`).catch(() => {});
  await putSettings(before ?? {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
