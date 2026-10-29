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
    else if (prompt.includes("Revise it")) text = "# The Door Revised\n\nIt creaked, tensely.\n\nShe entered, trembling.";
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

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE, { main: "m", cheap: null });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });

// ---- a new story starts with its details; its first chapter is written next ----
await page.goto(BASE + "/new");
ok(await page.getByLabel("Chapter title").count() === 0 && await page.getByRole("button", { name: "Generate chapter" }).count() === 0, "the New story page has no chapter to draft, only the story's details");
const storyId = await startStory(page, BASE, { title: "The Haunted Inn", premise: "A cursed inn on a hill." });
const story = await (await fetch(`${BASE}/api/stories/${storyId}`)).json();
ok(story.title === "The Haunted Inn" && story.premise === "A cursed inn on a hill." && story.root_chapter_id === null, "Create story makes the story, with no chapters yet");
ok(await page.getByLabel("Story title").count() === 0, "the first chapter's page doesn't ask for the story's title again");
await page.getByLabel(/What should happen/).fill("a stranger arrives");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("She entered."));
ok((await page.getByLabel("Chapter title").inputValue()) === "The Door", "title extracted from stream");
const body1 = await page.getByLabel("Chapter text").inputValue();
ok(body1 === "It creaked.\n\nShe entered.", "body streamed: " + JSON.stringify(body1));
const sent = reqs.at(-1).messages;
ok(sent[0].role === "system" && sent[1].content.includes("Premise: A cursed inn") && sent[1].content.includes("a stranger arrives"), "prompt includes premise + direction");

await page.getByPlaceholder(/Ask the AI to change it/).fill("make it tenser");
await page.getByRole("button", { name: "Revise" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("trembling"));
ok((await page.getByLabel("Chapter title").inputValue()) === "The Door Revised", "revise updated title");
ok(await page.getByText("2/2", { exact: true }).isVisible(), "a revision counts as another draft");
await page.getByRole("button", { name: "Previous draft" }).click();
ok((await page.getByLabel("Chapter text").inputValue()) === body1, "the previous draft is the text before the revision");
await page.getByRole("button", { name: "Next draft" }).click();
ok((await page.getByLabel("Chapter title").inputValue()) === "The Door Revised", "and the revision is the next draft");
await page.getByRole("button", { name: "Undo" }).click();
ok((await page.getByLabel("Chapter text").inputValue()) === body1, "undo restores previous text");

await page.getByRole("button", { name: "Suggest choices" }).click();
await page.getByRole("button", { name: "+ Open the door" }).click();
await page.getByRole("button", { name: "+ Run away" }).click();
ok((await page.getByPlaceholder("Choice 1").inputValue()) === "Open the door" && (await page.getByPlaceholder("Choice 2").inputValue()) === "Run away", "suggested choices added");

// draft persistence across reload
await page.waitForTimeout(900);
await page.reload();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.length > 0);
ok((await page.getByLabel("Chapter title").inputValue()) === "The Door", "draft restored after reload");
await page.goto(BASE + "/drafts");
await page.getByText("The Door").first().waitFor({ timeout: 5000 }).catch(() => {}); ok(await page.getByText("The Door").first().isVisible(), "draft listed on /drafts");
await page.getByRole("link", { name: /The Door/ }).click();
await page.waitForURL(`**/s/${storyId}/write`);

ok(await page.getByRole("button", { name: "Post chapter" }).isEnabled(), "posting doesn't need a summary written first");
await page.getByLabel(/^Summary/).fill("Someone enters the haunted inn.");
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
ok(await page.getByRole("heading", { name: "The Door" }).isVisible(), "posted chapter displayed");
ok((await page.locator(".card.choice-unwritten").count()) === 2, "two unwritten choices shown");
const chapterUrl = page.url().split("?")[0];

// an unwritten choice can be removed with its "x"; its draft box follows the choice's text
{
  const chId = chapterUrl.split("/c/")[1];
  const post = async (path, body, method = "POST") =>
    fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  await post(`/api/chapters/${chId}/choices`, { label: "Temp choice" });
  await page.reload();
  const temp = page.locator(".choice-slot", { hasText: "Temp choice" });
  ok((await temp.locator(".choice-remove").count()) === 1, "an unwritten choice has a remove button");
  const box = await temp.boundingBox(), btn = await temp.locator(".choice-remove").boundingBox();
  ok(btn.x + btn.width > box.x + box.width - 40, "the remove button is at the right edge");
  await temp.locator(".choice-remove").click();
  await page.locator(".choice-slot", { hasText: "Temp choice" }).waitFor({ state: "detached" });
  ok((await page.locator(".card.choice-unwritten").count()) === 2, "the choice is gone after removing it");

  // a draft saved for a slot whose choice text has changed since: the box shows the choice's current text
  await post(`/api/chapters/${chId}/choices`, { label: "Current name" });
  await page.reload();
  const href = await page.locator("a.card.choice-unwritten", { hasText: "Current name" }).getAttribute("href");
  const choiceId = href.split("choice=")[1];
  const key = `fill:${choiceId}`;
  const draft = { key, href, label: "x", updatedAt: 0, storyTitle: "", premise: "", newChoiceLabel: "Stale name", title: "", body: "", choices: [""], prompt: "", undo: [] };
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft, base: null }) });
  await page.goto(`${BASE}${href}`);
  await page.getByLabel(/^Choice text/).waitFor();
  ok((await page.getByLabel(/^Choice text/).inputValue()) === "Current name", "a stale draft's choice text follows the choice");
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  await post(`/api/chapters/${chId}/choices/${choiceId}`, null, "DELETE");
}

// the draft is gone, and the story's details page now leads to reading it
ok((await (await fetch(`${BASE}/api/drafts/first:${storyId}`)).json()).draft == null, "draft cleared after posting");
await page.goto(`${BASE}/s/${storyId}/details`);
ok(await page.getByRole("link", { name: "Read “The Haunted Inn”" }).isVisible() && await page.getByRole("link", { name: "Start writing" }).count() === 0, "the story's details page offers Read instead of Start writing");
await page.goto(`${BASE}/s/${storyId}/write`);
ok(await page.getByText("already has its first chapter").isVisible(), "the first chapter's page says it is written, with a link to read it");

// ---- editing a posted chapter ----
await page.goto(chapterUrl);
await page.locator(".site-menu > summary").click();
ok(await page.getByRole("link", { name: "Edit this chapter" }).isVisible(), "edit link shown");
await page.getByRole("link", { name: "Edit this chapter" }).click();
await page.waitForURL(/\/edit$/);
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.length > 0);
ok((await page.getByLabel("Chapter title").inputValue()) === "The Door", "edit form pre-filled");
ok(await page.getByRole("heading", { name: "Story details" }).isVisible(), "story details editable on first chapter");
await page.getByLabel("Chapter text").fill("It creaked, then slammed.\n\nShe entered anyway.");
await page.getByLabel(/What did you change/).fill("added the slam");
await page.getByLabel("Existing choice").nth(0).fill("Push the door");
await page.getByRole("button", { name: "Remove" }).last().click();
await page.getByRole("button", { name: "+ Add choice" }).click();
await page.getByPlaceholder("Choice 1").fill("Knock first");
await page.waitForTimeout(800);
await page.reload(); // draft should survive
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("slammed"));
ok((await page.getByLabel("Existing choice").nth(0).inputValue()) === "Push the door", "edit draft (incl. choice rename) survives reload");
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByRole("button", { name: "Keep the summary" }).click(); // changed text asks about the summary
await page.waitForURL(chapterUrl);
ok(await page.getByText(/slammed/).first().isVisible(), "edited text shown");
ok(await page.getByRole("link", { name: /^edited / }).isVisible(), "'edited' marker shown");
ok((await page.getByText("Push the door").count()) > 0 && (await page.getByText("Knock first").count()) > 0 && (await page.getByText("Run away").count()) === 0, "choices renamed/removed/added");
await page.getByRole("link", { name: /^edited / }).click();
await page.waitForURL(/history/);
await page.getByText("Revision 1").click();
ok(await page.getByText("It creaked.").first().isVisible(), "history shows original text");

// there are no edit keys: a different browser can edit the chapter too
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
await page2.goto(chapterUrl);
await page2.getByRole("heading", { name: "The Door" }).waitFor();
await page2.locator(".site-menu > summary").click();
ok(await page2.getByRole("link", { name: "Edit this chapter" }).isVisible(), "edit link shown in any browser");
await page2.goto(chapterUrl + "/edit");
await page2.getByLabel("Chapter title").waitFor({ timeout: 5000 });
ok((await page2.getByLabel("Chapter title").inputValue()).length > 0, "any browser can open the edit page");
await ctx2.close();

// continue a branch: context should include earlier chapter + choice
await page.goto(chapterUrl);
await page.locator("a.card.choice-unwritten", { hasText: "Push the door" }).click();
await page.waitForURL(/write\?choice=/);
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("She entered."));
const c2 = reqs.at(-1).messages[1].content;
ok(c2.includes("The reader chose: \"Push the door\"") && c2.includes("It creaked, then slammed.") && c2.includes("Premise: A cursed inn"), "continuation prompt carries story so far + choice");

// error path: dead server
await ai.breakConnection();
await page.reload();
await page.getByRole("button", { name: /^Generate/ }).click().catch(() => {});
await page.waitForTimeout(1200);
ok(await page.getByText(/Couldn't reach/).isVisible().catch(() => false), "unreachable provider shows friendly error");

await browser.close(); mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
