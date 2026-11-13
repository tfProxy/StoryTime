import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

// A story with two chapters.
const s = await post("/api/stories", { title: "Tabs story", chapter: { title: "Tab one", body: "first", summary: "sum 1", choices: ["go on"] } });
const choice = (await getJson(`/api/chapters/${s.chapter_id}`)).choices[0];
const second = (await post("/api/chapters", { choice_id: choice.id, title: "Tab two", body: "second", summary: "sum 2", choices: [] })).chapter_id;

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const tabs = () => page.getByRole("navigation", { name: "Story", exact: true });
const active = async () => (await tabs().locator('a[aria-current="page"]').allInnerTexts()).join(",");

await page.goto(`${BASE}/c/${second}`);
ok((await tabs().getByRole("link").allInnerTexts()).join(",") === "Read,Outline,Bible,Pictures,Details", "a chapter shows the tabs Read, Outline, Bible, Pictures, Details");
ok((await active()) === "Read", "…with Read active");
ok(await page.getByText("Tabs story", { exact: true }).first().isVisible(), "…and the story's title above them");

await tabs().getByRole("link", { name: "Outline" }).click();
await page.waitForURL(/\/outline$/);
ok((await active()) === "Outline", "Outline opens the outline with its tab active");

await tabs().getByRole("link", { name: "Bible" }).click();
await page.waitForURL(/\/review$/);
ok((await active()) === "Bible" && (await page.getByRole("heading", { name: "Story Bible", level: 1 }).isVisible()), "Bible opens the Story Bible with its tab active");

await tabs().getByRole("link", { name: "Pictures" }).click();
await page.waitForURL(/\/pictures$/);
ok((await active()) === "Pictures" && (await page.getByRole("heading", { name: "Make missing pictures" }).isVisible()), "Pictures opens Make missing pictures with its tab active");

await tabs().getByRole("link", { name: "Details" }).click();
await page.waitForURL(/\/details$/);
ok((await active()) === "Details", "Details opens the story details with its tab active");

await tabs().getByRole("link", { name: "Read" }).click();
await page.waitForURL(new RegExp(`/c/${s.chapter_id}$`));
ok((await active()) === "Read" && (await page.getByRole("heading", { name: "Tab one" }).isVisible()), "Read opens the first chapter");

await page.goto(`${BASE}/s/${s.story_id}/cover`);
ok((await active()) === "Pictures", "the cover page counts as Pictures");
await page.goto(`${BASE}/c/${second}/codex`);
ok((await active()) === "Bible", "a chapter's codex counts as Bible");

await page.goto(`${BASE}/c/${second}/desk`);
await page.getByLabel("Chapter title").waitFor();
ok((await tabs().count()) === 0, "the writing desk has no tabs");

await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${BASE}/c/${second}`);
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll at phone width");

await browser.close();
process.exit(failed ? 1 : 0);
