import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

// A story with two chapters; the first has no summary yet.
const s = await post("/api/stories", { title: "Actions story", chapter: { title: "Act one", body: "first", choices: ["go on"] } });
const choice = (await getJson(`/api/chapters/${s.chapter_id}`)).choices[0];
const second = (await post("/api/chapters", { choice_id: choice.id, title: "Act two", body: "second", summary: "sum 2", choices: ["more"] })).chapter_id;

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const row = () => page.locator(".chapter-actions");
const more = () => page.locator(".more-menu-items");

// ---- the row ----
await page.goto(`${BASE}/c/${second}`);
await page.getByRole("heading", { name: "Act two" }).waitFor();
ok((await row().locator(":scope > a").allInnerTexts()).map((t) => t.trim()).join(",") === "Edit,Illustrate,Codex,Write ahead", "the row has Edit, Illustrate, Codex and Write ahead");
ok((await row().getByRole("link", { name: "Edit", exact: true }).getAttribute("href")) === `/c/${second}/desk`, "Edit opens the chapter on the writing desk");
ok((await row().getByRole("link", { name: "Desk", exact: true }).count()) === 0, "…and there is no separate Desk button");
ok((await row().getByRole("link", { name: "Write ahead", exact: true }).getAttribute("href")) === `/c/${second}/write-ahead`, "Write ahead goes to the write-ahead page");
const above = await page.evaluate(() => {
  const r = document.querySelector(".chapter-actions").getBoundingClientRect().top;
  return document.querySelector("h1").getBoundingClientRect().top < r && r < document.querySelector(".prose").getBoundingClientRect().top;
});
ok(above, "the row sits between the title and the text");

// ---- the ⋯ menu ----
ok(!(await more().isVisible()), "the ⋯ menu starts closed");
await row().getByLabel("More chapter actions", { exact: true }).click();
ok((await more().getByRole("link").allInnerTexts()).join("|") === "History|Read this path|Open in outline|Summary (missing)|Make missing pictures…|Retcon from here…", "the ⋯ menu lists History, Read this path, Open in outline, Summary, Make missing pictures and Retcon from here");
ok((await row().getByRole("link", { name: "Codex", exact: true }).getAttribute("href")) === `/s/${s.story_id}/review?tab=codex&chapter=${second}`, "Codex is a button in the row, not in the ⋯ menu");
// The Bible tab keeps the chapter being read.
ok((await page.locator(".story-tabs").getByRole("link", { name: "Bible" }).getAttribute("href"))?.endsWith(`/review?chapter=${second}`), "the Bible tab opens narrowed to this chapter");
const hrefs = await more().getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
ok(hrefs.join(" ") === `/c/${second}/history /c/${second}/path /s/${s.story_id}/outline#c-${second} /s/${s.story_id}/review?tab=summaries&chapter=${second} /s/${s.story_id}/pictures?from=${second} /s/${s.story_id}/review?tab=retcons&chapter=${second}&new=1`, "…with the right addresses");
await page.mouse.click(5, 400);
ok(!(await more().isVisible()), "clicking elsewhere closes it");
await row().getByLabel("More chapter actions", { exact: true }).click();
await more().getByRole("link", { name: "Read this path" }).click();
await page.waitForURL(`**/c/${second}/path`);
ok(true, "Read this path opens the path page");

// the first chapter has no summary
await page.goto(`${BASE}/c/${s.chapter_id}`);
await row().getByLabel("More chapter actions", { exact: true }).click();
ok(await more().getByRole("link", { name: "Summary (missing)" }).isVisible(), "a chapter without a summary shows Summary (missing)");

// ---- the ☰ menu has no chapter entries ----
await page.locator(".site-menu > summary").click();
const sideMenu = (await page.locator(".site-menu-items").innerText());
ok(!/Edit this chapter|Write ahead|Illustrate|Make missing|Read this path|Open in outline|Summary|Download|Export/.test(sideMenu) && sideMenu.includes("Story Bible") && sideMenu.includes("Settings"), "☰ on the reading page holds only app-wide entries and the Story Bible");
await page.locator(".site-menu > summary").click();

// ---- the breadcrumb ----
ok((await page.getByRole("navigation", { name: "Path so far" }).count()) === 0, "the first chapter has no breadcrumb");
await page.goto(`${BASE}/c/${second}`);
ok((await page.getByRole("navigation", { name: "Path so far" }).innerText()).includes("Act one"), "a later chapter still shows its path");

// ---- a chapter in the trash has no Edit or Write ahead ----
const t = await post("/api/chapters", { choice_id: (await getJson(`/api/chapters/${second}`)).choices[0].id, title: "Act three", body: "third", summary: "s3", choices: [] });
await fetch(`${BASE}/api/chapters/${t.chapter_id}/trash`, { method: "POST" });
await page.goto(`${BASE}/c/${t.chapter_id}`);
await page.getByRole("heading", { name: "Act three" }).waitFor();
ok((await row().locator(":scope > a").allInnerTexts()).map((x) => x.trim()).join(",") === "Illustrate,Codex", "a trashed chapter keeps only Illustrate and Codex in the row");

// ---- phone width ----
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${BASE}/c/${second}`);
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll at phone width");
ok(await page.evaluate(() => { const l = document.querySelector(".story-tabs"); return l.scrollWidth <= l.clientWidth; }), "all five story tabs fit at 390px");
await row().getByLabel("More chapter actions", { exact: true }).click();
ok(await page.evaluate(() => { const r = document.querySelector(".more-menu-items").getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }), "the ⋯ menu stays on screen at phone width");

// ---- Export on the details page ----
await page.setViewportSize({ width: 1100, height: 800 });
await page.goto(`${BASE}/s/${s.story_id}/details`);
const exp = page.locator("section", { has: page.getByRole("heading", { name: "Export", exact: true }) });
ok((await exp.getByRole("link").allInnerTexts()).join("|") === "Readable (Markdown)|To play offline (HTML)|Twine (Twee)|Everything (JSON)|Codex (Markdown)", "Details has an Export section with every download");
const eh = await exp.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
ok(eh.join(" ") === ["md", "html", "twee", "json"].map((f) => `/api/stories/${s.story_id}/export?format=${f}`).join(" ") + ` /api/chapters/${s.chapter_id}/codex?format=md`, "…at the same addresses the old menus used");
for (const h of eh) {
  const r = await fetch(BASE + h);
  ok(r.status === 200, `${h} returns 200`);
}
ok((await page.getByRole("link", { name: /^Read “/ }).count()) === 0, "the big Read button is gone from Details");

// ---- home story card: no downloads ----
await page.goto(`${BASE}/`);
const card = page.locator(".story-card", { hasText: "Actions story" });
await card.getByLabel("Options for Actions story").click();
ok((await card.locator(".story-menu-items").innerText()).replace(/\s+/g, " ").trim() === "Story details Story Bible", "the story card's menu has only Story details and Story Bible");

// ---- a story with no chapters still offers Start writing ----
const empty = await post("/api/stories", { title: "Empty actions" });
await page.goto(`${BASE}/s/${empty.story_id}/details`);
ok(await page.getByRole("link", { name: "Start writing" }).isVisible() && (await page.getByRole("heading", { name: "Export", exact: true }).count()) === 0, "a story with no chapter keeps Start writing and has no Export");

await browser.close();
process.exit(failed ? 1 : 0);
