// The offline HTML export: opened straight from a file, with no server, it plays the story and
// remembers which chapters were read until the reader resets it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

// Start -> [Left -> end, Right -> end, Unfinished (only an unwritten choice)]
const s = await post("/api/stories", { title: "Offline <Tale>", premise: "A premise.", author_name: "Eve",
  chapter: { title: "Start", body: "It began.\n\nSecond paragraph </script><b>not bold</b>", author_name: "Eve", choices: ["Go left", "Go right", "Wait"] } });
const choices = (await getJson(`/api/chapters/${s.chapter_id}`)).choices;
const fill = (c, title, extra = {}) => post("/api/chapters", { choice_id: c.id, title, body: `${title} text`, author_name: "Bo", ...extra });
await fill(choices[0], "Left");
await fill(choices[1], "Right");
await fill(choices[2], "Unfinished", { choices: ["Later"] });

const html = await (await fetch(`${BASE}/api/stories/${s.story_id}/export?format=html`)).text();
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "storytime-html-")), "story.html");
fs.writeFileSync(file, html);
ok(!/https?:\/\//.test(html.replace(/<script id="story-data"[\s\S]*?<\/script>/, "")), "the file needs no network (no external links)");

const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());
const url = "file:///" + file.replace(/\\/g, "/");

await page.goto(url);
ok(await page.getByRole("heading", { name: "Offline <Tale>" }).isVisible(), "title page shows the title as text");
ok(await page.getByText("A premise.").isVisible(), "…and the premise");
ok(!(await page.getByText(/You have read/).isVisible()), "nothing is remembered on a first visit");

await page.getByRole("button", { name: "Start reading" }).click();
await page.getByRole("heading", { name: "Start" }).waitFor();
ok(await page.getByText("Second paragraph </script><b>not bold</b>").isVisible() && (await page.locator("main b").count()) === 0, "chapter text is shown as plain text, never as HTML");
ok((await page.locator(".prose p").count()) === 2, "blank lines split paragraphs");
ok(await page.getByRole("button", { name: /Go left/ }).isVisible() && await page.getByRole("button", { name: /Go right/ }).isVisible(), "choices are buttons");
ok(!(await page.getByText("Wait").isVisible()) && !(await page.getByText("Unfinished").count()), "a branch that is not finished is left out");

await page.getByRole("button", { name: /Go left/ }).click();
await page.getByRole("heading", { name: "Left" }).waitFor();
ok(await page.getByText("The end of this branch.").isVisible(), "an ending is marked");
await page.getByRole("button", { name: /Previous chapter/ }).click();
await page.getByRole("heading", { name: "Start" }).waitFor();
ok(/Go left\s*\(read\)/.test(await page.getByRole("button", { name: /Go left/ }).innerText()) && !/\(read\)/.test(await page.getByRole("button", { name: /Go right/ }).innerText()), "chapters already read are marked on their choices");

// closing and reopening remembers where you were and what you read
await page.getByRole("button", { name: /Go right/ }).click();
await page.getByRole("heading", { name: "Right" }).waitFor();
await page.close();
const again = await ctx.newPage();
again.on("dialog", (d) => d.accept());
await again.goto(url);
ok(await again.getByText("You have read 3 of 3 chapters.").isVisible(), "what was read is remembered across visits");
await again.getByRole("button", { name: /Continue where you left off: Right/ }).click();
await again.getByRole("heading", { name: "Right" }).waitFor();
ok(true, "it can continue where you left off");

// reset
await again.getByRole("button", { name: "Title page" }).click();
await again.getByRole("button", { name: "Forget what I have read" }).click();
await again.getByRole("button", { name: "Start reading" }).waitFor();
ok(!(await again.getByText(/You have read/).isVisible()) && !(await again.getByRole("button", { name: /Continue where/ }).count()), "reset forgets everything");
await again.reload();
ok(!(await again.getByText(/You have read/).isVisible()), "…and stays forgotten");
await again.getByRole("button", { name: "Start reading" }).click();
await again.getByRole("heading", { name: "Start" }).waitFor();
ok(!/\(read\)/.test(await again.getByRole("button", { name: /Go left/ }).innerText()), "no choices are marked after a reset");

await browser.close();
process.exit(failed ? 1 : 0);
