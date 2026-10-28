import { launch, useMockAi } from "./browser.mjs";

// After a chapter is posted: the banner leads to the codex page with the check panel open (the codex check and its
// inbox are in codex-inbox.e2e.mjs).
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

async function makeStory(title, rootTitle, rootBody, aTitle, aBody) {
  const s = await post("/api/stories", { title, chapter: { title: rootTitle, body: rootBody, choices: ["Onward"] } });
  const choice = (await getJson(`/api/chapters/${s.chapter_id}`)).choices[0];
  const a = await post("/api/chapters", { choice_id: choice.id, title: aTitle, body: aBody });
  return { root: s.chapter_id, a: a.chapter_id };
}
const s1 = await makeStory("Single", "Start", "Mira stood in the market. Bram the smith waved.", "Horse", "Mira had turned into a horse.");
await post("/api/codex", { anchor_chapter_id: s1.root, op: "create", name: "Gideon", type: "character", content: "A smith." });

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/c/${s1.a}?posted=1`);
ok(await page.getByRole("link", { name: "Review codex for this chapter" }).isVisible(), "post-publish banner offers a codex review");
await page.getByRole("link", { name: "Review codex for this chapter" }).click();
await page.waitForURL(/codex\?review=1/);
ok(await page.locator("details.ai-panel").evaluate((d) => d.open), "review link opens the codex check panel");
ok(await page.getByRole("button", { name: "Check this chapter" }).isVisible(), "the panel has the check buttons");
ok((await page.getByRole("button", { name: "Scan for codex changes" }).count()) === 0, "the old whole-entry scan is gone");
ok(await page.locator(".entry-card", { hasText: "Gideon" }).isVisible(), "the codex page lists the entry as a card");

await browser.close();
await ai.restore();
process.exit(failed ? 1 : 0);
