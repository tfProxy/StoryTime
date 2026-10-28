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

const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

const card = () => page.locator("article", { hasText: "Rowan" });
const line = (t) => card().locator(".fact-line", { hasText: t });
const addFact =async (fields) => {
  await page.getByRole("button", { name: "+ Add a fact" }).click();
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
await page.goto(`${BASE}/c/${root}/codex`);
ok(await card().getByText("A young traveller.").isVisible(), "notes shown for an entry without facts");
await addFact({ aspect: "Ears", text: "round human ears" });
await line("round human ears").waitFor();
ok(await card().getByText("from the start").isVisible(), "row says 'from the start' at the root");
ok(await card().getByText("Notes", { exact: true }).isVisible(), "paragraph is labelled Notes once facts exist");

// change at A
await page.goto(`${BASE}/c/${A}/codex`);
await line("round human ears").waitFor();
ok((await card().getByText("changed here").count()) === 0, "inherited fact is not 'changed here'");
await page.getByRole("button", { name: "+ Add a fact" }).click();
await page.getByLabel("Aspect").first().fill("ears");
await page.getByText("This replaces: round human ears").waitFor();
ok(true, "'This replaces' hint appears");
await page.getByLabel("Fact", { exact: true }).fill("tall russet fox ears");
await page.getByLabel("Quote from the chapter").fill("Her ears grew tall and russet.");
await page.getByRole("button", { name: "Save", exact: true }).click();
await line("tall russet fox ears").waitFor();
ok(await card().getByText("changed here").isVisible(), "changed fact is marked 'changed here'");
ok(await card().getByText("since “Chapter A”").isVisible(), "row says since Chapter A");
ok((await card().locator(".fact-line strong", { hasText: /^Ears$/ }).count()) === 1, "still one Ears row");

// history
await card().locator("details.fact-row summary").click();
ok(await card().locator("details.fact-row").getByText("round human ears").isVisible(), "history shows the old text");
ok(await card().locator("details.fact-row").getByText("Her ears grew tall and russet.").isVisible(), "history shows the quote");

// forms
await page.getByRole("button", { name: "+ Add a fact" }).click();
await page.getByLabel("Aspect").first().fill("Tail");
await page.getByLabel("Form", { exact: true }).selectOption({ label: "New form…" });
await page.getByLabel("New form name").fill("human");
await page.getByLabel("Fact", { exact: true }).fill("no tail at all");
await page.getByRole("button", { name: "Save", exact: true }).click();
await line("no tail at all").waitFor();
await page.getByRole("button", { name: "Set a form" }).click();
await page.getByLabel("Form name").fill("vixen");
await page.getByLabel("Form note").fill("change complete");
await page.getByRole("button", { name: "Save", exact: true }).click();
await card().getByText("Form: vixen").waitFor();
ok(await card().getByText(/change complete/).isVisible(), "form note shown");
await page.getByRole("button", { name: "+ Add a fact" }).click();
await page.getByLabel("Aspect").first().fill("Tail");
await page.getByLabel("Form", { exact: true }).selectOption({ label: "vixen" });
await page.getByLabel("Fact", { exact: true }).fill("a bushy russet tail");
await page.getByRole("button", { name: "Save", exact: true }).click();
await line("a bushy russet tail").waitFor();
ok(await card().getByText("human (not current: not sent to the AI)").isVisible(), "human group marked not current");
ok(await card().getByText("vixen (current)").isVisible(), "vixen group marked current");
ok(await card().getByRole("heading", { name: "Every form" }).isVisible(), "'Every form' heading shown once forms exist");
await card().getByRole("button", { name: "What the AI reads" }).click();
const ai = await card().locator(".fact-ai").innerText();
ok(ai.includes("a bushy russet tail") && ai.includes("tall russet fox ears"), "AI text has the vixen and every-form facts");
ok(!ai.includes("no tail at all"), "AI text leaves out the human-form fact");

// remove
const row = card().locator("details.fact-row", { hasText: "a bushy russet tail" });
await row.locator("summary").click();
await row.getByRole("button", { name: "Remove" }).click();
await line("a bushy russet tail").waitFor({ state: "detached" });
ok(true, "removed fact is gone");

await browser.close();
process.exit(failed ? 1 : 0);
