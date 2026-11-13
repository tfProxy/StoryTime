// Story style notes reach the prompts (written on the writing desk) and are edited, with the title, summary and
// story-wide codex, on the story details page.
import http from "node:http";
import { launch, startStory } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const prompts = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  // Which models Ollama has loaded (asked before a summary or suggestions): none.
  if (req.url?.endsWith("/api/ps")) { res.setHeader("content-type", "application/json"); return res.end('{"models":[]}'); }
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

const generate = async () => {
  await page.locator(".desk-gen-row").getByRole("button", { name: /^Generate/ }).click();
  await page.getByRole("button", { name: "Edit text" }).waitFor();
};
/** "What happens next?" under a posted chapter on the desk: adds a choice. */
const addChoice = async (label) => {
  await page.getByLabel("Add a new suggestion").fill(label);
  await page.getByRole("button", { name: "Add choice" }).click();
  await page.locator(".desk-next a.choice-unwritten", { hasText: label }).waitFor();
};

// ---- a new story with style notes ----
await startStory(page, BASE, { title: "Styled tale", style: "STYLE-NEW: first person." });
await generate();
ok((await nextChapterPrompt()).includes("Style notes from the author (follow these in everything you write):\nSTYLE-NEW: first person."), "a new story's style notes go into the prompt");
ok((await page.getByRole("button", { name: "Post and write next" }).count()) === 0, "there is no “Post and write next” button");

await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1/);
const root = /\/c\/([^/?]+)/.exec(page.url())[1];
await addChoice("Left");
await addChoice("Right");
await page.locator(".desk-next a.choice-unwritten", { hasText: "Right" }).click();
await page.waitForURL(/\/desk\?choice=/);
const rootData = await json("GET", `/api/chapters/${root}`);
const right = rootData.choices.find((c) => c.label === "Right");
ok(page.url().endsWith(`choice=${right.id}`), "posting, then opening a choice under the chapter, goes to writing it");
await page.getByLabel("Chapter title").waitFor();
ok((await page.locator(".desk-box-form .desk-via").innerText()).includes("Right"), "…with its choice text filled in");
const story = await json("GET", `/api/stories/${rootData.chapter.story_id}`);
ok(story.style === "STYLE-NEW: first person.", "the style notes are saved with the story");

// ---- the notes are edited on the story details page, not on the desk ----
const writeUrl = page.url();
ok((await page.locator("textarea").evaluateAll((els) => els.map((e) => e.value))).every((v) => !v.includes("STYLE-NEW")), "the style notes can't be edited on the desk");

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

// (The codex is in the Story Bible: its whole-story scope adds entries from the first chapter on.)
await page.goto(`${BASE}/s/${story.id}/review?tab=codex`);
await page.locator('summary[aria-label="Codex actions"]').click();
await page.getByRole("button", { name: "New entry", exact: true }).click();
await page.getByLabel("Name", { exact: true }).fill("Lantern");
ok(!(await page.getByLabel(/Takes effect from/).count()), "a story-wide entry has no chapter to pick");
await page.getByRole("button", { name: "Add entry" }).click();
await page.getByRole("heading", { name: "Lantern", level: 1 }).waitFor();
const rootCodex = await json("GET", `/api/chapters/${root}/codex`);
ok(rootCodex.ops.some((o) => o.name === "Lantern" && o.anchor_chapter_id === root), "a codex entry added there is anchored at the first chapter");

await page.goto(writeUrl);
await page.getByLabel("Chapter title").waitFor();
await generate();
const editedPrompt = await nextChapterPrompt();
ok(editedPrompt.includes("STYLE-EDITED: third person.") && !editedPrompt.includes("STYLE-NEW"), "drafting uses the saved notes");

// ---- a second chapter ----
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1/);
await addChoice("Onward");
await page.locator(".desk-next a.choice-unwritten", { hasText: "Onward" }).click();
await page.waitForURL((u) => u.href.includes("/desk?choice=") && !u.href.endsWith(right.id));
await page.getByLabel("Chapter title").waitFor();
ok((await page.locator(".desk-box-form .desk-via").innerText()).includes("Onward"), "…and the next chapter's choice opens for writing");
await generate();
ok((await nextChapterPrompt()).includes("STYLE-EDITED: third person."), "a later chapter's prompt uses the saved notes");

// ---- Post stays on the desk, on the posted chapter ----
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1/);
ok(true, "“Post chapter” opens the posted chapter on the desk");

await json("PUT", "/api/settings", settingsBefore ?? {});
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);
