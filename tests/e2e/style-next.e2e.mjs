// Story style notes reach the prompts and are edited, with the title, summary and story-wide codex,
// on the story details page.
import http from "node:http";
import { launch, startStory } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const prompts = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content, user = body.messages.at(-1).content;
    prompts.push({ system, user });
    let text = "# Generated\n\nGenerated text here.";
    if (system.includes("running summary")) text = JSON.stringify({ summary: "S", story_so_far: "SF" });
    else if (system.includes("button text and nothing else")) text = "Carry on";
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const json = async (method, url, body) =>
  (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
// The next chapter prompt the AI is sent (the server makes the request a moment after the click, so it is waited for).
const chapterPrompts = () => prompts.filter((p) => p.system.includes("Output format"));
let consumed = 0;
const nextChapterPrompt = async () => {
  for (let i = 0; i < 100 && chapterPrompts().length <= consumed; i++) await new Promise((r) => setTimeout(r, 100));
  consumed = chapterPrompts().length;
  return chapterPrompts().at(-1)?.user ?? "";
};

const settingsBefore = (await json("GET", "/api/settings")).settings;
await json("PUT", "/api/settings", { ...(settingsBefore ?? {}), autoSuggestChoices: false, connections: [{ id: "t", name: "Test", kind: "ollama", baseUrl: "http://localhost:3222/v1", apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } });

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// ---- a new story with style notes ----
await startStory(page, BASE, { title: "Styled tale", style: "STYLE-NEW: first person." });
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
ok((await nextChapterPrompt()).includes("Style notes from the author (follow these in everything you write):\nSTYLE-NEW: first person."), "a new story's style notes go into the prompt");
ok((await page.getByRole("button", { name: "Post and write next" }).count()) === 0, "there is no “Post and write next” button");

await page.getByPlaceholder("Choice 1").fill("Left");
await page.getByRole("button", { name: "+ Add choice" }).click();
await page.getByPlaceholder("Choice 2").fill("Right");
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
const root = /\/c\/([^/?]+)/.exec(page.url())[1];
await page.locator("a.card.choice-unwritten", { hasText: "Right" }).click();
await page.waitForURL(/\/write\?choice=/);
const rootData = await json("GET", `/api/chapters/${root}`);
const right = rootData.choices.find((c) => c.label === "Right");
ok(page.url().endsWith(`choice=${right.id}`), "posting, then opening a choice from the chapter, goes to writing it");
ok((await page.getByLabel(/Choice text/).inputValue()) === "Right", "…with its choice text filled in");
const story = await json("GET", `/api/stories/${rootData.chapter.story_id}`);
ok(story.style === "STYLE-NEW: first person.", "the style notes are saved with the story");

// ---- the writing page shows the notes; they are edited on the story details page ----
const writeUrl = page.url();
ok(await page.getByText(/Style notes: STYLE-NEW/).isVisible(), "the writing page shows the story's style notes");
ok((await page.locator("textarea").evaluateAll((els) => els.map((e) => e.value))).every((v) => !v.includes("STYLE-NEW")), "…but they can't be edited there");
await page.getByRole("link", { name: "Edit story details" }).waitFor();

await page.goto(`${BASE}/`);
const card = page.locator(".story-card", { hasText: "Styled tale" });
await card.getByLabel("Options for Styled tale").click();
await card.getByRole("link", { name: "Story details" }).click();
await page.waitForURL(`${BASE}/s/${story.id}/details`);
ok((await page.getByLabel(/^Style notes/).inputValue()) === "STYLE-NEW: first person.", "the details page opens from the story's menu, with the style notes");
await page.getByLabel("Story title").fill("Styled tale, renamed");
await page.getByLabel(/^Summary/).fill("A SUMMARY of the tale.");
await page.getByLabel(/^Style notes/).fill("STYLE-EDITED: third person.");
await page.getByRole("button", { name: "Save story details" }).click();
await page.getByText("Story details saved.").waitFor();
const edited = await json("GET", `/api/stories/${story.id}`);
ok(edited.style === "STYLE-EDITED: third person." && edited.title === "Styled tale, renamed" && edited.premise === "A SUMMARY of the tale.", "saving stores the title, summary and style notes");

await page.getByRole("button", { name: "+ New entry" }).click();
await page.getByLabel("Name", { exact: true }).fill("Lantern");
ok(!(await page.getByLabel(/Takes effect from/).count()), "a story-wide entry has no chapter to pick");
await page.getByRole("button", { name: "Add entry" }).click();
await page.getByRole("heading", { name: "Lantern", level: 1 }).waitFor();
const rootCodex = await json("GET", `/api/chapters/${root}/codex`);
ok(rootCodex.ops.some((o) => o.name === "Lantern" && o.anchor_chapter_id === root), "a codex entry added there is anchored at the first chapter");

await page.goto(writeUrl);
await page.getByText(/Style notes: STYLE-EDITED/).waitFor();
ok(true, "the writing page shows the saved notes");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
const editedPrompt = await nextChapterPrompt();
ok(editedPrompt.includes("STYLE-EDITED: third person.") && !editedPrompt.includes("STYLE-NEW"), "…and drafting uses them");

// ---- a second chapter ----
await page.getByPlaceholder("Choice 1").fill("Onward");
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
await page.locator("a.card.choice-unwritten", { hasText: "Onward" }).click();
await page.waitForURL((u) => u.href.includes("/write?choice=") && !u.href.endsWith(right.id));
ok((await page.getByLabel(/Choice text/).inputValue()) === "Onward", "…and the next chapter's choice opens for writing");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
ok((await nextChapterPrompt()).includes("STYLE-EDITED: third person."), "a later chapter's prompt uses the saved notes");

// ---- plain post still goes to the chapter ----
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
ok(true, "“Post chapter” still opens the posted chapter");

await json("PUT", "/api/settings", settingsBefore ?? {});
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);
