// The write-ahead page (/c/<id>/write-ahead): the form and its estimate, a Fill run that writes the open choices,
// Stop / reload / Resume without duplicates, the unfinished run offered first, and checking the plan before writing.
import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? "/tmp";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// ---- a fake AI that answers chapters, plans and summaries; it keeps the chapter prompts it was sent ----
const ai = { prompts: [], delay: 60, calls: 0 };
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : {};
    const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
    const message = body.messages?.at(-1)?.content ?? "";
    const kind = system.includes("Output format") ? "chapter" : system.includes("JSON array") ? "plan" : "summary";
    ai.calls += 1;
    if (kind === "chapter") ai.prompts.push(message);
    const labels = [...(message.match(/offered at its end: ([^\n]*?)\.\n/)?.[1].matchAll(/“([^”]+)”/g) ?? [])].map((x) => x[1]);
    const add = Number(message.match(/uggest (\d+) new choice/)?.[1] ?? 0);
    const arcCount = Number(message.match(/Plan exactly (\d+) chapter/)?.[1] ?? 0);
    const text = kind === "chapter" ? `# Written ${ai.prompts.length}\n\nA chapter the fake AI wrote.`
      : kind === "plan" && arcCount > 0 ? JSON.stringify(Array.from({ length: arcCount }, (_, i) => ({ choice: `Step ${i + 1} choice`, direction: `Step ${i + 1} happens.` })))
      : kind === "plan" ? JSON.stringify([...labels.map((l) => ({ choice: l, direction: `They face ${l}.` })), ...Array.from({ length: add }, (_, i) => ({ choice: `Onward ${ai.calls}-${i + 1}`, direction: "Something follows." }))])
      : "SUMMARY:\nShort.\nSTORY SO FAR:\nSo far.";
    res.setHeader("content-type", "text/event-stream");
    const third = Math.ceil(text.length / 3);
    const pieces = [text.slice(0, third), text.slice(third, 2 * third), text.slice(2 * third)];
    let i = 0;
    let closed = false;
    res.on("close", () => { closed = true; });
    const next = () => {
      if (closed) return;
      if (i < pieces.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i++] } }] })}\n\n`); setTimeout(next, ai.delay); }
      else { res.write("data: [DONE]\n\n"); res.end(); }
    };
    next();
  });
});
await new Promise((r) => mock.listen(3222, r));
const mockAi = await useMockAi(BASE, { queue: { sharing: "together", switchMinutes: 10, switchItems: 0, groupPictures: true } });

const story = async (title, choices) => {
  const s = await call("POST", "/api/stories", { title, chapter: { title: "Opening", body: "It begins.", choices } });
  return { storyId: s.story_id, root: s.chapter_id };
};
const choicesOf = async (root) => (await call("GET", `/api/chapters/${root}`)).choices;
const runsOf = async (storyId) => (await call("GET", `/api/stories/${storyId}/ai-runs`)).runs;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
await context.addInitScript(() => { window.__STORYTIME_TEST__ = true; });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const form = () => page.locator("form.write-ahead-form");

try {
  // ---- the form, and a chapter with nothing open ----
  const done = await story("Closed tale", []);
  await page.goto(`${BASE}/c/${done.root}/write-ahead`);
  await page.getByRole("heading", { name: "Write ahead with AI" }).waitFor();
  ok(await page.getByText(/There are no open choices on this chapter/).isVisible() && await form().getByRole("button", { name: "Start" }).isDisabled(), "with no open choices the page says so and Start is off");

  const a = await story("Fill tale", ["Go left", "Go right"]);
  await page.goto(`${BASE}/c/${a.root}/write-ahead`);
  await page.getByRole("heading", { name: "Write ahead with AI" }).waitFor();
  ok(await page.getByText("This chapter's open choices (2)").isVisible() && await page.getByText("Every open choice below this chapter (2)").isVisible(), "the form counts the open choices here and below");
  ok(await page.getByText(/Writes 2 chapters, about 7 AI requests, one at a time\./).isVisible(), "…and estimates the run");
  await form().getByText("Settings for every chapter").click();
  ok(await form().getByLabel("Choices on each new chapter").inputValue() === "3" && await form().getByLabel("Length").inputValue() === "medium", "the settings default to medium length and 3 choices on each new chapter");
  ok(await form().getByLabel("Group by model, fewer model loads").isChecked(), "…and to grouping by model");
  ok(!(await form().getByLabel("Let me check the plan first").isChecked()), "…with checking the plan off");
  await form().getByRole("button", { name: "View prompt" }).click().catch(async () => { await page.getByRole("button", { name: /prompt/i }).first().click(); });
  ok(await page.getByText(/Write the next chapter, about 600 words/).isVisible().catch(() => false), "View prompt shows the first chapter's prompt");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SHOTS}/write-ahead-form-desktop.png`, fullPage: true });

  // ---- a Fill run writes both ----
  await form().getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForURL(/write-ahead\?run=/);
  ok(await until(async () => (await page.getByRole("heading", { name: /2 of 2 written/ }).count()) > 0, "both chapters written", 300), "the run writes both chapters");
  await page.getByText(/Wrote 2 chapters/).waitFor({ timeout: 30000 });
  const written = (await choicesOf(a.root)).filter((c) => c.child_chapter_id && c.child_ai === "unreviewed");
  ok(written.length === 2, "…each posted as AI-written and not reviewed");
  ok(await page.getByText(/Wrote 2 chapters, marked not reviewed\./).isVisible(), "the page ends with “Wrote 2 chapters, marked not reviewed”");
  ok(await page.getByRole("link", { name: "Open in outline" }).isVisible() && await page.getByText(/codex isn't updated by a run/i).isVisible(), "…with Open in outline and the codex note");
  ok((await page.getByRole("list").filter({ hasText: "Go left" }).first().innerText()).includes("They face Go left."), "…and each task shows what was planned to happen");
  const links = await page.locator(".ai-run-tasks a:not(.ai-log-link)").count();
  ok(links === 2, "…and the written ones link to their chapters");
  await page.getByRole("button", { name: "Mark all reviewed" }).click();
  ok(await until(async () => await page.getByText(/Marked 2 reviewed/).isVisible(), "marked"), "Mark all reviewed marks them");
  ok((await choicesOf(a.root)).every((c) => c.child_ai === "reviewed"), "…on the server too");
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "the page doesn't scroll sideways at desktop width");
  await page.screenshot({ path: `${SHOTS}/write-ahead-done-desktop.png`, fullPage: true });

  // ---- Stop, reload, Resume ----
  ai.delay = 400;
  const b = await story("Resume tale", ["One", "Two", "Three"]);
  await page.goto(`${BASE}/c/${b.root}/write-ahead`);
  await form().getByLabel("Let me check the plan first").waitFor();
  await form().getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForURL(/write-ahead\?run=/);
  const runB = new URL(page.url()).searchParams.get("run");
  await until(async () => (await choicesOf(b.root)).some((c) => c.child_chapter_id), "the first chapter", 300);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  ok(await until(async () => (await call("GET", `/api/ai-runs/${runB}`)).status === "paused", "paused", 100), "Stop pauses the run");
  const after = (await choicesOf(b.root)).filter((c) => c.child_chapter_id).length;
  await page.goto(`${BASE}/c/${b.root}/write-ahead`);
  ok(await page.getByText(new RegExp(`A run from here is unfinished: ${after} of 3 written`)).isVisible(), `the page offers the unfinished run first (${after} of 3 written)`);
  await page.screenshot({ path: `${SHOTS}/write-ahead-unfinished-desktop.png` });
  const callsBefore = ai.calls;
  await new Promise((r) => setTimeout(r, 800));
  ok(ai.calls === callsBefore, "a paused run doesn't restart by itself on load");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForURL(/write-ahead\?run=/);
  ai.delay = 60;
  ok(await until(async () => (await call("GET", `/api/ai-runs/${runB}`)).status === "done", "the run to finish", 400), "Resume finishes the run");
  const all = await choicesOf(b.root);
  ok(all.every((c) => c.child_chapter_id) && (await Promise.all(all.map(async (c) => (await call("GET", `/api/chapters/${c.child_chapter_id}`)).chapter.parent_choice_id))).join() === all.map((c) => c.id).join(), "…with each choice written exactly once");

  // ---- check the plan first (D23) ----
  const c = await story("Plan tale", ["Left", "Right"]);
  await page.goto(`${BASE}/c/${c.root}/write-ahead`);
  await form().getByLabel("Let me check the plan first").check();
  const promptsBefore = ai.prompts.length;
  await form().getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForURL(/write-ahead\?run=/);
  ok(await until(async () => await page.getByRole("heading", { name: /The plan for the next 2 chapters is ready/ }).isVisible(), "the plan to be ready", 300), "the run stops with the plan ready to check");
  ok(ai.prompts.length === promptsBefore, "…before any chapter is written");
  const planBox = page.locator(".ai-run-review");
  ok((await planBox.locator("textarea").first().inputValue()) === "They face Left.", "…showing what the plan says happens");
  await page.screenshot({ path: `${SHOTS}/write-ahead-review-desktop.png`, fullPage: true });
  await planBox.locator("textarea").first().fill("It rains. SUNNYEDIT");
  await planBox.getByRole("button", { name: "Leave out “Right”" }).click();
  await planBox.getByRole("button", { name: "Continue" }).click();
  ok(await until(async () => (await call("GET", `/api/stories/${c.storyId}/ai-runs`)).runs.some((r) => r.status === "done"), "the run to finish", 300), "Continue goes on to the end");
  ok(ai.prompts.slice(promptsBefore).length === 1 && ai.prompts.at(-1).includes("SUNNYEDIT"), "the edited plan reached the chapter's prompt, and only one chapter was written");
  const left = await choicesOf(c.root);
  ok(left.find((x) => x.label === "Left").child_chapter_id && !left.find((x) => x.label === "Right").child_chapter_id, "the chapter left out is still an open choice");

  // ---- Grow the tree ----
  const countNodes = (n) => 1 + n.choices.reduce((sum, c) => sum + (c.child ? countNodes(c.child) : 0), 0);
  const tr = await story("Tree tale", []);
  await page.setViewportSize({ width: 1000, height: 1300 });
  await page.goto(`${BASE}/c/${tr.root}/write-ahead`);
  await form().getByLabel("Grow the tree").check();
  ok(await page.getByText(/Writes 39 chapters, about 118 AI requests, one at a time\./).isVisible(), "Grow the tree: depth 3 and 3 choices from a bare chapter is estimated at 39 chapters");
  ok(await page.getByText("Keeps the chapters and choices already there").isVisible(), "…and says it keeps what is already there");
  await form().getByRole("button", { name: "Start", exact: true }).click();
  ok(await page.getByText(/That is a lot: 39 chapters/).isVisible() && await form().getByRole("button", { name: "Yes, write 39 chapters" }).isVisible(), "a big run asks before starting");
  await form().getByRole("button", { name: "Cancel" }).click();
  await form().getByLabel(/^Depth/).fill("2");
  await form().getByLabel(/^Choices per chapter/).fill("2");
  ok(await page.getByText(/Writes 6 chapters/).isVisible(), "depth 2 with 2 choices is estimated at 6 chapters");
  await page.screenshot({ path: `${SHOTS}/write-ahead-tree-form-desktop.png`, fullPage: true });
  await form().getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForURL(/write-ahead\?run=/);
  const treeRun = new URL(page.url()).searchParams.get("run");
  ok(await until(async () => (await call("GET", `/api/ai-runs/${treeRun}`)).status === "done", "the tree run to finish", 600), "the run finishes");
  const treeNow = await call("GET", `/api/chapters/${tr.root}/subtree?depth=8`);
  ok(countNodes(treeNow) === 7 && treeNow.choices.length === 2 && treeNow.choices.every((c) => c.child && c.child.choices.length === 2 && c.child.choices.every((x) => x.child && x.child.choices.length === 3)), "depth 2 with 2 choices wrote 6 chapters: two, then two under each, the last with their 3 end choices");
  ok(await page.getByText(/Wrote 6 chapters, marked not reviewed\./).isVisible(), "the page says it wrote 6 chapters");
  // A second run keeps what is there and finds nothing to add.
  await page.goto(`${BASE}/c/${tr.root}/write-ahead`);
  await form().getByLabel("Grow the tree").check();
  await form().getByLabel(/^Depth/).fill("2");
  await form().getByLabel(/^Choices per chapter/).fill("2");
  ok(await page.getByText(/nothing to write: the tree below this chapter already has/).isVisible() && await form().getByRole("button", { name: "Start" }).isDisabled(), "growing a tree that is already that big says there is nothing to write");
  // Too big for one run.
  const big = await story("Big tree", []);
  await page.goto(`${BASE}/c/${big.root}/write-ahead`);
  await form().getByLabel("Grow the tree").check();
  await form().getByLabel(/^Depth/).fill("8");
  await form().getByLabel(/^Choices per chapter/).fill("6");
  ok(await page.getByText(/more than 200 chapters/).isVisible() && await form().getByRole("button", { name: "Start" }).isDisabled(), "a 6 × 8 tree is refused: the estimate is over the limit and Start is off");

  // ---- Reach a goal ----
  const goal = await story("Goal tale", []);
  await page.goto(`${BASE}/c/${goal.root}/write-ahead`);
  await form().getByLabel("Reach a goal").check();
  ok(await form().getByRole("button", { name: "Plan the chapters" }).isDisabled(), "Reach a goal: planning needs a goal first");
  await form().getByLabel(/^Goal/).fill("The heroes find the vault");
  await form().getByLabel(/^Chapters/).fill("2");
  await form().getByRole("button", { name: "Plan the chapters", exact: true }).click();
  ok(await until(async () => (await form().getByLabel(/^Choice text for chapter/).count()) === 2, "the plan to show", 100), "the plan shows as one editable row per chapter");
  ok((await form().getByLabel("Choice text for chapter 1").inputValue()) === "Step 1 choice" && (await form().getByLabel(/What happens/).first().inputValue()) === "Step 1 happens.", "…with the choice text and what happens");
  await form().getByRole("button", { name: "Remove chapter 2" }).click();
  ok(await form().getByRole("button", { name: "Write 1 chapter" }).isVisible(), "removing a row shortens the chain: “Write 1 chapter”");
  await form().getByRole("button", { name: "Plan again" }).click();
  ok(await until(async () => (await form().getByLabel(/^Choice text for chapter/).count()) === 2, "the plan again", 100), "Plan again makes the plan afresh");
  await form().getByLabel("Choice text for chapter 1").fill("Edited step one");
  await form().getByLabel(/^What happens/).nth(1).fill("EDITEDSECOND happens.");
  await page.screenshot({ path: `${SHOTS}/write-ahead-arc-form-desktop.png`, fullPage: true });
  const arcPromptsBefore = ai.prompts.length;
  await form().getByRole("button", { name: "Write 2 chapters" }).click();
  await page.waitForURL(/write-ahead\?run=/);
  const arcRun = new URL(page.url()).searchParams.get("run");
  ok(await until(async () => (await call("GET", `/api/ai-runs/${arcRun}`)).status === "done", "the chain to be written", 400), "the chain is written");
  const first = (await choicesOf(goal.root));
  ok(first.length === 1 && first[0].label === "Edited step one" && first[0].child_chapter_id, "the first chapter is under a new choice with the edited text");
  const second = (await choicesOf(first[0].child_chapter_id));
  ok(second[0]?.label === "Step 2 choice" && second[0].child_chapter_id, "the second is under the first chapter's first choice");
  const chainPrompts = ai.prompts.slice(arcPromptsBefore);
  ok(chainPrompts.length === 2 && chainPrompts[0].includes("part 1 of 2") && chainPrompts[0].includes("Don't reach that goal yet") && chainPrompts[1].includes("EDITEDSECOND") && chainPrompts[1].includes("This chapter reaches that goal."), "each chapter was written from its place in the chain, the second from the edited plan");
  // Starting from an open choice.
  const goal2 = await story("Goal tale two", ["Already open"]);
  await page.goto(`${BASE}/c/${goal2.root}/write-ahead`);
  await form().getByLabel("Reach a goal").check();
  await form().getByLabel(/^Start with/).selectOption({ label: "Its open choice “Already open”" });
  await form().getByLabel(/^Goal/).fill("Something big");
  await form().getByLabel(/^Chapters/).fill("1");
  await form().getByRole("button", { name: "Plan the chapters", exact: true }).click();
  await form().getByRole("button", { name: "Write 1 chapter" }).click();
  await page.waitForURL(/write-ahead\?run=/);
  ok(await until(async () => (await choicesOf(goal2.root)).every((c) => c.child_chapter_id), "the chapter to be written", 300), "starting from an open choice writes into it");
  ok((await choicesOf(goal2.root)).length === 1, "…without adding another choice");

  // ---- phone width ----
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto(`${BASE}/c/${a.root}/write-ahead`);
  await page.getByRole("heading", { name: "Write ahead with AI" }).waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px the form doesn't scroll sideways");
  await page.screenshot({ path: `${SHOTS}/write-ahead-form-400.png`, fullPage: true });
  await page.goto(`${BASE}/c/${a.root}/write-ahead?run=${(await runsOf(a.storyId))[0].id}`);
  await page.getByText(/Wrote 2 chapters/).waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px a finished run doesn't scroll sideways");
  await page.screenshot({ path: `${SHOTS}/write-ahead-done-400.png`, fullPage: true });
} finally {
  const left = (await call("GET", "/api/ai-runs?unfinished=1").catch(() => ({ runs: [] }))).runs;
  for (const r of left) {
    const token = "cleanup-token-12345";
    await call("POST", `/api/ai-runs/${r.id}/claim`, { token }).catch(() => {});
    const now = await call("GET", `/api/ai-runs/${r.id}`);
    await call("PATCH", `/api/ai-runs/${r.id}`, { token, version: now.version, status: "stopped" }).catch(() => {});
  }
  await mockAi.restore();
  await browser.close();
  mock.close();
}
process.exit(failed ? 1 : 0);
