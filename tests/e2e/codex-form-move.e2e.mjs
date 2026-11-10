// Setting a form on the entry page: "From [chapter] Mira is [form]", the form until now (which becomes the normal form),
// how far along; no facts are moved. Then a vixen fact replaces the every-form one on its aspect while she is a vixen.
import { launch } from "./browser.mjs";
import { factRow, fillFact } from "./entryPage.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const describe = async (chapter) => (await (await fetch(`${BASE}/api/chapters/${chapter}/codex`)).json()).entries.find((e) => e.name === "Mira").description;

// root -> A -> B
const story = await post("/api/stories", { title: "Moon Well", premise: "p", chapter: { title: "Root", body: "Mira waited.", choices: ["Go to A"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "The Moon Well", body: "Mira changed.", choices: ["On"] })).chapter_id;
const toB = (await (await fetch(`${BASE}/api/chapters/${A}`)).json()).choices[0];
const B = (await post("/api/chapters", { choice_id: toB.id, title: "The Den", body: "Mira slept.", choices: [] })).chapter_id;
const entry = await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" });
for (const [aspect, text] of [["Ears", "round human ears"], ["Personality", "stubborn, quick to laugh"]]) {
  await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: entry.entry_id, op: "set", aspect, text });
}
const entryUrl = (at) => `${BASE}/s/${story.story_id}/codex/${entry.entry_id}?at=${at}`;

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const ed = page.locator(".entry-editor");
const formRow = ed.locator(".ef-form-row");

try {
  // From the chapter after this one: the form starts there.
  await page.goto(entryUrl(A));
  await formRow.getByRole("button", { name: "Set a form…" }).click();
  ok((await formRow.getByLabel("Form", { exact: true }).locator("option").allInnerTexts()).join("|") === "+ a new form…", "with no form yet, a new one is the only choice");
  await formRow.getByLabel("New form name").fill("vixen");
  await formRow.getByLabel("Form until now").fill("human");
  await formRow.getByLabel("From").selectOption({ label: "“The Den”" });
  ok((await ed.locator(".form-move").count()) === 0, "no facts to sort");
  await formRow.getByRole("button", { name: "Save", exact: true }).click();
  await formRow.locator(".facts-form", { hasText: "human" }).waitFor();
  ok((await formRow.innerText()).includes("Lasts until “The Den”, where Mira is vixen."), "here she stays in her normal form, until the chapter the change starts at");
  ok((await describe(B)).startsWith("Form: vixen.") && !(await describe(A)).includes("Form:"), "the form starts at the chosen chapter; before it she is in her normal form, which the AI isn't told");

  // At the den: a vixen fact replaces the every-form Ears.
  await page.goto(entryUrl(B));
  ok((await formRow.innerText()).includes("vixen") && (await formRow.innerText()).includes("normal form: human"), "the form row shows the form and the normal form");
  await factRow(page, "round human ears").locator("button.ef-main").click();
  await fillFact(page, { text: "tall fox ears", applies: "vixen only" });
  await ed.locator(".fact-line", { hasText: "tall fox ears" }).waitFor();
  ok(await ed.getByRole("heading", { name: "vixen only · the form now" }).isVisible(), "the vixen fact is under the vixen form");
  ok((await factRow(page, "round human ears").getAttribute("class")).includes("replaced"), "the every-form Ears stays, replaced while she is a vixen");
  const ai = await describe(B);
  ok(ai.includes("tall fox ears") && ai.includes("stubborn") && !ai.includes("round human ears"), "the AI reads the vixen Ears instead of the every-form one: " + ai);
  ok((await describe(root)).includes("round human ears"), "earlier chapters keep the every-form Ears");
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
