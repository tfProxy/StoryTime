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
for (let i = 1; i <= 4; i++) {
  const choice = (await getJson(`/api/chapters/${prev}`)).choices[0];
  prev = (await post("/api/chapters", { choice_id: choice.id, title: `Level ${i}`, body: `level ${i}`, author_name: "Ann", choices: i < 4 ? ["next"] : [] })).chapter_id;
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
