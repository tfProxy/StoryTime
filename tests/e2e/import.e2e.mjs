import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

const s = await post("/api/stories", { title: "Import me", chapter: { title: "Only chapter", body: "the body", summary: "a summary", choices: [] } });
const json = await (await fetch(`${BASE}/api/stories/${s.story_id}/export?format=json`)).text();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "st-import-"));
const good = path.join(dir, "story.json");
const bad = path.join(dir, "bad.json");
fs.writeFileSync(good, json);
fs.writeFileSync(bad, '{"format":"nope"}');

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const dialogs = [];
page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });

await page.goto(BASE);
await page.locator(".site-menu > summary").click();
ok(await page.getByRole("button", { name: "Import a story (JSON)" }).isVisible(), "the main page menu offers an import");

await page.getByLabel("Story JSON file").setInputFiles(bad);
await page.waitForTimeout(500);
ok(dialogs.length === 1 && /isn't a StoryTime export/.test(dialogs[0]), "a bad file shows the reason: " + dialogs[0]);

await page.getByLabel("Story JSON file").setInputFiles(good);
await page.waitForURL((u) => u.pathname.startsWith("/c/") && !u.pathname.endsWith(s.chapter_id), { timeout: 10000 });
ok(!page.url().endsWith(s.chapter_id) && await page.getByRole("heading", { name: "Only chapter" }).isVisible(), "a good file opens the imported story");
await page.goto(BASE);
ok((await page.locator(".story-card", { hasText: "Import me" }).count()) === 2, "the copy is listed next to the original");

// Other pages don't get the import entry.
await page.locator(".site-menu > summary").click();
await page.goto(`${BASE}/settings`);
await page.locator(".site-menu > summary").click();
ok((await page.getByRole("button", { name: "Import a story (JSON)", includeHidden: true }).count()) === 0, "import is only on the main page");

await browser.close();
process.exit(failed ? 1 : 0);
