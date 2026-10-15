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
await menu().click();
await page.getByRole("link", { name: "Outline", exact: true }).click();
await page.waitForURL(/outline$/);
ok(await page.getByText(/5 chapters · 1 choice still to write/).isVisible(), "totals shown");
ok(await page.getByRole("link", { name: "Level 2" }).isVisible(), "shallow chapters are expanded");
ok(await page.getByRole("link", { name: "Level 4" }).isVisible(), "every branch starts expanded, however deep");
const mainWidth = await page.locator("main").evaluate((m) => m.getBoundingClientRect().width);
ok(mainWidth > 900, "the outline uses the whole window: " + Math.round(mainWidth) + "px");
await page.locator("summary", { hasText: "Level 3" }).click();
ok(!(await page.getByRole("link", { name: "Level 4" }).isVisible()), "a branch can still be folded away");
await page.locator("summary", { hasText: "Level 3" }).click();
const [pathDl] = await Promise.all([page.waitForEvent("download"), page.locator("summary", { hasText: "Level 2" }).getByRole("link", { name: "export path" }).click()]);
const pathText = fs.readFileSync(await pathDl.path(), "utf8");
ok(/outline-story-level-2\.md$/.test(pathDl.suggestedFilename()) && pathText.includes("## 3. Level 2") && !pathText.includes("Level 3"), "export path downloads the route down to that chapter only");
ok((await page.getByText("branch ends here").count()) === 0, "dead ends are not tagged");
ok((await page.getByText("not written yet").count()) === 0, "unwritten choices are not listed in the outline");
ok((await page.getByRole("link", { name: "write it" }).count()) === 0, "no write links in the outline");

// from a chapter page
await page.goto(`${BASE}/c/${prev}`);
await page.locator(".site-menu > summary").click();
const [chDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export this path" }).click()]);
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
