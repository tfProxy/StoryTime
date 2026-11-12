// Hints on a codex entry's page: plain-code warnings above the Facts (never mentioned, long facts,
// chapter numbers, the same aspect written two ways), which go once the entry is fixed.
import { launch } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

const story = await post("/api/stories", { title: "Hinted", premise: "p", chapter: { title: "Root", body: "Oda watched the harbour.", choices: [] } });
const root = story.chapter_id;
const create = async (name, content = "") => (await post("/api/codex", { anchor_chapter_id: root, op: "create", name, type: "character", aliases: [], content, always_include: false })).entry_id;
const fact = (entry, aspect, text) => post("/api/codex/facts", { anchor_chapter_id: root, entry_id: entry, op: "set", aspect, text });

const notesOnly = await create("Oda", "A sailor who never smiles.");
const messy = await create("Brannoc");
await fact(messy, "Ears", "round ears");
await fact(messy, "Ear", "a notch in the left one");
await fact(messy, "Status", "badly hurt in chapter 2");
await fact(messy, "History", "born on the far coast, raised by his aunt in the salt marshes, sailed for ten years, lost his ship in a storm, and came home poorer than he left");

const browser = await launch();
const context = await browser.newContext();
await unfoldEntryFolds(context);
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const ed = page.locator(".entry-editor");
const hints = ed.getByRole("note", { name: "Hints" });
const open = async (entry) => {
  await page.goto(`${BASE}/s/${story.story_id}/codex/${entry}?at=${root}`);
  await ed.locator(".fact-ai").first().waitFor();
};

await open(notesOnly);
ok((await hints.count()) === 0, "an entry with no facts (and old notes) has no hints, not even unmentioned");

await open(messy);
const text = await hints.innerText();
ok(text.includes("Neither its name nor a keyword appears in the chapters up to here"), "named in no chapter up to here");
ok(text.includes("History is long (30 words)"), "a long fact, with its word count");
ok(text.includes("Status mentions a chapter"), "a fact that mentions a chapter number");
ok(text.includes("“Ears” and “Ear” are the same aspect written two ways"), "the same aspect written two ways");

// A keyword that appears in a chapter clears that hint.
await post("/api/codex", { anchor_chapter_id: root, op: "replace", entry_id: messy, name: "Brannoc", type: "character", aliases: ["Oda"], content: "", always_include: false });
await open(messy);
ok(!(await hints.innerText()).includes("Neither its name"), "a keyword that appears in a chapter clears the unmentioned hint");

// ---- the fixes ----
await hints.locator("li", { hasText: "History is long" }).getByRole("button", { name: "Edit History" }).click();
ok(await ed.locator(".fact-row", { hasText: "born on the far coast" }).getByLabel("Fact", { exact: true }).isVisible(), "Edit it opens the long fact's edit form");
await page.getByRole("button", { name: "Cancel" }).first().click();
await hints.getByRole("button", { name: "Keep “Ears: round ears”, remove “Ear: a notch in the left one”" }).click();
await ed.locator(".fact-line", { hasText: "a notch in the left one" }).waitFor({ state: "detached" });
ok(!(await hints.innerText()).includes("same aspect written two ways"), "Keep “Ears” removes the other one, and its hint goes");

// ---- the Story Bible: a count on each card, and always-included entries that crowd the prompt ----
const cardOf = (name) => page.locator(".entry-card", { hasText: name });
await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex`);
await cardOf("Brannoc").waitFor();
ok(await cardOf("Brannoc").getByText("⚠ 2 hints").isVisible(), "the whole-story card counts its entry's hints (long fact, chapter number)");
ok((await cardOf("Oda").getByText(/⚠/).count()) === 0, "…and an entry without hints has no count");
await page.goto(`${BASE}/s/${story.story_id}/review?tab=codex&chapter=${root}`);
await cardOf("Brannoc").waitFor();
ok(await cardOf("Brannoc").getByText("⚠ 2 hints").isVisible(), "…and so does the card at a chapter");
ok(await page.locator(".codex-always-load").count() === 0, "no always-included warning while they fit");

const lore = await create("The Old Law");
await post("/api/codex", { anchor_chapter_id: root, op: "replace", entry_id: lore, name: "The Old Law", type: "lore", aliases: [], content: "", always_include: true });
for (let i = 0; i < 40; i++) await fact(lore, `Rule ${i}`, `${"word ".repeat(199)}end`);
await page.reload();
const load = page.locator(".codex-always-load");
await load.waitFor();
ok((await load.innerText()).includes("The always-included entries (The Old Law) take about"), "always-included entries that crowd the prompt are named in a warning");

await page.setViewportSize({ width: 390, height: 900 });
await open(messy);
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");

await browser.close();
process.exit(failed ? 1 : 0);
