// Setting a form: tick the every-form facts that are only true of the old form, say what they are like in the new one.
import { launch } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// root -> A
const story = await post("/api/stories", { title: "Moon Well", premise: "p", chapter: { title: "Root", body: "Mira waited.", choices: ["Go to A"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "The Moon Well", body: "Mira changed.", choices: [] })).chapter_id;
const entry = await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" });
for (const [aspect, text] of [["Ears", "round human ears"], ["Personality", "stubborn, quick to laugh"]]) {
  await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: entry.entry_id, op: "set", aspect, text });
}
const entryUrl = (at) => `${BASE}/s/${story.story_id}/codex/${entry.entry_id}?at=${at}`;

const browser = await launch();
const formMoveContext = await browser.newContext();
await unfoldEntryFolds(formMoveContext);
const page = await formMoveContext.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const ed = page.locator(".entry-editor");

await page.goto(entryUrl(A));
await ed.getByRole("button", { name: "Set a form" }).click();
await page.getByLabel("New form name").fill("vixen");
ok(!(await ed.locator(".form-move").isVisible()), "no facts to sort until the old form is named");
await page.getByLabel("Form until now").fill("human");
const move = ed.locator(".form-move");
await move.waitFor();
ok(await move.getByText("Which facts are only true of human?").isVisible(), "asks which facts are only true of the old form");
const earsBox = move.getByRole("checkbox", { name: /Ears: round human ears/ });
ok(!(await earsBox.isChecked()) && !(await move.getByRole("checkbox", { name: /Personality/ }).isChecked()), "nothing is ticked at first");
ok(await move.locator(".form-move-row", { hasText: "Ears" }).getByText("often differs").isVisible(), "a body fact is marked as often differing");
await earsBox.check();
await page.getByLabel("Ears as vixen").fill("tall fox ears");
ok((await page.getByLabel("Personality as vixen").count()) === 0, "only ticked facts get a box for the new form");
await page.getByRole("button", { name: "Save", exact: true }).click();

await ed.getByText("vixen (current)").waitFor();
ok(await ed.getByText("human (not current: not sent to the AI)").isVisible(), "the moved fact is under the old form");
ok(await ed.getByRole("heading", { name: "Every form" }).isVisible(), "the unticked fact stays under Every form");
ok(await ed.getByText("Normal form: human").isVisible(), "the old form is the normal form");
const ai = await ed.locator(".fact-ai").innerText();
ok(ai.includes("tall fox ears") && ai.includes("stubborn") && !ai.includes("round human ears"), "the AI reads the new form's facts and the every-form ones: " + ai);

// Before the change (at the root) Mira is human and the moved fact applies.
await page.goto(entryUrl(root));
await ed.getByText("human (current)").waitFor();
const rootAi = await ed.locator(".fact-ai").innerText();
ok(rootAi.includes("round human ears") && !rootAi.includes("fox"), "earlier chapters read the old form's facts: " + rootAi);

await browser.close();
process.exit(failed ? 1 : 0);
