import fs from "node:fs";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

// A story deep enough that the outline collapses its far branches.
const s = await post("/api/stories", { title: "Outline story", chapter: { title: "Level 0", body: "zero", choices: ["a", "open one"] } });
let prev = s.chapter_id;
const ids = [prev];
for (let i = 1; i <= 4; i++) {
  const choice = (await getJson(`/api/chapters/${prev}`)).choices[0];
  prev = (await post("/api/chapters", { choice_id: choice.id, title: `Level ${i}`, body: `level ${i}`, choices: i < 4 ? ["next"] : [] })).chapter_id;
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

// from a chapter page
await page.goto(`${BASE}/c/${prev}`);
await page.locator(".site-menu > summary").click();
await page.locator(".menu-sub > summary").click();
const [chDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Markdown" }).click()]);
const chText = fs.readFileSync(await chDl.path(), "utf8");
ok(chText.includes("## 1. Level 0") && chText.includes("## 5. Level 4") && chText.includes("*The end.*"), "a chapter page can export the route to it");

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
