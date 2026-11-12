import { launch } from "./browser.mjs";
import { addFact, factRow, fillFact, openTab, rowAction } from "./entryPage.mjs";

// The facts on a codex entry's page: adding, changing from a chapter on, History, forms and their groups, Remove, and
// the editor's "Applies to" and change-or-correction choices.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const codexAt = async (chapter) => (await (await fetch(`${BASE}/api/chapters/${chapter}/codex`)).json()).entries.find((e) => e.name === "Rowan");

// root -> A -> B
const story = await post("/api/stories", { title: "Fox Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["Go to A"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "Chapter A", body: "Rowan's ears changed.", choices: ["On"] })).chapter_id;
const toB = (await (await fetch(`${BASE}/api/chapters/${A}`)).json()).choices[0];
const B = (await post("/api/chapters", { choice_id: toB.id, title: "Chapter B", body: "Rowan walked on.", choices: [] })).chapter_id;

const entry = await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Rowan", type: "character", aliases: [], content: "A young traveller.", always_include: false });
ok(!!entry.entry_id, "created an entry through the API");
const entryUrl = (at) => `${BASE}/s/${story.story_id}/codex/${entry.entry_id}?at=${at}`;

const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

const ed = page.locator(".entry-editor");
const line = (t) => ed.locator(".entry-facts .fact-line", { hasText: t });
const told = () => ed.locator(".entry-ai-told .fact-ai");

try {
  // add Ears at the root
  await page.goto(entryUrl(root));
  ok(!(await ed.innerText()).includes("A young traveller."), "an entry's old notes show nowhere on its page");
  ok(await told().getByText("Nothing yet").isVisible(), "the AI is told nothing while there are no facts");
  await addFact(page, { aspect: "Ears", text: "round human ears" });
  await line("round human ears").waitFor();
  ok(await factRow(page, "round human ears").getByText("from the start").isVisible(), "row says 'from the start' at the root");
  ok(!(await told().innerText()).includes("A young traveller."), "the notes are not in what the AI is told");
  ok((await page.locator(".ef-editor input[type=radio]").count()) === 0, "at the entry's first chapter there is no change-or-correction choice");

  // change at A: tapping the row opens its editor
  await page.goto(entryUrl(A));
  await line("round human ears").waitFor();
  ok((await ed.locator(".fact-row").getByText("changed here").count()) === 0, "inherited fact is not 'changed here'");
  await factRow(page, "round human ears").locator("button.ef-main").click();
  const editor = page.locator(".ef-editor");
  ok(await editor.getByRole("radio", { name: /a change in the story, from “Chapter A” on \(earlier chapters keep “round human ears”\)/ }).isChecked(), "editing offers 'a change in the story' (checked), saying earlier chapters keep the old text");
  ok(await editor.getByRole("radio", { name: /a correction: it was always so \(from “Root”\)/ }).isVisible(), "…or a correction from where the fact was set");
  await fillFact(page, { text: "tall russet fox ears" });
  await line("tall russet fox ears").waitFor();
  ok(await factRow(page, "tall russet fox ears").getByText("changed here").isVisible(), "changed fact is marked 'changed here'");
  ok(await factRow(page, "tall russet fox ears").getByText("since “Chapter A”").isVisible(), "row says since Chapter A");
  ok((await ed.locator(".entry-facts .ef-aspect", { hasText: /^Ears$/ }).count()) === 1, "still one Ears row");
  ok((await codexAt(root)).description.includes("round human ears"), "a change leaves the earlier chapter as it was");

  // add with the same aspect: "This replaces"
  await ed.getByRole("button", { name: "+ Add a fact" }).click();
  await editor.getByLabel("Aspect", { exact: true }).selectOption("Ears");
  await page.getByText("This replaces: tall russet fox ears").waitFor();
  ok(true, "'This replaces' hint appears");
  ok((await editor.getByLabel("Aspect", { exact: true }).locator("option", { hasText: /^Teeth$/ }).count()) === 1, "the Aspect select offers the category list (Teeth)");
  await editor.getByRole("button", { name: "Cancel" }).click();
  await page.goto(`${BASE}/settings#codex`);
  const cats = page.getByLabel("Fact categories for a character");
  await cats.waitFor();
  ok((await cats.inputValue()).includes("Sexual Characteristics"), "Settings → Codex shows the fact categories for a character, with Sexual Characteristics");
  await page.goBack();
  await ed.waitFor();

  // history, from the row's ⋯
  const ears = factRow(page, "tall russet fox ears");
  await rowAction(ears, "History");
  ok(await ears.locator(".history").getByText("round human ears").isVisible(), "history shows the old text");
  ok(await ears.locator(".history").getByText("Added", { exact: true }).isVisible() && (await ears.locator(".history").getByText("Changed", { exact: true }).isVisible()), "…with Added and Changed");

  // a correction: it was always so, from where the fact was set (here, where its current version was set)
  await addFact(page, { aspect: "Hair", text: "red hair" });
  await line("red hair").waitFor();
  await page.goto(entryUrl(B));
  await factRow(page, "red hair").locator("button.ef-main").click();
  await fillFact(page, { text: "auburn hair", kind: "correction" });
  await line("auburn hair").waitFor();
  ok(await factRow(page, "auburn hair").getByText("since “Chapter A”").isVisible(), "a correction is written where the fact was set, not here");
  ok((await codexAt(A)).description.includes("auburn hair") && !(await codexAt(A)).description.includes("red hair"), "…so it reads that way from there");
  await factRow(page, "auburn hair").locator("button.ef-main").click();
  await fillFact(page, { text: "auburn hair, cut short", kind: "change" });
  await line("cut short").waitFor();
  ok((await codexAt(A)).description.includes("Hair: auburn hair.") && (await codexAt(B)).description.includes("cut short"), "a change is written from this chapter on");

  // forms
  await page.goto(entryUrl(A));
  await addFact(page, { aspect: "Tail", applies: "human", text: "no tail at all" });
  // (With no form set, a form's facts are folded away: they aren't sent to the AI.)
  await line("no tail at all").waitFor({ state: "attached" });
  ok(await ed.locator(".ef-other summary", { hasText: "human only · not sent to the AI: no form is set (1 fact)" }).isVisible(), "a form's fact with no form set is folded away, saying why");
  const formRow = ed.locator(".ef-form-row");
  await formRow.getByRole("button", { name: "Set a form…" }).click();
  await formRow.getByLabel("Form", { exact: true }).selectOption({ label: "+ a new form…" });
  await formRow.getByLabel("New form name").fill("vixen");
  await formRow.getByLabel("How far along (optional)").fill("change complete");
  ok(await formRow.getByText("The AI will read: Form: vixen, change complete.").isVisible(), "the form panel shows what the AI will read");
  await formRow.getByRole("button", { name: "Save", exact: true }).click();
  // Wait for the saved line itself: the panel's preview already says "Form: vixen, change complete" before the save.
  ok(await formRow.locator(".facts-form", { hasText: "change complete" }).waitFor().then(() => true, () => false), "form stage shown");
  await addFact(page, { aspect: "Tail", applies: "vixen only", text: "a bushy russet tail" });
  await line("a bushy russet tail").waitFor();
  ok(await ed.locator(".ef-other summary", { hasText: "human only · not sent to the AI while Rowan is vixen (1 fact)" }).isVisible(), "the human facts are folded away, not sent to the AI");
  ok(!(await line("no tail at all").isVisible()), "…closed");
  ok(await ed.getByRole("heading", { name: "vixen only · the form now" }).isVisible(), "vixen group is the form now");
  ok(await ed.getByRole("heading", { name: "Every form" }).isVisible(), "'Every form' heading shown once forms exist");
  const ai = await told().innerText();
  ok(ai.includes("a bushy russet tail") && ai.includes("tall russet fox ears"), "AI text has the vixen and every-form facts");
  ok(!ai.includes("no tail at all"), "AI text leaves out the human-form fact");

  // Applies to: an every-form fact made "vixen only" gets a vixen version; the every-form one stays, replaced while she is vixen
  await factRow(page, "tall russet fox ears").locator("button.ef-main").click();
  const appliesTo = (await editor.getByLabel("Applies to").locator("option").allInnerTexts()).map((t) => t.trim());
  ok(appliesTo[0] === "every form" && appliesTo.at(-1) === "+ a new form…" && appliesTo.slice(1, -1).sort().join("|") === "human only|vixen only", "Applies to offers every form, each form only, and a new form: " + appliesTo.join("|"));
  await fillFact(page, { text: "huge fox ears", applies: "vixen only" });
  await line("huge fox ears").waitFor();
  const everyEars = factRow(page, "tall russet fox ears");
  ok((await everyEars.count()) === 1 && (await everyEars.getAttribute("class")).includes("replaced"), "the every-form Ears stays, struck through");
  ok((await everyEars.innerText()).includes("replaced by the vixen Ears while Rowan is vixen"), "…saying the vixen Ears replaces it");
  ok((await ed.locator(".entry-ai-told").innerText()).includes("Rowan's vixen facts replace the every-form Ears while Rowan is vixen."), "What the AI is told notes the replaced aspect");

  // remove, from the row's ⋯
  await rowAction(factRow(page, "a bushy russet tail"), "Remove from “Chapter A” on");
  await line("a bushy russet tail").waitFor({ state: "detached" });
  ok(true, "removed fact is gone");

  // the What the AI reads tab
  const panel = await openTab(page, "What the AI reads");
  ok((await panel.locator(".fact-ai").innerText()).includes("huge fox ears"), "the What the AI reads tab shows the AI's text");
  ok((await page.getByRole("tab", { name: "What the AI reads" }).getAttribute("aria-selected")) === "true" && (await page.getByRole("tab", { name: "History" }).getAttribute("aria-selected")) === "false", "…and is the selected tab");
  await page.getByRole("tab", { name: "What the AI reads" }).press("ArrowRight");
  ok((await page.getByRole("tab", { name: "History" }).getAttribute("aria-selected")) === "true", "the arrow keys move between the tabs");
  ok(await page.getByRole("tabpanel").locator("ol.history").isVisible(), "…and History shows the entry's versions");
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
