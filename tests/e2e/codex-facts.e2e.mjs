import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// root -> A
const story = await post("/api/stories", { title: "Fox Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["Go to A"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "Chapter A", body: "Rowan's ears changed.", choices: [] })).chapter_id;
const entry = await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Rowan", type: "character", aliases: [], content: "A young traveller.", always_include: false });
ok(!!entry.entry_id, "created an entry through the API");
const entryUrl = (at) => `${BASE}/s/${story.story_id}/codex/${entry.entry_id}?at=${at}`;

const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

const ed = page.locator(".entry-editor");
const line = (t) => ed.locator(".fact-line", { hasText: t });
const addFact = async (fields) => {
  await ed.getByRole("button", { name: "+ Add a fact" }).click();
  if (fields.aspect !== undefined) await page.getByLabel("Aspect", { exact: false }).first().fill(fields.aspect);
  if (fields.form) {
    const sel = page.getByLabel("Form", { exact: true });
    if ((await sel.locator("option", { hasText: fields.form }).count()) === 0) {
      await sel.selectOption({ label: "New form…" });
      await page.getByLabel("New form name").fill(fields.form);
    } else await sel.selectOption({ label: fields.form });
  }
  await page.getByLabel("Fact", { exact: true }).fill(fields.text);
  if (fields.quote) await page.getByLabel("Quote from the chapter").fill(fields.quote);
  await page.getByRole("button", { name: "Save", exact: true }).click();
};

// add Ears at the root
await page.goto(entryUrl(root));
ok(await ed.locator(".entry-notes", { hasText: "A young traveller." }).isVisible(), "notes shown on the entry page");
ok(await ed.locator(".fact-ai").getByText("Nothing yet").isVisible(), "…and the AI reads nothing while there are no facts");
await addFact({ aspect: "Ears", text: "round human ears" });
await line("round human ears").waitFor();
ok(await ed.getByText("from the start").isVisible(), "row says 'from the start' at the root");
ok(await ed.getByRole("heading", { name: "Your notes (not sent to the AI)" }).isVisible(), "the notes are labelled as not sent to the AI");
ok(!(await ed.locator(".fact-ai").innerText()).includes("A young traveller."), "…and are not in what the AI reads");

// change at A
await page.goto(entryUrl(A));
await line("round human ears").waitFor();
ok((await ed.locator(".fact-row").getByText("changed here").count()) === 0, "inherited fact is not 'changed here'");
await ed.getByRole("button", { name: "+ Add a fact" }).click();
await page.getByLabel("Aspect").first().fill("ears");
await page.getByText("This replaces: round human ears").waitFor();
ok(true, "'This replaces' hint appears");
await page.getByLabel("Fact", { exact: true }).fill("tall russet fox ears");
await page.getByLabel("Quote from the chapter").fill("Her ears grew tall and russet.");
await page.getByRole("button", { name: "Save", exact: true }).click();
await line("tall russet fox ears").waitFor();
ok(await ed.getByText("changed here").isVisible(), "changed fact is marked 'changed here'");
ok(await ed.getByText("since “Chapter A”").isVisible(), "row says since Chapter A");
ok((await ed.locator(".fact-line strong", { hasText: /^Ears$/ }).count()) === 1, "still one Ears row");

// history
const ears = ed.locator(".fact-row", { hasText: "tall russet fox ears" });
await ears.getByRole("button", { name: "History" }).click();
ok(await ears.getByText("round human ears").isVisible(), "history shows the old text");
ok(await ears.getByText("Her ears grew tall and russet.").isVisible(), "history shows the quote");

// forms
await addFact({ aspect: "Tail", form: "human", text: "no tail at all" });
await line("no tail at all").waitFor();
await ed.getByRole("button", { name: "Set a form" }).click();
await page.getByLabel("Form", { exact: true }).selectOption({ label: "New form…" });
await page.getByLabel("New form name").fill("vixen");
await page.getByLabel("Stage (optional)").fill("change complete");
ok(await ed.getByText("The AI will read: Form: vixen, change complete.").isVisible(), "the form form shows what the AI will read");
await page.getByRole("button", { name: "Save", exact: true }).click();
await ed.getByText("Form: vixen").first().waitFor();
ok(await ed.getByText(/change complete/).first().isVisible(), "form stage shown");
await addFact({ aspect: "Tail", form: "vixen", text: "a bushy russet tail" });
await line("a bushy russet tail").waitFor();
ok(await ed.getByText("human (not current: not sent to the AI)").isVisible(), "human group marked not current");
ok(await ed.getByText("vixen (current)").isVisible(), "vixen group marked current");
ok(await ed.getByRole("heading", { name: "Every form" }).isVisible(), "'Every form' heading shown once forms exist");
const ai = await ed.locator(".fact-ai").innerText();
ok(ai.includes("a bushy russet tail") && ai.includes("tall russet fox ears"), "AI text has the vixen and every-form facts");
ok(!ai.includes("no tail at all"), "AI text leaves out the human-form fact");

// remove
const row = ed.locator(".fact-row", { hasText: "a bushy russet tail" });
await row.getByRole("button", { name: "Remove" }).click();
await line("a bushy russet tail").waitFor({ state: "detached" });
ok(true, "removed fact is gone");

await browser.close();
process.exit(failed ? 1 : 0);
