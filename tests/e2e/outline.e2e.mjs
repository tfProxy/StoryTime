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

await page.goto(`${BASE}/s/${s.story_id}`);
ok(await page.getByRole("link", { name: "Outline" }).isVisible(), "story page links to the outline");
await page.getByRole("link", { name: "Outline" }).click();
await page.waitForURL(/outline$/);
ok(await page.getByText(/5 chapters · 1 choice still to write/).isVisible(), "totals shown");
ok(await page.getByRole("link", { name: "Level 2" }).isVisible(), "shallow chapters are expanded");
ok(!(await page.getByRole("link", { name: "Level 4" }).isVisible()), "deep branches start collapsed");
// expand level 3 by clicking its summary
await page.locator("summary", { hasText: "Level 3" }).click();
ok(await page.getByRole("link", { name: "Level 4" }).isVisible(), "expanding reveals deeper chapters");
ok(await page.getByText("branch ends here").isVisible(), "dead ends are marked");
ok((await page.getByText("not written yet").count()) === 0, "unwritten choices are not listed in the outline");
ok((await page.getByRole("link", { name: "write it" }).count()) === 0, "no write links in the outline");

// downloads
await page.goto(`${BASE}/s/${s.story_id}`);
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /readable \(Markdown\)/ }).click()]);
ok(download.suggestedFilename() === "outline-story.md", "the Markdown link downloads a file named after the story: " + download.suggestedFilename());
const text = fs.readFileSync(await download.path(), "utf8");
ok(text.startsWith("# Outline story") && text.includes("## 1.1.1.1.1. Level 4"), "the downloaded file is the story");
const [twee] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Twine/ }).click()]);
ok(twee.suggestedFilename() === "outline-story.twee", "the Twine link downloads a .twee file");

await browser.close();
process.exit(failed ? 1 : 0);
