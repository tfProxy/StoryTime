import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const post = (url, body) => send("POST", url, body);

// A story with one good chapter (the root), one with no summary, and one edited after its summary was made.
const s = await post("/api/stories", { title: "Review story", chapter: { title: "Good root", body: "root", summary: "root sum", choices: ["a", "b"] } });
const choices = (await send("GET", `/api/chapters/${s.chapter_id}`)).choices;
const noSummary = (await post("/api/chapters", { choice_id: choices[0].id, title: "Missing one", body: "no summary here" })).chapter_id;
const stale = (await post("/api/chapters", { choice_id: choices[1].id, title: "Stale one", body: "first text", summary: "stale sum" })).chapter_id;
const patched = await send("PATCH", `/api/chapters/${stale}`, { base_revision: 1, title: "Stale one", body: "second text", summary: "stale sum" });
if (!patched.chapter && patched.error) { console.log("FAIL could not edit the chapter", patched.error); process.exit(1); }

const settingsBefore = (await send("GET", "/api/settings")).settings;
const putSettings = (s) => send("PUT", "/api/settings", s);

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

try {
  // Home page menu.
  await page.goto(BASE);
  await page.locator(".story-card", { hasText: "Review story" }).locator("summary").click();
  const menuLink = page.locator(".story-card", { hasText: "Review story" }).getByRole("link", { name: "Review", exact: true });
  ok((await menuLink.getAttribute("href")) === `/s/${s.story_id}/review`, "the story menu has a Review link");
  await menuLink.click();
  await page.waitForURL(`**/s/${s.story_id}/review`);

  // Unfiltered review page.
  ok(await page.getByRole("heading", { name: "Review", level: 1 }).isVisible(), "the review page opens");
  ok((await page.getByRole("link", { name: "Fix the summary" }).count()) === 2, "two issues are listed");
  const hrefs = await page.getByRole("link", { name: "Fix the summary" }).evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  ok(hrefs.includes(`/c/${noSummary}/summary`) && hrefs.includes(`/c/${stale}/summary`), "each has a Fix the summary link to its summary page");
  ok((await page.getByRole("link", { name: "Missing one" }).count()) === 1 && (await page.getByRole("link", { name: "Stale one" }).count()) === 1, "both problem chapters are named");
  ok((await page.getByRole("link", { name: "Good root" }).count()) === 0, "the good chapter is not listed");
  const redo = page.getByRole("link", { name: "Redo all the AI summaries" });
  ok((await redo.getAttribute("href")) === `/s/${s.story_id}/summaries`, "Redo all the AI summaries links to the summaries page");
  ok((await page.getByText("AI codex helper").count()) === 0, "no codex helper until a chapter is chosen");

  // Choosing a chapter in the codex form.
  await page.getByLabel("Check the codex of").selectOption(stale);
  await page.getByRole("button", { name: "Choose" }).click();
  await page.waitForURL(new RegExp(`review\\?chapter=${stale}`));
  ok(await page.getByText(/Showing .*Stale one.* only/).isVisible(), "choosing a chapter filters the page to it");
  ok((await page.getByRole("link", { name: "Fix the summary" }).count()) === 1 && (await page.getByRole("link", { name: "Redo all the AI summaries" }).count()) === 0, "only that chapter's issue is listed");
  ok(await page.getByText("AI codex helper").first().isVisible(), "the AI codex helper is shown for the chosen chapter");

  // Outline markers.
  await page.goto(`${BASE}/s/${s.story_id}/outline`);
  const row = (t) => page.locator("li", { has: page.getByRole("link", { name: t, exact: true }) }).last();
  const marker = (t) => row(t).locator("a.outline-review");
  ok((await marker("Missing one").innerText()).trim() === "⚠ 1" && (await marker("Stale one").innerText()).trim() === "⚠ 1", "both problem chapters show ⚠ 1");
  ok((await page.locator("a.outline-review").count()) === 2, "only the two problem chapters have a marker (none on the good one)");
  ok((await page.locator("summary", { hasText: "Good root" }).first().locator("a.outline-review").count()) === 0, "the good root has no marker on its own line");
  await page.locator(".site-menu > summary").click();
  ok((await page.getByRole("link", { name: "Review the story" }).getAttribute("href")) === `/s/${s.story_id}/review`, "the outline menu has Review the story");
  ok((await page.getByRole("link", { name: "Review the story" }).count()) === 1, "…exactly once");
  await marker("Missing one").click();
  await page.waitForURL(new RegExp(`/review\\?chapter=${noSummary}$`));
  ok(await page.getByText(/Showing .*Missing one.* only/).isVisible(), "the marker opens the review page filtered to that chapter");

  // Later / Dismiss / Undo on the filtered page for "Missing one".
  const fix = page.getByRole("link", { name: "Fix the summary" });
  const btn = (n) => page.getByRole("button", { name: n, exact: true });
  await btn("Later").click();
  await page.getByRole("heading", { name: "Later", level: 3 }).waitFor();
  ok((await page.getByRole("heading", { name: "Later", level: 3 }).isVisible()) && (await page.locator("li", { hasText: "Missing one" }).count()) === 1, "Later moves the issue under a Later heading");
  ok((await page.getByText("Nothing left to deal with here.").isVisible()), "…and the open list says nothing is left, not that the summary is fine");
  await btn("Back to the list").click();
  await page.getByRole("heading", { name: "Later", level: 3 }).waitFor({ state: "detached" });
  ok((await fix.count()) === 1 && (await btn("Dismiss").count()) === 1, "Back to the list returns it to the open issues");
  await btn("Dismiss").click();
  await page.getByText("Dismissed (1)").waitFor();
  ok((await fix.count()) === 0 && (await page.getByText("Dismissed (1)").isVisible()), "Dismiss removes it from the list and counts it under Dismissed (1)");
  await page.getByText("Dismissed (1)").click();
  ok(await page.getByText("A dismissed issue comes back if the chapter is edited.").isVisible(), "the Dismissed section explains that an edit brings it back");
  await page.goto(`${BASE}/s/${s.story_id}/outline`);
  ok((await marker("Missing one").count()) === 0 && (await marker("Stale one").count()) === 1, "a dismissed issue no longer shows the outline marker");
  await page.goto(`${BASE}/s/${s.story_id}/review?chapter=${noSummary}`);
  await page.getByText("Dismissed (1)").click();
  await btn("Undo").click();
  await fix.waitFor();
  ok((await fix.count()) === 1 && (await page.getByText("Dismissed (1)").count()) === 0, "Undo brings the issue back");

  // Turn the marker off in settings.
  await putSettings({ ...(settingsBefore ?? {}), outline: { summary: true, readToHere: true, headerPicture: true, footerPicture: true, illustrate: true, ...(settingsBefore?.outline ?? {}), review: false } });
  await page.goto(`${BASE}/s/${s.story_id}/outline`);
  ok((await page.getByRole("link", { name: "Good root" }).count()) === 1 && (await page.locator("a.outline-review").count()) === 0, "with Review marker off, no marker is shown");
} finally {
  await putSettings(settingsBefore ?? {});
  await browser.close();
}
// Settings are restored; the story is left in place like the other tests' stories.
process.exit(failed ? 1 : 0);
