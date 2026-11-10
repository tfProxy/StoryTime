// A form's own fact on an aspect an every-form fact also has: on the entry page the every-form fact is struck through and
// says the form's fact replaces it while the entry is in that form; What the AI is told names the replaced aspects. No
// notice, nothing to move. Earlier chapters, in the other form, read the every-form fact.
import { launch } from "./browser.mjs";
import { factRow } from "./entryPage.mjs";

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
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const ed = page.locator(".entry-editor");
const told = ed.locator(".entry-ai-told");

try {
  await page.goto(entryUrl(A));
  await told.waitFor();
  ok((await ed.locator(".form-clashes, .notice", { hasText: "the AI reads both" }).count()) === 0 && (await ed.getByRole("button", { name: /^Move to|^Make “/ }).count()) === 0, "no clash notice and nothing to move");
  const ears = factRow(page, "round human ears");
  const hair = factRow(page, "long red hair");
  ok((await ears.getAttribute("class")).includes("replaced") && (await ears.innerText()).includes("replaced by the vixen Ears while Mira is vixen"), "the every-form Ears is struck through, replaced by the vixen Ears");
  ok((await hair.getAttribute("class")).includes("replaced") && (await hair.innerText()).includes("replaced by the vixen Hair"), "…and so is the every-form Hair");
  ok(!(await factRow(page, "stubborn").getAttribute("class")).includes("replaced"), "Personality, which the vixen form doesn't describe, is not");
  ok(await ears.locator(".fact-line").evaluate((el) => getComputedStyle(el).textDecorationLine === "line-through"), "…drawn struck through");
  ok((await told.innerText()).includes("Mira's vixen facts replace the every-form Ears, Hair while Mira is vixen."), "What the AI is told names the replaced aspects");
  const ai = await told.locator(".fact-ai").innerText();
  ok(ai.includes("tall fox ears") && ai.includes("a red coat") && ai.includes("stubborn"), "the AI reads the vixen facts and the rest: " + ai);

  // At the root Mira is human: nothing is replaced, and the every-form facts are read.
  await page.goto(entryUrl(root));
  await told.waitFor();
  ok((await ed.locator(".ef-row.replaced").count()) === 0, "earlier, in the human form, nothing is struck through");
  const rootAi = await told.locator(".fact-ai").innerText();
  ok(rootAi.includes("round human ears") && rootAi.includes("long red hair"), "…and the AI reads the every-form facts: " + rootAi);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(entryUrl(A));
  await told.waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
