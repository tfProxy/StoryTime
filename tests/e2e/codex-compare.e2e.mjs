// Comparing the codex between two chapters: "Compare with" on an entry's page (what changed in it) and in the Story
// Bible's Codex section at a chapter (every entry that changed, appeared or left), earlier to later and across branches.
import { launch } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";
import { entryAction } from "./entryPage.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// Root -> The Moon Well ; Root -> The Wolf Road. Mira is human at the root; a vixen at the well; wolf-eared on the road.
const story = await post("/api/stories", { title: "Two Roads", premise: "p", chapter: { title: "Root", body: "Mira waited.", choices: ["The well", "The road"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const well = (await post("/api/chapters", { choice_id: choices[0].id, title: "The Moon Well", body: "Mira changed.", choices: [] })).chapter_id;
const road = (await post("/api/chapters", { choice_id: choices[1].id, title: "The Wolf Road", body: "Mira howled.", choices: [] })).chapter_id;
const mira = (await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character", aliases: [] })).entry_id;
const fact = (anchor, aspect, text, form = "") => post("/api/codex/facts", { anchor_chapter_id: anchor, entry_id: mira, op: "set", aspect, form, text });
await fact(root, "Ears", "round human ears");
await fact(root, "Personality", "stubborn");
await fact(root, "Form", "", "human");
await fact(well, "Form", "halfway", "vixen");
await fact(well, "Ears", "tall fox ears");
await fact(well, "Tail", "a bushy tail", "vixen");
await post("/api/codex", { anchor_chapter_id: well, op: "replace", entry_id: mira, name: "Mira", type: "character", aliases: ["Vix"], content: "", always_include: false });
const moon = (await post("/api/codex", { anchor_chapter_id: well, op: "create", name: "The Moon", type: "place", aliases: [] })).entry_id;
await post("/api/codex/facts", { anchor_chapter_id: well, entry_id: moon, op: "set", aspect: "Look", text: "full and silver" });
await fact(road, "Ears", "wolf ears");

const browser = await launch();
const context = await browser.newContext();
await unfoldEntryFolds(context);
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const compare = page.getByRole("region", { name: "Comparison" });
const line = (label) => compare.locator(".change-list li", { hasText: `${label}:` });

// ---- an entry's page: "Compare with a chapter…" in its ⋯ menu, then pick a chapter ----
await page.goto(`${BASE}/s/${story.story_id}/codex/${mira}?at=${well}`);
ok((await page.locator("#entry-compare").count()) === 0, "the comparison is out of the way until asked for");
await entryAction(page, "Compare with a chapter…");
await page.locator("#entry-compare").click();
await page.getByRole("searchbox", { name: "Search chapter titles" }).fill("Root");
await page.locator(".chapter-tree-results button").first().click();
await page.waitForURL(/compare=/);
await compare.waitFor();
ok(await compare.getByRole("heading", { name: "Changes since “Root”" }).isVisible(), "an earlier chapter: changes since it");
ok((await line("Form").innerText()).includes("human") && (await line("Form").innerText()).includes("vixen, halfway"), "the form, with its stage");
ok((await line("Ears").locator("del").innerText()) === "round human ears" && (await line("Ears").locator("ins").innerText()) === "tall fox ears", "a changed fact: before struck out, after marked");
ok((await line("Tail (vixen)").innerText()).includes("+ a bushy tail"), "an added fact, with its form");
ok((await line("Keywords").innerText()).includes("Vix"), "an added keyword");
ok((await compare.locator(".change-list li", { hasText: "Personality" }).count()) === 0, "an unchanged fact isn't listed");

// a later chapter, from the root
await page.goto(`${BASE}/s/${story.story_id}/codex/${mira}?at=${root}&compare=${well}`);
await compare.waitFor();
ok(await compare.getByRole("heading", { name: "Changes by “The Moon Well”" }).isVisible(), "a later chapter: changes by it, still earlier to later");
ok((await line("Ears").locator("ins").innerText()) === "tall fox ears", "…in the same direction");

// another branch
await page.goto(`${BASE}/s/${story.story_id}/codex/${mira}?at=${road}&compare=${well}`);
await compare.waitFor();
ok(await compare.getByRole("heading", { name: "Compared with “The Moon Well” (another branch)" }).isVisible(), "another branch: compared with it");
ok((await line("Ears").locator("del").innerText()) === "tall fox ears" && (await line("Ears").locator("ins").innerText()) === "wolf ears", "…from that chapter to this one");
await compare.getByRole("link", { name: "Stop comparing" }).click();
await page.waitForURL((u) => !u.search.includes("compare="));
ok(await compare.count() === 0, "Stop comparing goes back to the plain page");

// ---- the Story Bible at a chapter: every entry that differs ----
await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex&chapter=${well}&compare=${root}`);
await compare.waitFor();
ok(await compare.getByRole("heading", { name: "Changes since “Root”" }).isVisible(), "the codex compared with an earlier chapter");
const rowOf = (name) => compare.locator(".codex-compare-list > li", { hasText: name });
ok(await rowOf("Mira").locator(".change-list li").count() >= 4, "Mira's changes are listed");
ok((await rowOf("The Moon").innerText()).includes("added by “The Moon Well”"), "an entry added in between");
await rowOf("Mira").getByRole("link", { name: "Mira" }).click();
await page.waitForURL(new RegExp(`/codex/${mira}\\?at=${well}&compare=${root}`));
ok(true, "an entry's name opens its page, compared the same way");

await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex&chapter=${root}&compare=${well}`);
await compare.waitFor();
ok((await rowOf("The Moon").innerText()).includes("added by “The Moon Well”"), "…and from the root, the entry added later");

await page.setViewportSize({ width: 390, height: 900 });
await page.goto(`${BASE}/s/${story.story_id}/codex/${mira}?at=${well}&compare=${root}`);
await compare.waitFor();
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");

await browser.close();
process.exit(failed ? 1 : 0);
