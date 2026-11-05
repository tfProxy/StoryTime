// Out-of-date entries in the Story Bible's Codex section: a card says how many chapters mention the entry since its last
// change (from 3), a change starts the count again, and "Most out of date first" sorts by it.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// Root -> One -> Two -> Three -> Four, every chapter naming Mira; Oda only in the first.
const story = await post("/api/stories", { title: "Stale Tale", premise: "p", chapter: { title: "Root", body: "Mira and Oda met.", choices: ["Go on"] } });
const ids = [story.chapter_id];
for (const title of ["One", "Two", "Three", "Four"]) {
  const choice = (await (await fetch(`${BASE}/api/chapters/${ids.at(-1)}`)).json()).choices[0];
  ids.push((await post("/api/chapters", { choice_id: choice.id, title, body: `Mira walked on (${title}).`, choices: title === "Four" ? [] : ["Go on"] })).chapter_id);
}
const create = async (name, type) => (await post("/api/codex", { anchor_chapter_id: ids[0], op: "create", name, type, aliases: [] })).entry_id;
const oda = await create("Oda", "character");
const mira = await create("Mira", "character");
for (const e of [mira, oda]) await post("/api/codex/facts", { anchor_chapter_id: ids[0], entry_id: e, op: "set", aspect: "Look", text: "tall" });

const browser = await launch();
const page = await browser.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const card = (name) => page.locator(".entry-card", { hasText: name });
const order = () => page.locator(".entry-card strong").allInnerTexts();

await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex`);
await card("Mira").waitFor();
ok(await card("Mira").getByText("Mentioned in 4 chapters since last updated").isVisible(), "the whole story: chapters naming the entry since its last change");
ok(await card("Oda").locator(".codex-stale").count() === 0, "…not shown for an entry the later chapters don't name");
ok((await order()).join() === "Mira,Oda", "cards are in name order at first");

// The chapter view counts along its path.
await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex&chapter=${ids[2]}`);
await card("Mira").waitFor();
ok(await card("Mira").locator(".codex-stale").count() === 0, "at Two, only 2 chapters since: under the 3 that are shown");
await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex&chapter=${ids[3]}`);
await card("Mira").waitFor();
ok(await card("Mira").getByText("Mentioned in 3 chapters since last updated").isVisible(), "at Three, 3 chapters since");

// Sorting: rename so the stale entry sorts last by name, then sort by staleness.
await post("/api/codex", { anchor_chapter_id: ids[0], op: "replace", entry_id: mira, name: "Zia Mira", type: "character", aliases: ["Mira"], content: "", always_include: false });
await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex`);
await card("Zia Mira").waitFor();
ok((await order()).join() === "Oda,Zia Mira", "by name, the out-of-date entry is last");
await page.getByLabel("Most out of date first").check();
ok((await order()).join() === "Zia Mira,Oda", "Most out of date first puts it first");

// A change at Three starts the count again: one chapter (Four) since.
await post("/api/codex/facts", { anchor_chapter_id: ids[3], entry_id: mira, op: "set", aspect: "Mood", text: "tired" });
await page.reload();
await card("Zia Mira").waitFor();
ok(await card("Zia Mira").locator(".codex-stale").count() === 0, "a change later in the story starts the count again");
ok(await page.getByLabel("Most out of date first").count() === 0, "with nothing out of date, the sort switch isn't offered");

await browser.close();
process.exit(failed ? 1 : 0);
