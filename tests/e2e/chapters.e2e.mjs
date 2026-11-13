// Writing chapters on the writing desk, end to end: a new story's first chapter (Generate, a second draft, the draft
// kept across a reload and in the Drafts list, Post), the chapter page's "Written with", removing an unwritten
// choice, editing the posted chapter (its kept prompt and drafts, Update, History), a second browser, continuing a
// branch from an unwritten choice, and an unreachable AI.
import http from "node:http";
import { launch, startStory, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const reqs = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}"); reqs.push(body);
    const prompt = body.messages?.at(-1)?.content ?? "";
    const system = body.messages?.[0]?.content ?? "";
    let text;
    if (system.includes("running summary")) text = JSON.stringify({ summary: "A short summary.", story_so_far: "The story so far." });
    else if (prompt.includes("JSON array")) text = '["Open the door", "Run away", "Hide"]';
    else if (prompt.includes("make it tenser")) text = "# The Door Again\n\nIt creaked, tensely.\n\nShe entered, trembling.";
    else text = "# The Door\n\nIt creaked.\n\nShe entered.";
    res.setHeader("content-type", "text/event-stream");
    const parts = text.match(/.{1,7}/gs);
    let i = 0;
    const tick = () => { if (i < parts.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`); setTimeout(tick, 10); } else { res.write("data: [DONE]\n\n"); res.end(); } };
    tick();
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const until = async (fn) => { for (let i = 0; i < 150; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
const send = async (path, body, method = "POST") =>
  fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const ai = await useMockAi(BASE, { main: "m", cheap: null });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });

const box = page.locator("section.desk-box");
const promptBox = box.getByLabel("Prompt", { exact: true });
const generate = () => box.locator(".desk-gen-row").getByRole("button", { name: /^Generate/ });
const draftButtons = box.locator(".desk-drafts").getByRole("button");
const bodyText = () => page.evaluate(() => document.querySelector("textarea[maxlength='50000']")?.value ?? "");
/** Generate, then back to editing the text once it is written. */
const generateAndWait = async (has) => {
  await generate().click();
  await box.getByRole("button", { name: "Edit text" }).click();
  await page.waitForFunction((t) => document.querySelector("textarea[maxlength='50000']")?.value.includes(t), has);
};

// ---- a new story starts with its details; its first chapter is written next, on the desk ----
await page.goto(BASE + "/new");
ok(await page.getByLabel("Chapter title").count() === 0 && await page.getByRole("button", { name: /^Generate/ }).count() === 0, "the New story page has no chapter to draft, only the story's details");
const storyId = await startStory(page, BASE, { title: "The Haunted Inn", premise: "A cursed inn on a hill." });
const story = await (await fetch(`${BASE}/api/stories/${storyId}`)).json();
ok(story.title === "The Haunted Inn" && story.premise === "A cursed inn on a hill." && story.root_chapter_id === null, "Create story makes the story, with no chapters yet");
ok(await page.getByLabel("Story title").count() === 0, "the first chapter's desk doesn't ask for the story's title again");
await promptBox.fill("a stranger arrives");
await generateAndWait("She entered.");
ok((await box.getByLabel("Chapter title").inputValue()) === "The Door", "title extracted from stream");
const body1 = await box.getByLabel("Chapter text").inputValue();
ok(body1 === "It creaked.\n\nShe entered.", "body streamed: " + JSON.stringify(body1));
const sent = reqs.at(-1).messages;
ok(sent[0].role === "system" && sent[1].content.includes("Premise: A cursed inn") && sent[1].content.includes("a stranger arrives"), "prompt includes premise + direction");

// No Revise: the prompt is adjusted and Generate run again, which adds a draft.
ok(await page.getByRole("button", { name: /^Revise/ }).count() === 0 && await page.getByRole("button", { name: "Undo" }).count() === 0 && await page.getByLabel("Instruction for the AI").count() === 0, "the desk has no Revise box or Undo");
await promptBox.fill("a stranger arrives, make it tenser");
await generateAndWait("trembling");
ok((await box.getByLabel("Chapter title").inputValue()) === "The Door Again", "Generate again writes a new title and text");
ok((await draftButtons.allInnerTexts()).join("|") === "1|2", "a second Generate counts as another draft");
await box.getByRole("button", { name: "Draft 1" }).click();
ok((await bodyText()) === body1, "draft 1 is the first Generate's text");

// draft persistence across reload
await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
await page.waitForTimeout(900);
await page.reload();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.length > 0);
ok((await box.getByLabel("Chapter title").inputValue()) === "The Door", "draft restored after reload");
await page.goto(BASE + "/drafts");
await page.getByText("The Door").first().waitFor({ timeout: 5000 }).catch(() => {}); ok(await page.getByText("The Door").first().isVisible(), "draft listed on /drafts");
await page.getByRole("link", { name: /The Door/ }).click();
await page.waitForURL(`**/s/${storyId}/desk`);
await box.getByLabel("Chapter title").waitFor();

ok(await box.getByRole("button", { name: "Post chapter" }).isEnabled(), "posting doesn't need a summary written first");
await box.getByRole("button", { name: /^▸ Summary/ }).click();
await box.getByLabel("Summary", { exact: true }).fill("Someone enters the haunted inn.");
await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
await box.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1/);
const chId = new URL(page.url()).pathname.split("/")[2];
const chapterUrl = `${BASE}/c/${chId}`;
const postedCh = (await (await fetch(`${BASE}/api/chapters/${chId}`)).json()).chapter;
ok(postedCh.title === "The Door" && postedCh.summary === "Someone enters the haunted inn.", "Post makes the chapter, with the summary written on the desk");
// Choices are added after posting.
await send(`/api/chapters/${chId}/choices`, { label: "Open the door" });
await send(`/api/chapters/${chId}/choices`, { label: "Run away" });
await page.goto(chapterUrl);
ok(await page.getByRole("heading", { name: "The Door" }).isVisible(), "posted chapter displayed");
ok((await page.locator(".card.choice-unwritten").count()) === 2, "two unwritten choices shown");

// The chapter page says which model wrote it, with the request's settings, time taken and prompt. The first draft was
// posted, so only the first Generate wrote the posted text.
{
  const making = page.locator(".chapter-making");
  ok(/Written with m on Test/.test(await making.locator("summary").first().innerText()) && !(await making.getByText(/requests/).count()), "the chapter page names the model and connection that wrote it (one request: the other draft's isn't counted)");
  await making.locator("summary").first().click();
  const settingsText = await making.locator(".making-settings").innerText();
  ok(/Generate/.test(settingsText) && /http:\/\/localhost:3222\/v1/.test(settingsText) && /ollama/.test(settingsText) && /Time taken\s+\d+ s/.test(settingsText), "…with where it was made, the connection's kind and URL, and the time taken");
  await making.getByText("Prompt", { exact: true }).click();
  ok(await making.getByText(/a stranger arrives/).first().isVisible(), "…and the exact prompt sent");
}

// an unwritten choice can be removed with its "x"; its draft follows the choice's text
{
  await send(`/api/chapters/${chId}/choices`, { label: "Temp choice" });
  await page.reload();
  const temp = page.locator(".choice-slot", { hasText: "Temp choice" });
  ok((await temp.locator(".choice-remove").count()) === 1, "an unwritten choice has a remove button");
  const slotBox = await temp.boundingBox(), btn = await temp.locator(".choice-remove").boundingBox();
  ok(btn.x + btn.width > slotBox.x + slotBox.width - 40, "the remove button is at the right edge");
  await temp.locator(".choice-remove").click();
  await page.locator(".choice-slot", { hasText: "Temp choice" }).waitFor({ state: "detached" });
  ok((await page.locator(".card.choice-unwritten").count()) === 2, "the choice is gone after removing it");

  // a draft saved for a slot whose choice text has changed since: the desk shows the choice's current text
  await send(`/api/chapters/${chId}/choices`, { label: "Current name" });
  await page.reload();
  const href = await page.locator("a.card.choice-unwritten", { hasText: "Current name" }).getAttribute("href");
  ok(href.includes("/desk?choice="), "an unwritten choice opens its chapter on the writing desk: " + href);
  const choiceId = href.split("choice=")[1];
  const key = `fill:${choiceId}`;
  const draft = { key, href, label: "x", updatedAt: 0, storyTitle: "", premise: "", newChoiceLabel: "Stale name", title: "", body: "", choices: [""], prompt: "", undo: [] };
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft, base: null }) });
  await page.goto(`${BASE}${href}`);
  await box.getByLabel("Chapter title").waitFor();
  ok((await page.locator(".desk-box-form .desk-via").innerText()).includes("Current name"), "a stale draft's choice text follows the choice");
  await page.goto("about:blank");
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  await send(`/api/chapters/${chId}/choices/${choiceId}`, null, "DELETE");
}

// the draft is gone, and the story's details page now leads to reading it
ok((await (await fetch(`${BASE}/api/drafts/first:${storyId}`)).json()).draft == null, "draft cleared after posting");
await page.goto(`${BASE}/s/${storyId}/details`);
ok(await page.getByRole("link", { name: "Start writing" }).count() === 0 && await page.getByRole("navigation", { name: "Story", exact: true }).getByRole("link", { name: "Read" }).isVisible(), "the story's details page has the Read tab instead of Start writing");
await page.goto(`${BASE}/s/${storyId}/desk`);
ok(await page.getByText("already has its first chapter").isVisible(), "the first chapter's desk says it is written, with a link to it");

// ---- editing a posted chapter ----
await page.goto(chapterUrl);
ok(await page.locator(".chapter-actions").getByRole("link", { name: "Edit", exact: true }).isVisible(), "edit link shown");
await page.locator(".chapter-actions").getByRole("link", { name: "Edit", exact: true }).click();
await page.waitForURL(/\/desk$/);
await box.getByLabel("Chapter title").waitFor();
ok((await box.getByLabel("Chapter title").inputValue()) === "The Door", "the desk opens with the chapter");
await box.getByRole("button", { name: /Prompt and drafts/ }).click();
ok((await promptBox.inputValue()) === "a stranger arrives, make it tenser", "the edit starts with the prompt last typed when the chapter was written");
ok((await draftButtons.allInnerTexts()).join("|") === "1 ✓|2" && (await draftButtons.first().getAttribute("aria-pressed")) === "true", "and with its generated drafts, showing the one that was posted");
await box.getByRole("button", { name: "Draft 2" }).click();
ok((await box.getByLabel("Chapter title").inputValue()) === "The Door Again", "the other draft is the second Generate");
await box.getByRole("button", { name: /^Draft 1/ }).click();
ok(await page.getByRole("heading", { name: "Story details" }).isVisible(), "story details editable on first chapter");
await box.getByLabel("Chapter text").fill("It creaked, then slammed.\n\nShe entered anyway.");
await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
await page.waitForTimeout(800);
await page.reload(); // draft should survive
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("slammed"));
ok(true, "the edit's draft survives a reload");
await box.getByRole("button", { name: "Update chapter" }).click();
await page.locator(".desk-bar-note", { hasText: "Updated" }).waitFor();
await page.goto(chapterUrl);
ok(await page.getByText(/slammed/).first().isVisible(), "edited text shown");
ok(await page.getByRole("link", { name: /^edited / }).isVisible(), "'edited' marker shown");
await page.getByRole("link", { name: /^edited / }).click();
await page.waitForURL(/history/);
await page.getByText("Revision 1").click();
ok(await page.getByText("It creaked.").first().isVisible(), "history shows original text");

// there are no edit keys: a different browser can edit the chapter too
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
await page2.goto(chapterUrl);
await page2.getByRole("heading", { name: "The Door" }).waitFor();
ok(await page2.locator(".chapter-actions").getByRole("link", { name: "Edit", exact: true }).isVisible(),"edit link shown in any browser");
await page2.goto(chapterUrl + "/desk");
await page2.getByLabel("Chapter title").waitFor({ timeout: 5000 });
ok((await page2.getByLabel("Chapter title").inputValue()).length > 0, "any browser can open the chapter on the desk");
await ctx2.close();

// continue a branch: context should include earlier chapter + choice
await page.goto(chapterUrl);
await page.locator("a.card.choice-unwritten", { hasText: "Open the door" }).click();
await page.waitForURL(/desk\?choice=/);
await box.getByLabel("Chapter title").waitFor();
await generateAndWait("She entered.");
const c2 = reqs.at(-1).messages[1].content;
ok(c2.includes("The reader chose: \"Open the door\"") && c2.includes("It creaked, then slammed.") && c2.includes("Premise: A cursed inn"), "continuation prompt carries story so far + choice");

// error path: dead server
await ai.breakConnection();
await page.reload();
await generate().click().catch(() => {});
ok(!!(await until(() => page.getByText(/Couldn't reach/).isVisible().catch(() => false))), "unreachable provider shows friendly error");
await page.goto("about:blank");
const left = (await (await fetch(`${BASE}/api/chapters/${chId}`)).json()).choices.find((c) => c.label === "Open the door");
if (left) await fetch(`${BASE}/api/drafts/${encodeURIComponent(`fill:${left.id}`)}`, { method: "DELETE" });

await browser.close(); mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
