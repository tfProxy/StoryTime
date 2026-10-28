import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const prompts = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    prompts.push(JSON.parse(data || "{}").messages?.at(-1)?.content ?? "");
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "# T\n\nHello there." } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// root -> A (choice A2 unwritten), root -> B
const story = await post("/api/stories", { title: "Horse Tale", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Go to A", "Go to B"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "Chapter A", body: "Mira trotted.", choices: ["Gallop"] })).chapter_id;
const B = (await post("/api/chapters", { choice_id: choices[1].id, title: "Chapter B", body: "Quiet." })).chapter_id;
const gallop = (await (await fetch(`${BASE}/api/chapters/${A}`)).json()).choices[0];

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE, { main: "m", cheap: null });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

const editor = page.locator(".entry-editor");
const card = page.locator(".entry-card", { hasText: "Mira" });
// (By the fact's own line: a form that is open holds its text in a textarea, which also counts as the row's text.)
const fact = (t) => editor.locator(".fact-row").filter({ has: page.locator(".fact-line", { hasText: t }) });

// create an entry at the root: the list's New entry form, then the entry's own page
await page.goto(`${BASE}/c/${root}/codex`);
await page.getByRole("button", { name: "+ New entry" }).click();
await page.getByLabel("Name", { exact: true }).fill("Mira");
await page.getByLabel("Type").selectOption("character");
await page.getByLabel(/Keywords/).fill("the thief, Mir");
await page.getByRole("button", { name: "Add entry" }).click();
await page.getByRole("heading", { name: "Mira", level: 1 }).waitFor();
ok(new RegExp(`/s/${story.story_id}/codex/[^/]+\\?at=${root}$`).test(page.url()), "adding an entry opens its page, at this chapter: " + page.url());
ok((await editor.locator(".entry-keywords").innerText()).includes("the thief, Mir"), "the keywords show on the entry page");
await editor.getByRole("button", { name: "Edit details" }).click();
await page.getByLabel(/Always include/).check();
await page.getByRole("button", { name: "Save changes" }).click();
await editor.getByText("always included").waitFor();
// Only facts reach the AI prompts, so give Mira one at the root.
await editor.getByRole("button", { name: "+ Add a fact" }).click();
await page.getByLabel("Aspect").first().fill("Appearance");
await page.getByLabel("Fact", { exact: true }).fill("A human thief with a scar.");
await page.getByRole("button", { name: "Save", exact: true }).click();
await fact("A human thief with a scar.").waitFor();
await page.goto(`${BASE}/c/${root}/codex`);
await card.getByText("A human thief with a scar.").waitFor();
ok(await card.getByText("changed in this chapter").isVisible(), "new entry's card shows 'changed in this chapter'");
ok((await card.innerText()).includes("Keywords: the thief, Mir"), "the card shows the keywords");

// inherited in A; change the notes there
await page.goto(`${BASE}/c/${A}/codex`);
await card.getByText("A human thief with a scar.").waitFor();
ok((await page.getByText("changed in this chapter").count()) === 0, "inherited entry isn't marked as changed here");
await card.click();
await editor.waitFor();
ok(page.url().endsWith(`?at=${A}`), "the card opens the entry page at this chapter");
await editor.getByRole("button", { name: "Edit", exact: true }).last().click();
await page.getByLabel("Notes", { exact: true }).fill("She is shy.");
await editor.getByRole("button", { name: "Save", exact: true }).click();
await editor.getByText("She is shy.").waitFor();

// history + restore
await editor.getByText(/History \(3\)/).click();
ok(await editor.locator("ol.history li").first().innerText().then((t) => /Changed/.test(t) && /content/.test(t)), "history lists the change");
await editor.getByRole("button", { name: "Restore this version" }).first().click();
await editor.getByText("No notes.").waitFor();
await editor.locator("ol.history li").nth(3).waitFor();
ok(true, "restore adds a new version (history now 4)");
// the horse, for the isolation checks: change the fact at A
await fact("A human thief with a scar.").getByRole("button", { name: "Edit" }).click();
await page.getByLabel("Fact", { exact: true }).fill("Now a horse. Cannot speak.");
await page.getByRole("button", { name: "Save", exact: true }).click();
await fact("Now a horse. Cannot speak.").waitFor();
ok(await fact("Now a horse").getByText("changed here").isVisible(), "the fact changed at A is anchored at A");

// branch isolation
await page.goto(`${BASE}/c/${B}/codex`);
await card.getByText("A human thief with a scar.").waitFor();
ok((await page.getByText("Now a horse").count()) === 0, "branch B still sees the human Mira");
await page.goto(`${BASE}/c/${root}/codex`);
await card.getByText("A human thief with a scar.").waitFor();
ok((await page.getByText("Now a horse").count()) === 0, "root unaffected by the change at A");

// prompts carry the branch's codex
await page.goto(`${BASE}/c/${A}/write?choice=${gallop.id}`);
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Hello there"));
const p = prompts.at(-1);
ok(p.includes("Mira [character] (also: the thief, Mir): Appearance: Now a horse. Cannot speak (just changed)."), "continuation on A gets the horse entry (its fact changed at A, the chapter before)");
ok(!p.includes("human thief with a scar"), "…and not the old version");
await page.goto(`${BASE}/c/${B}`);
await page.getByRole("link", { name: "Draft a different idea" }).click();
await page.getByLabel(/Choice text/).fill("Wander");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Hello there"));
ok(prompts.at(-1).includes("A human thief with a scar."), "continuation on B gets the human entry");

// retire at A, from the entry's page
await page.goto(`${BASE}/c/${A}/codex`);
await card.click();
await editor.getByRole("button", { name: "Retire" }).click();
await page.getByRole("heading", { name: "Retired" }).waitFor();
ok(page.url().endsWith(`/c/${A}/codex`), "retiring goes back to the chapter's codex");
ok((await page.getByText("Now a horse").count()) === 0, "retired entry leaves the list");
await page.getByRole("button", { name: "Bring back" }).click();
await card.getByText("Now a horse. Cannot speak.").waitFor();
ok(true, "bring back restores it");
await page.goto(`${BASE}/c/${A}`);
await page.locator(".site-menu > summary").click();
ok(await page.getByRole("link", { name: "Codex", exact: true }).isVisible(), "codex link in the chapter page menu");

await browser.close(); mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
