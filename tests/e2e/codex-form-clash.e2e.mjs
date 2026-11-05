// Facts that clash between forms: an every-form fact whose aspect a form also describes is listed above the Facts, with a
// button that moves it to the form it still fits (from where it was set), or removes it when every form has its own.
import { launch } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// root -> A. Mira is human from the root and a vixen from A, where her ears are given for the vixen form.
const story = await post("/api/stories", { title: "Clashing Ears", premise: "p", chapter: { title: "Root", body: "Mira waited.", choices: ["Go to A"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "The Moon Well", body: "Mira changed.", choices: [] })).chapter_id;
const entry = (await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).entry_id;
const fact = (anchor, aspect, text, form = "") => post("/api/codex/facts", { anchor_chapter_id: anchor, entry_id: entry, op: "set", aspect, form, text });
await fact(root, "Ears", "round human ears");
await fact(root, "Hair", "long red hair");
await fact(root, "Personality", "stubborn");
await fact(root, "Form", "", "human");
await fact(A, "Form", "", "vixen");
await fact(A, "Ears", "tall fox ears", "vixen");
await fact(A, "Hair", "a red coat", "vixen");
await fact(A, "Hair", "short red hair", "human");
const entryUrl = (at) => `${BASE}/s/${story.story_id}/codex/${entry}?at=${at}`;

const browser = await launch();
const context = await browser.newContext();
await unfoldEntryFolds(context);
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const ed = page.locator(".entry-editor");
const clashes = ed.locator(".form-clashes");

await page.goto(entryUrl(A));
await clashes.waitFor();
ok(await clashes.getByText("while Mira is in that form, the AI reads both").isVisible(), "the clash notice says why it matters");
const rows = clashes.locator("li");
ok(await rows.count() === 2, "both clashing facts are listed (Ears and Hair), Personality is not");
const ears = rows.filter({ hasText: "round human ears" });
ok((await ears.innerText()).includes("tall fox ears") && (await ears.innerText()).includes("(vixen)"), "a clash shows the form's own fact beside the every-form one");
const hair = rows.filter({ hasText: "long red hair" });
ok(await hair.getByText("Every form has its own Hair, so this one isn't needed.").isVisible(), "when every form has its own, the fix is to remove it");
await ears.getByRole("button", { name: "Make “Ears: round human ears” a human fact" }).click();
await rows.filter({ hasText: "round human ears" }).waitFor({ state: "detached" });
ok(await ed.getByText("human (not current: not sent to the AI)").isVisible(), "Move to human puts the fact under the human form");
await hair.getByRole("button", { name: "Remove “Hair: long red hair”" }).click();
await clashes.waitFor({ state: "detached" });
ok(true, "Remove it removes the last clash, and the notice goes");
const ai = await ed.locator(".fact-ai").innerText();
ok(ai.includes("tall fox ears") && !ai.includes("round human ears") && !ai.includes("long red hair"), "the AI no longer reads the clashing facts: " + ai);

// The move counts from where the fact was set: at the root Mira (human) still has her round ears.
await page.goto(entryUrl(root));
await ed.locator(".fact-ai").waitFor();
const rootAi = await ed.locator(".fact-ai").innerText();
ok(rootAi.includes("round human ears") && !rootAi.includes("long red hair"), "earlier chapters read the moved fact as the human form's, and the removed one is gone from the start: " + rootAi);
ok(await clashes.count() === 0, "…with no clash there");

await page.setViewportSize({ width: 390, height: 900 });
await page.goto(entryUrl(A));
await ed.locator(".fact-ai").waitFor();
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");

await browser.close();
process.exit(failed ? 1 : 0);
