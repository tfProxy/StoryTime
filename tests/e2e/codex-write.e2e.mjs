// The codex on the writing page: a drawer to view/add entries, and a preview of which entries go into a prompt.
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
    const last = JSON.parse(data || "{}").messages?.at(-1)?.content ?? "";
    prompts.push(last);
    const reply = last.includes("already suggested")
      ? JSON.stringify([{ choice: "Cross the river", direction: "She wades across." }])
      : last.includes("Suggest 4 distinct directions")
      ? JSON.stringify([{ choice: "Follow the ferryman", direction: "Mira trails Zed to the river." }, { choice: "Hide", direction: "She hides." }])
      : "# T\n\nHello there.";
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

const story = await post("/api/stories", { title: "Codex Write", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Go on"] } });
const root = story.chapter_id;
const choice = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices[0];
// Each entry has notes and one fact: only the facts reach the AI prompts, so an entry without a fact adds nothing to them.
const entry = async (name, content, fact, extra = {}) => {
  const made = await post("/api/codex", { anchor_chapter_id: root, op: "create", name, type: "character", content, ...extra });
  await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: made.entry_id, op: "set", aspect: "Role", text: fact });
};
await entry("Mira", "A thief with a scar.", "Quick with a lockpick.");
await entry("Zed", "A grumpy ferryman.", "Owns the river boat.");
await entry("Qux", "An unrelated hermit.", "Lives in a cave.");
await entry("The Rule", "Magic costs memories.", "Every spell takes a memory.", { type: "lore", always_include: true });

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE, { main: "m", cheap: null });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/c/${root}/write?choice=${choice.id}`);
const summary = page.locator("details.codex-preview > summary");
await summary.waitFor();
ok(/2 of 4 entries/.test(await summary.innerText()), "preview counts the entries that will be sent: " + (await summary.innerText()));
await summary.click();
const row = (name) => page.locator("li.codex-pick", { hasText: name });
ok(/mentioned/.test(await row("Mira").innerText()) && /always included/.test(await row("The Rule").innerText()), "each entry says why it is included");
ok(/not mentioned/.test(await row("Zed").innerText()), "unmentioned entries are listed separately");

// typing in the direction box triggers entries
await page.getByLabel(/What should happen/).fill("Zed rows the boat");
ok(/mentioned/.test(await row("Zed").innerText()) && !/not mentioned/.test(await row("Zed").innerText()), "what you type can pull an entry in");
ok(/3 of 4 entries/.test(await summary.innerText()), "the count follows");

// manual add / leave out
await row("Qux").getByRole("button", { name: "Add" }).click();
ok(/added by you/.test(await row("Qux").innerText()), "an entry can be added by hand");
await row("Mira").getByRole("button", { name: "Leave out" }).click();
ok(/left out by you/.test(await row("Mira").innerText()), "an entry can be left out");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Hello there"));
// (The chapter prompt is the one with the codex entries: the choice text and the suggestions are asked for after it.)
const p = prompts.findLast((x) => x.includes("Zed [character]")) ?? "";
ok(p.includes("Zed [character]") && p.includes("Qux [character]") && p.includes("The Rule [lore]"), "the prompt carries the chosen entries");
ok(!p.includes("Mira [character]"), "…and not the one that was left out");
await row("Mira").getByRole("button", { name: "Put back" }).click();
ok(/mentioned/.test(await row("Mira").innerText()), "a left-out entry can be put back");

// the drawer: add an entry without leaving the page (held in the draft)
await page.locator(".site-menu > summary").click();
await page.getByRole("button", { name: "Codex", exact: true }).click();
const drawer = page.locator("aside.codex-drawer");
await drawer.waitFor();
ok(await drawer.getByText("Quick with a lockpick.").isVisible(), "the drawer lists the entries with what the AI reads");
ok(!(await drawer.innerText()).includes("A thief with a scar."), "…and not the notes");
ok((await drawer.getByRole("link", { name: "Story Bible" }).getAttribute("href")).endsWith("/review?tab=codex"), "the drawer header links to the Story Bible");
await drawer.getByRole("button", { name: "+ New entry" }).click();
await drawer.getByLabel("Name", { exact: true }).fill("Newbie");
await drawer.getByLabel(/Keywords/).fill("the newcomer");
await drawer.getByRole("button", { name: "Add entry" }).click();
await drawer.getByRole("heading", { name: "Newbie" }).waitFor();
ok(await drawer.getByText("Post the chapter to add facts.").isVisible(), "a new entry opens in the drawer, and its facts wait for the post");
await drawer.getByRole("button", { name: "Edit", exact: true }).click();
await drawer.getByLabel("Notes", { exact: true }).fill("Added from the writing page.");
await drawer.getByRole("button", { name: "Save", exact: true }).click();
await drawer.locator(".entry-notes", { hasText: "Added from the writing page." }).waitFor();
await drawer.getByRole("button", { name: "← All entries" }).click();
await drawer.locator(".entry-card", { hasText: "Newbie" }).getByText("No facts yet").waitFor();
ok(true, "back to the list, where the new entry has no facts yet");
await page.getByRole("button", { name: "Close", exact: true }).click();
ok(/of 5 entries/.test(await summary.innerText()), "the preview picks up the new entry");
ok((await page.getByLabel("Chapter text").inputValue()).includes("Hello there"), "the draft was kept");

// read and edit an entry straight from the preview
await row("Zed").getByRole("button", { name: "Zed" }).click();
await row("Zed").getByText(/Owns the river boat/).waitFor();
ok(!(await row("Zed").innerText()).includes("A grumpy ferryman."), "clicking a name shows what the AI reads (the facts), not the notes");
await row("Zed").getByRole("button", { name: "Edit" }).click();
await drawer.getByRole("heading", { name: "Zed" }).waitFor();
ok(true, "Edit opens that entry in the drawer");
await drawer.getByRole("button", { name: "Edit", exact: true }).last().click();
await drawer.getByLabel("Notes", { exact: true }).fill("A cheerful ferryman now.");
await drawer.getByRole("button", { name: "Save", exact: true }).click();
await drawer.locator(".entry-notes", { hasText: "A cheerful ferryman now." }).waitFor();
ok(!(await drawer.locator(".fact-ai").innerText()).includes("cheerful"), "the notes are not in what the AI reads");
await page.getByRole("button", { name: "Close", exact: true }).click();
ok(!(await row("Zed").innerText()).includes("cheerful"), "the preview doesn't show the notes either");
const promptsBefore = prompts.length;
await page.getByRole("button", { name: "Generate a new draft" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
for (let i = 0; i < 50 && prompts.length === promptsBefore; i++) await new Promise((r) => setTimeout(r, 100));
ok(prompts.length > promptsBefore && prompts.slice(promptsBefore).every((x) => !x.includes("A cheerful ferryman now.")), "the next prompt leaves out the notes, edited or not");
await page.getByRole("button", { name: "+ New entry" }).click();
await drawer.getByLabel("Name", { exact: true }).waitFor();
ok(true, "+ New entry in the preview opens a blank form");
await page.getByRole("button", { name: "Close", exact: true }).click();

// changes are held in the draft until the chapter is posted
const codexAt = async (id) => (await (await fetch(`${BASE}/api/chapters/${id}/codex`)).json()).entries;
let atRoot = await codexAt(root);
ok(!atRoot.some((e) => e.name === "Newbie") && atRoot.find((e) => e.name === "Zed").content === "A grumpy ferryman.", "nothing is saved before posting");
ok(/changed in this draft/.test(await row("Zed").innerText()), "the preview marks entries changed in the draft");
ok(await page.getByText(/2 codex changes will be saved with this chapter/).isVisible(), "step 4 lists the held changes");
// …unless an earlier chapter is picked
await row("Qux").getByRole("button", { name: "Edit" }).click();
await drawer.getByLabel(/Keywords/).fill("the hermit");
await drawer.getByLabel(/Takes effect from/).selectOption({ label: "Root (saved now)" });
await drawer.getByRole("button", { name: "Save changes" }).click();
await drawer.getByText("none yet").waitFor({ state: "detached" });
await drawer.locator(".entry-keywords", { hasText: "the hermit" }).waitFor();
ok((await codexAt(root)).find((e) => e.name === "Qux").aliases.join() === "the hermit", "picking an earlier chapter saves straight away");
await page.getByRole("button", { name: "Close", exact: true }).click();
await page.getByLabel(/^Summary/).fill("A hermit appears.");
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+(\/summary)?\?/);
const posted = /\/c\/([^/?]+)/.exec(page.url())[1];
const atNew = await codexAt(posted);
ok(atNew.find((e) => e.name === "Zed").content === "A cheerful ferryman now." && atNew.some((e) => e.name === "Newbie"), "posting saves the held changes at the new chapter");
atRoot = await codexAt(root);
ok(atRoot.find((e) => e.name === "Zed").content === "A grumpy ferryman." && !atRoot.some((e) => e.name === "Newbie"), "…and the chapter before it is unchanged");

// ideas for a new branch
await page.goto(`${BASE}/c/${root}/write`);
await page.getByRole("button", { name: "Suggest ideas" }).click();
await page.getByText("Follow the ferryman").waitFor();
ok(/"Go on"/.test(prompts.at(-1)), "the ideas prompt knows the choices that already exist");
await page.locator("li.codex-pick", { hasText: "Follow the ferryman" }).getByRole("button", { name: "Use this" }).click();
ok((await page.getByLabel(/Choice text/).inputValue()) === "Follow the ferryman", "picking an idea fills the choice text");
ok((await page.getByLabel(/What should happen/).inputValue()) === "Mira trails Zed to the river.", "…and what should happen");

// more ideas make a new page; the first stays available
await page.getByRole("button", { name: "Suggest more" }).click();
await page.getByText("Cross the river").waitFor();
ok(/already suggested.*"Follow the ferryman"/.test(prompts.at(-1)), "asking for more tells the AI what it already suggested");
ok((await page.getByText("Page 2 of 2").count()) === 1 && (await page.locator("ul.codex-picks").getByText("Follow the ferryman").count()) === 0, "the new ideas get their own page");
await page.getByRole("button", { name: "Previous ideas" }).click();
await page.locator("ul.codex-picks").getByText("Follow the ferryman").waitFor();
ok((await page.locator("ul.codex-picks").getByText("Cross the river").count()) === 0, "the earlier page can be brought back");

// an idea can be added as a choice on the previous chapter, with its text edited first
await page.locator("li.codex-pick", { hasText: "Hide" }).getByRole("button", { name: "Add as choice" }).click();
await page.locator("li.codex-pick", { hasText: "Hide" }).getByLabel(/Choice text/).fill("Hide in the reeds");
await page.getByRole("button", { name: "Add choice", exact: true }).click();
await page.locator("li.codex-pick", { hasText: "Hide" }).getByText("Added as choice").waitFor();
const rootChoices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices.map((c) => c.label);
ok(rootChoices.includes("Hide in the reeds") && !rootChoices.includes("Hide"), "the edited text is added to the previous chapter");

await browser.close(); mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
