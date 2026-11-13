// The trash from the writing desk's ⋯ menu: Replace branch… and Move to trash… (when each is offered, their
// confirmations), the trashed chapter's page with Restore, and the outline's "Trashed branches" part.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const post = (url, body) => send("POST", url, body);
const getJson = (url) => send("GET", url);
const until = async (fn, what) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// Root -> A (-> A1 -> A1a, A2) and B.
const s = await post("/api/stories", { title: "Trash story", chapter: { title: "Trash root", body: "root", summary: "root sum", choices: ["Go A", "Go B"] } });
const [goA, goB] = (await getJson(`/api/chapters/${s.chapter_id}`)).choices;
const make = async (choice_id, title, choices = []) => (await post("/api/chapters", { choice_id, title, body: `${title} body`, summary: `${title} sum`, path_summary: `${title} path`, choices })).chapter_id;
const A = await make(goA.id, "Chapter A", ["Go A1", "Go A2"]);
const B = await make(goB.id, "Chapter B");
const [goA1, goA2] = (await getJson(`/api/chapters/${A}`)).choices;
const A1 = await make(goA1.id, "Chapter A1", ["Go deeper"]);
const A2 = await make(goA2.id, "Chapter A2");
const A1a = await make((await getJson(`/api/chapters/${A1}`)).choices[0].id, "Chapter A1a");
const live = async () => (await getJson("/api/stories")).find((x) => x.id === s.story_id).chapter_count;
const draftOf = async (id) => (await getJson(`/api/drafts/${encodeURIComponent(`edit:${id}`)}`)).draft;

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const settingsBefore = (await getJson("/api/settings")).settings;
const putSettings = (st) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(st) });
const dialogs = [];
const answer = (accept) => page.once("dialog", (d) => { dialogs.push(d.message()); return accept ? d.accept() : d.dismiss(); });
// The desk's ⋯ menu (in its top bar).
const menu = page.locator(".desk-bar .more-menu-items");
const openMenu = async () => { if (!(await menu.isVisible())) await page.locator(".desk-bar").getByLabel("More for this chapter").click(); };
const action = (name) => menu.getByRole("button", { name });
const edit = async (id) => { await page.goto(`${BASE}/c/${id}/desk`); await page.getByLabel("Chapter title").waitFor(); await openMenu(); };

try {
  // ---- what the menu offers ----
  await edit(s.chapter_id);
  ok(await action("Replace branch…").isEnabled(), "a chapter with chapters below offers Replace branch");
  ok(await action("Move to trash…").isDisabled() && (await action("Move to trash…").getAttribute("title")) === "The story's first chapter can't go to the trash.", "…but the story's first chapter can't be moved to the trash, and says why");

  await edit(B);
  ok(await action("Move to trash…").isEnabled() && await action("Replace branch…").isDisabled(), "a chapter with nothing below it offers Move to trash, not Replace branch");
  ok((await action("Replace branch…").getAttribute("title")) === "No chapter is written below this one.", "…and says why");

  // ---- phone width: the menu stays on screen ----
  await page.setViewportSize({ width: 390, height: 780 });
  await edit(A);
  const menuBox = await menu.boundingBox();
  ok(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, "at 390px the ⋯ menu is inside the window");
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---- Replace branch ----
  await edit(A);
  await page.locator(".desk-bar .more-menu > summary").click();
  await page.getByLabel("Chapter title").fill("Chapter A v2");
  await openMenu();
  answer(false);
  await action("Replace branch…").click();
  await until(async () => dialogs.length === 1, "the confirmation");
  ok(dialogs[0] === "Update “Chapter A” with the draft showing and move the 3 chapters below it to the trash? Their choices stay, unwritten.", "it asks, naming the chapters below: " + dialogs[0]);
  ok((await live()) === 6 && (await getJson(`/api/chapters/${A}`)).chapter.revision === 1, "Cancel changes nothing");
  await openMenu();
  answer(true);
  await action("Replace branch…").click();
  await page.locator(".desk-bar-note", { hasText: "Updated" }).waitFor();
  const a = await getJson(`/api/chapters/${A}`);
  ok(a.chapter.title === "Chapter A v2" && a.chapter.revision === 2, "OK updates the chapter in place as a new revision");
  ok((await live()) === 3 && a.choices.every((c) => c.child_chapter_id === null), "…and the chapters below are in the trash, their choices unwritten");
  await page.goto(`${BASE}/c/${A}`);
  ok((await page.locator("a.choice-unwritten").count()) === 2 && (await page.locator("a.choice-written").count()) === 0, "the chapter page shows both choices as unwritten");
  ok((await draftOf(A)) == null, "the edit's draft is gone");

  // ---- a trashed chapter ----
  await page.goto(`${BASE}/c/${A1}`);
  await page.getByText("This branch is in the trash.").waitFor();
  ok((await page.getByRole("button", { name: "Restore" }).count()) === 1, "the top of a trashed branch has a Restore button");
  await page.goto(`${BASE}/c/${A1a}`);
  await page.getByText("This branch is in the trash.").waitFor();
  ok((await page.getByRole("button", { name: "Restore" }).count()) === 0 && (await page.locator(`.trash-notice a[href="/c/${A1}"]`).count()) === 1, "a chapter inside it says which chapter to restore, with a link");
  await page.goto(`${BASE}/c/${A1}/desk`);
  await page.getByText("This chapter is in the trash.").waitFor();
  ok((await page.getByLabel("Chapter title").count()) === 0, "a trashed chapter has no editor on the desk");

  // ---- the outline ----
  const outlineUrl = `${BASE}/s/${s.story_id}/outline`;
  await page.goto(outlineUrl);
  await page.getByText(/chapters/).first().waitFor();
  ok((await page.locator(".outline-trashed").count()) === 0 && (await page.getByText("Chapter A1", { exact: false }).count()) === 0, "the outline leaves trashed branches out by default");
  const part = page.getByRole("checkbox", { name: /^Trashed branches/ });
  await page.goto(`${BASE}/settings#outline`);
  await part.waitFor();
  ok(!(await part.isChecked()), "Settings › Outline has Trashed branches, unticked at first");
  await part.check();
  await until(async () => (await getJson("/api/settings")).settings.outline.trashed === true, "Trashed branches to be turned on");
  await page.goto(outlineUrl);
  await page.getByText(/chapters/).first().waitFor();
  ok((await page.locator(`#c-${A1}.outline-trashed`).count()) === 1 && (await page.locator(`#c-${A1a}.outline-trashed`).count()) === 1 && (await page.locator(`#c-${A2}.outline-trashed`).count()) === 1, "with it on, the trashed chapters are in the outline, greyed");
  ok((await page.locator(`#c-${A1} .outline-trashed-label`).first().textContent()) === "(trashed)" && (await page.locator(`#c-${A}.outline-trashed`).count()) === 0 && (await page.locator(`#c-${B}.outline-trashed`).count()) === 0, "…each marked “trashed”, and the live chapters are not");
  ok((await page.locator(`#c-${A1}`).evaluate((el) => parseFloat(getComputedStyle(el.querySelector("summary, .outline-row")).opacity))) < 1, "…and drawn faded");
  // Restore from its page.
  await page.locator(`#c-${A1} > details > summary a`).first().click();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByText("This branch is in the trash.").waitFor({ state: "detached" });
  ok((await live()) === 5, "Restore brings back the branch (Chapter A1 and A1a)");
  ok((await page.locator("a.choice-written").count()) === 1 && (await page.locator("a.choice-unwritten").count()) === 0, "…and its choice shows a chapter again");
  await putSettings(settingsBefore ?? {});

  // ---- Move to trash ----
  await page.goto(`${BASE}/c/${A1}/desk`);
  await page.getByLabel("Chapter title").fill("Chapter A1 draft");
  await until(async () => (await draftOf(A1)) != null, "the edit's draft to be saved");
  await openMenu();
  answer(false);
  await action("Move to trash…").click();
  await until(async () => dialogs.length === 3, "the confirmation");
  ok(dialogs[2] === "Move “Chapter A1” and the 1 chapter below it to the trash?", "it asks, naming the chapters below: " + dialogs[2]);
  ok((await live()) === 5, "Cancel changes nothing");
  await openMenu();
  answer(true);
  await action("Move to trash…").click();
  await page.waitForURL(`${BASE}/c/${A}`);
  ok((await live()) === 3, "OK moves the chapter and the one below it to the trash, and lands on the parent");
  ok((await page.locator("a.choice-unwritten").count()) === 2, "the parent's choice is unwritten again");
  ok((await draftOf(A1)) == null, "the edit's draft is deleted");
  ok((await getJson(`/api/chapters/${A1}`)).chapter.title === "Chapter A1", "the unsaved edit was not kept");
} finally {
  await putSettings(settingsBefore ?? {});
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(`edit:${A}`)}`, { method: "DELETE" }).catch(() => {});
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(`edit:${A1}`)}`, { method: "DELETE" }).catch(() => {});
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(`edit:${B}`)}`, { method: "DELETE" }).catch(() => {});
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(`edit:${s.chapter_id}`)}`, { method: "DELETE" }).catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
