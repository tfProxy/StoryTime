// Renaming a form on the entry page ("vampire" was wrong, she is a demon): the form fact and the form's facts take the
// new name in every chapter, earlier ones too; renaming onto a form the entry already has is refused.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const mira = async (chapter) => (await (await fetch(`${BASE}/api/chapters/${chapter}/codex`)).json()).entries.find((e) => e.name === "Mira");

// root -> A
const story = await post("/api/stories", { title: "Red Hours", premise: "p", chapter: { title: "Root", body: "Mira waited.", choices: ["Go to A"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "The Bite", body: "Mira changed.", choices: [] })).chapter_id;
const entry = await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" });
await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: entry.entry_id, op: "set", aspect: "Eyes", text: "brown eyes" });
await post("/api/codex/form", { chapter_id: A, entry_id: entry.entry_id, base_form: "human", form: { name: "vampire", stage: "", anchor_chapter_id: A } });
await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: entry.entry_id, op: "set", aspect: "Eyes", form: "vampire", text: "red eyes" });

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const formRow = page.locator(".entry-editor .ef-form-row");

try {
  await page.goto(`${BASE}/s/${story.story_id}/codex/${entry.entry_id}?at=${A}`);
  await formRow.getByRole("button", { name: "Rename a form…" }).click();
  ok((await formRow.getByLabel("Form to rename").inputValue()) === "vampire", "the current form is picked");

  await formRow.getByLabel("New name").fill("human");
  await formRow.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByText("already has a human form").waitFor();
  ok(true, "renaming onto a form she already has is refused");

  await formRow.getByLabel("New name").fill("demon");
  await formRow.getByRole("button", { name: "Rename", exact: true }).click();
  await formRow.locator(".facts-form", { hasText: "demon" }).waitFor();
  const here = await mira(A);
  ok(here.form.name === "demon" && here.forms.includes("demon") && !here.forms.includes("vampire"), "she is a demon here: " + here.forms.join(", "));
  ok(here.description.includes("red eyes") && !here.description.includes("vampire"), "the AI reads the demon's facts: " + here.description);
  const before = await mira(root);
  ok(before.facts.some((f) => f.form === "demon" && f.text === "red eyes") && !before.facts.some((f) => f.form === "vampire"), "the form's facts are renamed in earlier chapters too");
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
