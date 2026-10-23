import fs from "node:fs";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

// A story deep enough that the outline collapses its far branches.
const s = await post("/api/stories", { title: "Outline story", chapter: { title: "Level 0", body: "zero", summary: "sum 0", choices: ["a", "open one"] } });
let prev = s.chapter_id;
const ids = [prev];
for (let i = 1; i <= 4; i++) {
  const choice = (await getJson(`/api/chapters/${prev}`)).choices[0];
  prev = (await post("/api/chapters", { choice_id: choice.id, title: `Level ${i}`, body: `level ${i}`, summary: `sum ${i}`, choices: i < 4 ? ["next"] : [] })).chapter_id;
  ids.push(prev);
}
// Pictures: Level 1 has a header, Level 2 a footer, Level 3 both; the others none.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const savePicture = (id, slot) => fetch(`${BASE}/api/chapters/${id}/images/${slot}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
for (const [i, slot] of [[1, "header"], [2, "footer"], [3, "header"], [3, "footer"]]) {
  const r = await savePicture(ids[i], slot);
  if (!r.ok) { console.log("FAIL could not save a picture for the test", r.status, await r.text()); process.exit(1); }
}

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

await page.goto(BASE);
const menu = () => page.locator(".story-card", { hasText: "Outline story" }).locator("summary");
await page.locator(".story-card", { hasText: "Outline story" }).locator("a.story-link").click();
await page.waitForURL(new RegExp(`/c/${s.chapter_id}$`));
ok(await page.getByRole("heading", { name: "Level 0" }).isVisible(), "clicking a story opens its first chapter");
await page.goto(BASE);
await page.locator(".story-card", { hasText: "Outline story" }).getByRole("link", { name: /Outline of/ }).click();
await page.waitForURL(/outline$/);
ok(await page.getByText(/5 chapters · 1 choice still to write/).isVisible(), "totals shown");
ok((await page.locator(".outline-page .crumbs").count()) === 0 && (await page.getByRole("link", { name: /← Outline story/ }).count()) === 0 && (await page.getByRole("heading", { level: 1 }).innerText()) === "Outline", "the outline has no back link to the story above its heading");

// summaries: per chapter, and all at once
ok((await page.locator(".outline-summary").count()) === 0, "summaries start hidden");
await page.getByRole("button", { name: "summary", exact: true }).first().click();
await page.locator(".outline-summary").first().waitFor();
ok((await page.locator(".outline-summary").count()) === 1 && (await page.locator("li").first().locator("details").first().getAttribute("open")) !== null, "one chapter's summary opens without folding its branch");
await page.getByRole("button", { name: "Show all summaries" }).click();
await page.locator(".outline-summary").nth(4).waitFor();
ok((await page.locator(".outline-summary").count()) === 5, "show all opens every chapter's summary");
await page.getByRole("button", { name: "Hide all summaries" }).click();
await page.locator(".outline-summary").first().waitFor({ state: "detached" });
ok((await page.locator(".outline-summary").count()) === 0, "hide all closes them");
ok(await page.getByRole("link", { name: "Level 2" }).isVisible(), "shallow chapters are expanded");
ok(await page.getByRole("link", { name: "Level 4" }).isVisible(), "every branch starts expanded, however deep");
const mainWidth = await page.locator("main").evaluate((m) => m.getBoundingClientRect().width);
ok(mainWidth > 900, "the outline uses the whole window: " + Math.round(mainWidth) + "px");
await page.locator("summary", { hasText: "Level 3" }).click();
ok(!(await page.getByRole("link", { name: "Level 4" }).isVisible()), "a branch can still be folded away");
await page.locator("summary", { hasText: "Level 3" }).click();
await page.locator("summary", { hasText: "Level 2" }).getByRole("link", { name: "read to here" }).click();
await page.waitForURL(/\/path$/);
const readText = await page.locator("main").innerText();
ok(readText.includes("3. Level 2") && readText.includes("level 2") && !readText.includes("Level 3"), "read to here shows the route down to that chapter on one page");
await page.goBack();
ok((await page.getByText("branch ends here").count()) === 0, "dead ends are not tagged");
ok((await page.getByText("not written yet").count()) === 0, "unwritten choices are not listed in the outline");
ok((await page.getByRole("link", { name: "write it" }).count()) === 0, "no write links in the outline");

// pictures: icons in each chapter's [...] section
const rowOf = (title) => page.locator("summary", { hasText: title }).first();
const headerBtn = (title) => rowOf(title).getByRole("button", { name: "Show the header picture" });
const footerBtn = (title) => rowOf(title).getByRole("button", { name: "Show the footer picture" });
ok((await page.getByRole("button", { name: "Show the header picture" }).count()) === 2 && (await page.getByRole("button", { name: "Show the footer picture" }).count()) === 2, "only chapters with a header or footer get its icon (two of each here)");
ok((await headerBtn("Level 1").count()) === 1 && (await footerBtn("Level 1").count()) === 0 && (await footerBtn("Level 2").count()) === 1 && (await headerBtn("Level 2").count()) === 0 && (await headerBtn("Level 3").count()) === 1 && (await footerBtn("Level 3").count()) === 1 && (await headerBtn("Level 0").count()) === 0, "…each on the right chapter, and a chapter with both shows both");
const hbox = await headerBtn("Level 3").boundingBox(), fbox = await footerBtn("Level 3").boundingBox();
ok(Math.abs(hbox.y - fbox.y) < 4 && hbox.x < fbox.x, "the header icon comes before the footer icon, on the chapter's line");
ok((await headerBtn("Level 3").innerHTML()).includes("<svg") && (await headerBtn("Level 3").innerHTML()) !== (await footerBtn("Level 3").innerHTML()), "the two icons are drawn differently");
const brushes = page.getByRole("link", { name: "Illustrate this chapter" });
ok((await brushes.count()) === 5 && (await brushes.nth(2).getAttribute("href")) === `/c/${ids[2]}/illustrate` && (await brushes.nth(2).innerHTML()).includes("<svg"), "every chapter has a paintbrush linking to its Illustrate page");
const dlg = page.getByRole("dialog");
ok((await dlg.count()) === 0, "no picture is open at first");
await headerBtn("Level 1").click();
await dlg.waitFor();
ok((await dlg.getAttribute("aria-label")) === "Header picture of “Level 1”" && (await dlg.locator("img").getAttribute("src")).startsWith(`/api/chapters/${ids[1]}/images/header?v=`), "the header icon opens a popup with that chapter's header picture");
await page.waitForFunction(() => { const i = document.querySelector("dialog.outline-picture img"); return !!i && i.complete && i.naturalWidth > 0; });
ok(await page.getByRole("link", { name: "Level 2" }).isVisible() && (await page.locator("summary", { hasText: "Level 1" }).first().locator("xpath=..").getAttribute("open")) !== null, "…and opening it did not fold the branch");
await dlg.locator("img").click();
ok((await dlg.count()) === 1 && (await page.locator("summary", { hasText: "Level 1" }).first().locator("xpath=..").getAttribute("open")) !== null, "clicking the picture does not close the popup or fold the branch");
await page.keyboard.press("Escape");
await dlg.waitFor({ state: "detached" });
ok(true, "Esc closes the popup");
ok(await headerBtn("Level 1").evaluate((b) => b === document.activeElement), "…and puts the keyboard back on the icon");
await footerBtn("Level 2").click();
await dlg.waitFor();
ok((await dlg.getAttribute("aria-label")) === "Footer picture of “Level 2”" && (await dlg.locator("img").getAttribute("src")).includes(`/${ids[2]}/images/footer`), "the footer icon opens that chapter's footer picture");
await dlg.getByRole("button", { name: "Close" }).click();
await dlg.waitFor({ state: "detached" });
ok(true, "the Close button closes it");
await footerBtn("Level 3").click();
await dlg.waitFor();
await page.mouse.click(5, 5);
await dlg.waitFor({ state: "detached" });
ok(true, "a click outside the picture closes it");
await brushes.nth(1).click();
await page.waitForURL(new RegExp(`/c/${ids[1]}/illustrate$`));
ok(await page.getByRole("heading", { name: "Picture prompt" }).isVisible(), "the paintbrush opens that chapter's Illustrate page");
await page.goBack();
await page.getByText(/5 chapters/).waitFor();

// Settings → Outline: each part of the [...] section can be turned off
const settingsNow = async () => (await getJson("/api/settings")).settings;
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const settingsBefore = await settingsNow();
const until = async (fn, what) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};
const outlineUrl = page.url();
await page.goto(`${BASE}/settings#outline`);
// The tab named in the address is chosen after the page hydrates, so wait for it.
ok(
  await until(async () => (await page.getByRole("tab", { name: "Outline" }).getAttribute("aria-selected")) === "true", "the Outline tab to be chosen"),
  "Settings has an Outline tab, which /settings#outline opens",
);
const part = (name) => page.getByRole("checkbox", { name: new RegExp(`^${name}`) });
const PARTS = ["Summary", "Read to here", "Header picture", "Footer picture", "Illustrate"];
await part("Summary").waitFor();
ok((await Promise.all(PARTS.map((p) => part(p).isChecked()))).every(Boolean), "…with the five parts all ticked at first");
const outlineNow = async () => (await settingsNow()).outline;
const look = async () => {
  await page.goto(outlineUrl);
  await page.getByText(/5 chapters/).waitFor();
  return {
    summaries: await page.getByRole("button", { name: "summary", exact: true }).count(),
    all: await page.getByRole("button", { name: /all summaries/ }).count(),
    reads: await page.getByRole("link", { name: "read to here" }).count(),
    headers: await page.getByRole("button", { name: "Show the header picture" }).count(),
    footers: await page.getByRole("button", { name: "Show the footer picture" }).count(),
    brushes: await page.getByRole("link", { name: "Illustrate this chapter" }).count(),
    brackets: await page.locator(".outline-actions").count(),
  };
};
const show = async (name, on) => {
  await page.goto(`${BASE}/settings#outline`);
  await part(name).waitFor();
  await part(name)[on ? "check" : "uncheck"]();
};

let seen = await look();
ok(seen.summaries === 5 && seen.all === 1 && seen.reads === 5 && seen.headers === 2 && seen.footers === 2 && seen.brushes === 5 && seen.brackets === 5, "the outline shows every part at first");
await show("Summary", false);
await until(async () => (await outlineNow()).summary === false, "Summary to be turned off");
seen = await look();
ok(seen.summaries === 0 && seen.all === 0 && seen.reads === 5 && seen.brushes === 5, "with Summary off there are no summary buttons and no Show all summaries, and the rest stays");
await show("Summary", true);
await show("Read to here", false);
await until(async () => (await outlineNow()).readToHere === false && (await outlineNow()).summary === true, "Read to here to be turned off");
seen = await look();
ok(seen.reads === 0 && seen.summaries === 5 && seen.headers === 2, "with Read to here off its links go, and the rest stays");
ok(!(await page.locator(".outline-actions").first().innerText()).includes(","), "…without a stray comma between the parts left");
await show("Read to here", true);
await show("Header picture", false);
await until(async () => (await outlineNow()).headerPicture === false && (await outlineNow()).readToHere === true, "Header picture to be turned off");
seen = await look();
ok(seen.headers === 0 && seen.footers === 2 && seen.reads === 5, "with Header picture off only the header icons go");
await show("Header picture", true);
await show("Footer picture", false);
await until(async () => (await outlineNow()).footerPicture === false && (await outlineNow()).headerPicture === true, "Footer picture to be turned off");
seen = await look();
ok(seen.footers === 0 && seen.headers === 2, "with Footer picture off only the footer icons go");
await show("Footer picture", true);
await show("Illustrate", false);
await until(async () => (await outlineNow()).illustrate === false && (await outlineNow()).footerPicture === true, "Illustrate to be turned off");
seen = await look();
ok(seen.brushes === 0 && seen.footers === 2 && seen.summaries === 5, "with Illustrate off the paintbrushes go");
await putSettings({ ...settingsBefore, outline: { summary: false, readToHere: false, headerPicture: false, footerPicture: false, illustrate: false } });
seen = await look();
ok(seen.brackets === 0 && !(await page.locator(".outline-page").innerText()).includes("["), "with every part off the brackets go too");
await putSettings({ ...settingsBefore, outline: { summary: false, readToHere: false, headerPicture: false, footerPicture: false, illustrate: true } });
seen = await look();
ok(seen.brackets === 5 && seen.brushes === 5 && seen.summaries === 0, "with only Illustrate on, each chapter has just its paintbrush in the brackets");
await putSettings(settingsBefore ?? {});

// from a chapter page
await page.goto(`${BASE}/c/${prev}`);
await page.locator(".site-menu > summary").click();
await page.locator(".menu-sub > summary").click();
const [chDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Markdown" }).click()]);
const chText = fs.readFileSync(await chDl.path(), "utf8");
ok(chText.includes("## 1. Level 0") && chText.includes("## 5. Level 4") && chText.includes("*The end.*"), "a chapter page can export the route to it");

// tags: under the chapter's title, and in the outline once Settings shows them
const tagName = `Mild ${Date.now()}`;
const tag = await post("/api/tags", { name: tagName, applies: "when it is mild", not_applies: "when it is not" });
await post(`/api/chapters/${ids[1]}/tags`, { tag_id: tag.id, value: null });
await page.goto(`${BASE}/c/${ids[1]}`);
ok((await page.locator(".chapter-tags").innerText()) === `[${tagName}]` && (await page.locator(".crumbs a").first().getAttribute("href")) === `/s/${s.story_id}/outline`, "a chapter shows its approved tags in brackets under the title, and the story name links to the outline");
await show("Tags", true);
await until(async () => (await outlineNow()).tags === true, "Tags to be turned on");
await page.goto(outlineUrl);
ok((await page.locator(".outline-actions", { hasText: `[${tagName}]` }).count()) === 1, "with Tags on the outline shows each chapter's tags in their own brackets");
await show("Tags", false);
await until(async () => (await outlineNow()).tags === false, "Tags to be turned off");
seen = await look();
ok(!(await page.locator(".outline-page").innerText()).includes(tagName), "with Tags off the outline has no tags");

// downloads
await page.goto(BASE);
await menu().click();
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /readable \(Markdown\)/ }).click()]);
ok(download.suggestedFilename() === "outline-story.md", "the Markdown link downloads a file named after the story: " + download.suggestedFilename());
const text = fs.readFileSync(await download.path(), "utf8");
ok(text.startsWith("# Outline story") && text.includes("## 1.1.1.1.1. Level 4"), "the downloaded file is the story");
const [twee] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Twine/ }).click()]);
ok(twee.suggestedFilename() === "outline-story.twee", "the Twine link downloads a .twee file");

await browser.close();
process.exit(failed ? 1 : 0);
