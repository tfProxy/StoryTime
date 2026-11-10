// "First appears in … · Change…" on a codex entry's page: pick an earlier or later chapter for the entry to start at.
import { launch } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();

// Root -> The Gate -> The Market -> The Tower
const story = await post("/api/stories", { title: "Start Line", premise: "p", chapter: { title: "Root", body: "Mira waited.", choices: ["Go"] } });
const root = story.chapter_id;
const next = async (from, title) => (await post("/api/chapters", { choice_id: (await get(`/api/chapters/${from}`)).choices[0].id, title, body: `${title}.`, choices: ["On"] })).chapter_id;
const gate = await next(root, "The Gate");
const market = await next(gate, "The Market");
const tower = await next(market, "The Tower");
const mira = (await post("/api/codex", { anchor_chapter_id: gate, op: "create", name: "Mira", type: "character" })).entry_id;
await post("/api/codex/facts", { anchor_chapter_id: gate, entry_id: mira, op: "set", aspect: "Ears", text: "Round ears." });
await post("/api/codex/facts", { anchor_chapter_id: market, entry_id: mira, op: "set", aspect: "Hair", text: "Red hair." });
const entryUrl = (at) => `${BASE}/s/${story.story_id}/codex/${mira}?at=${at}`;
const startOf = async () => (await get(`/api/chapters/${tower}/codex`)).ops.find((o) => o.entry_id === mira && o.op === "create").anchor_chapter_id;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
await unfoldEntryFolds(context);
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

await page.goto(entryUrl(tower));
const line = page.locator(".entry-start");
ok((await line.innerText()).includes("First appears in Ch. 2 “The Gate”"), "under the name: where the entry first appears: " + (await line.innerText()));
const change = line.getByRole("button", { name: "Change…" });
ok((await change.boundingBox()).height >= 44, "Change… is a full-size touch target");

// ---- earlier ----
await change.click();
const dialog = page.getByRole("dialog", { name: "Where Mira first appears" });
await dialog.waitFor();
const radio = (name) => dialog.getByRole("radio", { name });
ok(await radio(/The Gate/).isDisabled(), "the current start can't be picked…");
ok(await dialog.locator(".entry-start-option", { hasText: "The Gate" }).getByText("now").isVisible(), "…and is marked now");
ok(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), "nothing to move until a chapter is picked");
const box = (await dialog.boundingBox());
ok(box.x >= 0 && box.x + box.width <= 390, "the dialog fits a phone screen");
await radio(/Root/).check();
const summary = dialog.locator(".entry-start-summary");
ok((await summary.innerText()).includes("the first version of Mira and the 1 fact entered with it"), "says what moves: " + (await summary.innerText()));
ok((await summary.innerText()).includes("the 1 later fact, where it was set"), "…and what stays");
await dialog.getByRole("button", { name: "Move to Ch. 1" }).click();
await dialog.waitFor({ state: "detached" });
await page.locator(".entry-start", { hasText: "Ch. 1 “Root”" }).waitFor();
ok((await startOf()) === root, "the entry now starts at Root");
ok(await page.locator("#entry-history").getByText("Moved start from “The Gate” to “Root”").isVisible(), "History shows the move");

// ---- later, past a fact: asks to move it too ----
await page.locator(".entry-start").getByRole("button", { name: "Change…" }).click();
await dialog.waitFor();
ok(await dialog.locator(".entry-start-option", { hasText: "The Tower" }).getByText("1 fact or change in between").isVisible(), "a later chapter says how many facts lie in between");
await radio(/The Tower/).check();
ok((await dialog.locator(".entry-start-summary").innerText()).includes("won’t be in the codex before Ch. 4") || (await dialog.locator(".entry-start-summary").innerText()).includes("won't be in the codex before Ch. 4"), "moving later warns the earlier chapters lose it");
await dialog.getByRole("button", { name: "Move to Ch. 4" }).click();
ok(await dialog.getByText("Hair: Red hair.").isVisible(), "asks about the fact in between, listing it");
await dialog.getByRole("button", { name: "Cancel" }).click();
await dialog.waitFor({ state: "detached" });
ok((await startOf()) === root, "Cancel moves nothing");

await page.locator(".entry-start").getByRole("button", { name: "Change…" }).click();
await radio(/The Tower/).check();
await dialog.getByRole("button", { name: "Move to Ch. 4" }).click();
await dialog.getByRole("button", { name: "Move it too" }).click();
await dialog.waitFor({ state: "detached" });
await page.locator(".entry-start", { hasText: "Ch. 4 “The Tower”" }).waitFor();
ok((await startOf()) === tower, "the entry now starts at The Tower, with the fact moved along");

// Viewed at a chapter before the new start, the page moves on to where the entry now starts.
await page.locator(".entry-start").getByRole("button", { name: "Change…" }).click();
await radio(/The Gate/).check();
await dialog.getByRole("button", { name: "Move to Ch. 2" }).click();
await page.locator(".entry-start", { hasText: "Ch. 2 “The Gate”" }).waitFor();
await page.goto(entryUrl(gate));
await page.locator(".entry-start").getByRole("button", { name: "Change…" }).click();
await radio(/The Market/).check();
await dialog.getByRole("button", { name: "Move to Ch. 3" }).click();
await page.waitForURL((u) => u.searchParams.get("at") === market);
ok(true, "moving past the chapter on show opens the entry where it now starts");

await browser.close();
process.exit(failed ? 1 : 0);
