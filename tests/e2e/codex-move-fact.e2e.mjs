// A fact's ⋯ › "Move to an earlier chapter…" on a codex entry's page: pick an earlier chapter for the fact to hold from.
import { launch } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();

// Root -> The Gate -> The Market -> The Tower
const story = await post("/api/stories", { title: "Fact Line", premise: "p", chapter: { title: "Root", body: "Mira waited.", choices: ["Go"] } });
const root = story.chapter_id;
const next = async (from, title) => (await post("/api/chapters", { choice_id: (await get(`/api/chapters/${from}`)).choices[0].id, title, body: `${title}.`, choices: ["On"] })).chapter_id;
const gate = await next(root, "The Gate");
const market = await next(gate, "The Market");
const tower = await next(market, "The Tower");
const mira = (await post("/api/codex", { anchor_chapter_id: gate, op: "create", name: "Mira", type: "character" })).entry_id;
await post("/api/codex/facts", { anchor_chapter_id: gate, entry_id: mira, op: "set", aspect: "Ears", text: "Round ears." });
await post("/api/codex/facts", { anchor_chapter_id: tower, entry_id: mira, op: "set", aspect: "Hair", text: "Red hair." });
const hairAt = async (chapter) => (await get(`/api/chapters/${chapter}/codex`)).entries.find((e) => e.entry_id === mira)?.facts.find((f) => f.aspect === "Hair");

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
await unfoldEntryFolds(context);
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

await page.goto(`${BASE}/s/${story.story_id}/codex/${mira}?at=${tower}`);
await page.locator('summary[aria-label="More for Hair"]').click();
await page.getByRole("button", { name: "Move to an earlier chapter…" }).click();
const dialog = page.getByRole("dialog", { name: "Move to an earlier chapter" });
await dialog.waitFor();
await dialog.getByRole("radio", { name: /The Gate/ }).waitFor();
ok((await dialog.innerText()).includes("Hair: Red hair."), "the dialog names the fact");
ok(await dialog.getByRole("radio", { name: /The Tower/ }).isDisabled(), "where it is set now can't be picked");
ok((await dialog.getByRole("radio", { name: /Root/ }).count()) === 0, "chapters before the entry's start aren't offered");
ok(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), "nothing to move until a chapter is picked");
const box = await dialog.boundingBox();
ok(box.x >= 0 && box.x + box.width <= 390, "the dialog fits a phone screen");
await dialog.getByRole("radio", { name: /The Gate/ }).check();
ok((await dialog.locator(".entry-start-summary").innerText()).includes("It will hold from Ch. 2 “The Gate” on"), "says where it will hold from");
await dialog.getByRole("button", { name: "Move to Ch. 2" }).click();
await dialog.waitFor({ state: "detached" });
await page.getByText("since “The Gate”").nth(1).waitFor();
ok((await hairAt(market))?.text === "Red hair.", "the fact now holds at The Market");
ok((await page.locator(".fact-row", { hasText: "Red hair." }).innerText()).includes("since “The Gate”"), "the row says it holds since The Gate");

// At the entry's first chapter there is nowhere earlier to go: the item isn't offered.
await page.goto(`${BASE}/s/${story.story_id}/codex/${mira}?at=${gate}`);
await page.locator('summary[aria-label="More for Ears"]').click();
ok((await page.getByRole("button", { name: "Move to an earlier chapter…" }).count()) === 1, "the item shows for a fact set after the first chapter");
await page.getByRole("button", { name: "Move to an earlier chapter…" }).click();
await dialog.waitFor();
await dialog.getByText("There is no earlier chapter for it").waitFor();
ok(true, "a fact set where the entry first appears is told there is nowhere earlier");
await dialog.getByRole("button", { name: "Cancel" }).click();
await dialog.waitFor({ state: "detached" });

await browser.close();
process.exit(failed ? 1 : 0);
