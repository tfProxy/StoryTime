import Database from "better-sqlite3";
import { startFakeAi } from "../fakeAi.mjs";
import { launch, useMockAi } from "./browser.mjs";

// The chapter's box on the writing desk (step 4): its order (title, "Prompt and drafts", the text, "Summary", the one
// button); "Prompt and drafts" folded on a posted chapter and unfolded on a new one; each Generate adds a numbered
// draft that keeps its prompt, an older one showing it with "Use this prompt"; ✓ on the chapter's draft; Update off
// until the draft showing differs, then replacing the text with History keeping the old; the summary rewritten in the
// background, "yours · not rewritten" after editing it and "Let the AI rewrite it"; "Draft not used" and "draft" on
// the reading page's choices and in the Drafts list; the top bar's ⋯ menu and Remove the AI mark; Post on a new
// chapter (off until there is text) making it and staying on it.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(100);
  }
};

let n = 0;
const fake = await startFakeAi({
  port: 3222,
  delay: 5,
  reply: (body) => {
    const system = body.messages?.[0]?.content ?? "";
    if (system.includes("Output format")) {
      n++;
      return `# Chapter A\n\nText number ${n}.`;
    }
    if (system.includes("running summary")) return "SUMMARY: The AI's summary.\nSTORY SO FAR: The AI's story so far.";
    if (system.includes("button text and nothing else")) return "Go";
    return "1. Run\n2. Hide";
  },
});
const ai = await useMockAi(BASE);
const browser = await launch();
const drafts = [];
try {
  const story = await post("/api/stories", { title: "Box Tale", premise: "p", chapter: { title: "Root", body: "It began.", choices: ["Go on", "Turn back"] } });
  const R = story.chapter_id;
  const [goOn, turnBack] = (await send("GET", `/api/chapters/${R}`)).choices;
  const A = (await post("/api/chapters", { choice_id: goOn.id, title: "Chapter A", body: "Original text.", summary: "An old summary." })).chapter_id;
  drafts.push(`edit:${A}`, `fill:${turnBack.id}`);
  // Written by an AI run, so it has a mark to remove.
  const db = new Database(process.env.TEST_DB);
  db.prepare(`UPDATE chapters SET ai_run_id = 'run-x' WHERE id = ?`).run(A);
  db.close();

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());

  // ---- a posted chapter: the box's order, folded ----
  await page.goto(`${BASE}/c/${A}/desk`);
  const box = page.locator("section.desk-box");
  const title = box.getByLabel("Chapter title");
  await title.waitFor();
  ok((await title.inputValue()) === "Chapter A", "the box starts with the chapter's title");
  const promptFold = box.getByRole("button", { name: /Prompt and drafts/ });
  ok((await promptFold.getAttribute("aria-expanded")) === "false" && (await box.getByLabel("Prompt", { exact: true }).count()) === 0, "Prompt and drafts is folded on a posted chapter");
  ok((await promptFold.innerText()).includes("(1)"), "…and counts one draft (the chapter's text): " + (await promptFold.innerText()));
  const ys = await Promise.all([title, promptFold, box.getByLabel("Chapter text"), box.getByRole("button", { name: /^▸ Summary/ }), box.getByRole("button", { name: "Update chapter" })].map(async (l) => (await l.boundingBox()).y));
  ok(ys.every((y, i) => i === 0 || y > ys[i - 1]), "top to bottom: title, Prompt and drafts, the text, Summary, Update chapter: " + ys.join());
  const update = box.getByRole("button", { name: "Update chapter" });
  ok(await update.isDisabled(), "Update chapter is off while the draft is the chapter's text");
  ok((await page.locator(".models-panel").count()) === 0 && (await page.getByText("What did you change?").count()) === 0 && (await page.getByText("This is my writing now").count()) === 0, "no models panel, no 'What did you change?', no 'This is my writing now'");

  // ---- unfolded: the prompt box, length, model and Generate, the drafts ----
  await promptFold.click();
  const promptBox = box.getByLabel("Prompt", { exact: true });
  await promptBox.waitFor();
  const genRow = box.locator(".desk-gen-row");
  ok((await genRow.getByLabel("Length").count()) === 1 && (await genRow.getByLabel("Model for writing").count()) === 1 && (await genRow.getByRole("button", { name: /^Generate/ }).count()) === 1, "a line with length, the writing model and Generate");
  const pb = await promptBox.boundingBox();
  const gb = await genRow.boundingBox();
  const db1 = await box.locator(".desk-drafts").boundingBox();
  ok(pb.y < gb.y && gb.y < db1.y && pb.width > 0.9 * (await box.boundingBox()).width - 40, "the prompt box at full width, then the line, then the drafts row");
  const draftButtons = box.locator(".desk-drafts").getByRole("button");
  ok((await draftButtons.allInnerTexts()).join("|") === "1 ✓", "one draft, the chapter's, marked ✓");

  const generate = async (prompt, count) => {
    await promptBox.fill(prompt);
    await genRow.getByRole("button", { name: /^Generate/ }).click();
    await until(async () => (await draftButtons.count()) === count && (await genRow.getByRole("button", { name: "Generate again" }).isEnabled().catch(() => false)));
    await page.waitForFunction(() => !/Writing/.test(document.querySelector(".desk-gen-row")?.textContent ?? ""));
  };
  await generate("First idea", 2);
  await generate("Second idea", 3);
  ok((await draftButtons.allInnerTexts()).join("|") === "1 ✓|2|3", "each Generate adds a numbered draft; ✓ stays on the chapter's: " + (await draftButtons.allInnerTexts()).join("|"));
  ok((await draftButtons.nth(2).getAttribute("aria-pressed")) === "true" && (await box.locator(".prose").innerText()).includes("Text number 2"), "the newest draft shows");
  ok((await box.locator(".desk-draft-prompt").count()) === 0, "the newest draft shows no prompt of its own");

  // an older draft shows its prompt, with Use this prompt
  await draftButtons.nth(1).click();
  const shown = box.locator(".desk-draft-prompt");
  await shown.waitFor();
  ok((await shown.innerText()).includes("The prompt that made draft 2:") && (await shown.innerText()).includes("First idea"), "draft 2 shows the prompt that made it");
  await shown.getByRole("button", { name: "Use this prompt" }).click();
  ok((await promptBox.inputValue()) === "First idea", "Use this prompt puts it back in the box");
  ok(await shown.getByRole("button", { name: "Use this prompt" }).isDisabled(), "…and is off once it is there");
  {
    const foot = await box.locator(".desk-box-foot").innerText();
    ok(foot.includes("draft 2 of 3 ·") && !foot.includes("You are looking at"), "the foot repeats the drafts line (draft 2 of 3 · words), with no \"You are looking at…\": " + foot);
  }
  // ↻ at the foot does what Generate again does: a fourth draft
  await box.locator(".desk-box-foot").getByRole("button", { name: /^Try again/ }).click();
  await until(async () => (await draftButtons.count()) === 4 && (await genRow.getByRole("button", { name: "Generate again" }).isEnabled().catch(() => false)));
  await page.waitForFunction(() => !/Writing/.test(document.querySelector(".desk-gen-row")?.textContent ?? ""));
  ok((await draftButtons.count()) === 4 && (await draftButtons.nth(3).getAttribute("aria-pressed")) === "true", "↻ at the foot of the box makes a new draft, as Generate again does");
  await draftButtons.nth(1).click();
  await shown.waitFor();
  ok(await update.isEnabled(), "Update chapter is on when the draft showing differs from the chapter");

  // ---- Update: the chapter's text becomes draft 2, History keeps the old ----
  const writing = (await send("GET", `/api/chapters/${A}`)).chapter;
  await update.click();
  await page.locator(".desk-bar-note", { hasText: "Updated" }).waitFor();
  const after = await until(async () => {
    const c = (await send("GET", `/api/chapters/${A}`)).chapter;
    return c.revision > writing.revision && c;
  });
  ok(after && after.body.includes("Text number 1"), "Update replaces the chapter's text with the draft showing");
  const revisions = await send("GET", `/api/chapters/${A}/revisions`);
  ok(JSON.stringify(revisions).includes("Original text."), "…and History keeps the old text");
  await page.waitForFunction(() => document.querySelector("section.desk-box .desk-fold")?.getAttribute("aria-expanded") === "false");
  await promptFold.click();
  await until(async () => (await draftButtons.allInnerTexts()).join("|") === "1|2 ✓|3|4");
  ok((await draftButtons.allInnerTexts()).join("|") === "1|2 ✓|3|4", "the drafts are kept, ✓ now on draft 2: " + (await draftButtons.allInnerTexts()).join("|"));
  ok(await update.isDisabled(), "…and Update is off again");
  ok(!!(await until(async () => (await send("GET", `/api/chapters/${A}`)).chapter.summary === "The AI's summary.")), "the summary is rewritten in the background");

  // ---- Summary: the owner's own, then handed back ----
  await box.getByRole("button", { name: /^▸ Summary/ }).click();
  const summary = box.getByLabel("Summary", { exact: true });
  ok(!!(await until(async () => (await summary.inputValue()) === "The AI's summary.")), "Summary shows the chapter's summary, as rewritten since the desk opened");
  ok((await box.getByText("rewritten each time you update the chapter").count()) === 1, "…said to be the AI's, rewritten on each Update");
  const savedSummary = page.waitForResponse((r) => r.url().endsWith(`/api/chapters/${A}/summary`) && r.request().method() === "PATCH");
  await summary.fill("My own summary.");
  await savedSummary;
  ok((await box.locator(".desk-fold .desk-chip").innerText()) === "yours · not rewritten", "an edited summary is marked yours · not rewritten");
  ok((await send("GET", `/api/chapters/${A}`)).chapter.summary === "My own summary.", "…and saved to the chapter");
  const handBack = page.waitForResponse((r) => r.url().endsWith(`/api/chapters/${A}/summary`) && r.request().method() === "PATCH");
  await box.getByRole("button", { name: "Let the AI rewrite it" }).click();
  await handBack;
  ok((await box.locator(".desk-fold .desk-chip").count()) === 0, "Let the AI rewrite it hands it back");

  // ---- the ⋯ menu, and Remove the AI mark ----
  const bar = page.locator(".desk-bar");
  await bar.getByLabel("More for this chapter").click();
  const menu = bar.locator(".more-menu-items");
  const items = (await menu.locator(":scope > a, :scope > button").allInnerTexts()).map((t) => t.trim());
  ok(items.join("|") === "History|Write ahead…|Open the reading page|Remove the AI mark|Replace branch…|Move to trash…", "the ⋯ menu: " + items.join(" | "));
  ok((await menu.getByLabel("Summary model").count()) === 1, "…with the summary model at the top");
  ok(await menu.getByRole("button", { name: "Replace branch…" }).isDisabled(), "Replace branch is off with nothing written below");
  await menu.getByRole("button", { name: "Remove the AI mark" }).click();
  ok(!!(await until(async () => (await send("GET", `/api/chapters/${A}`)).chapter.ai_owned_at !== null)), "Remove the AI mark drops the mark");

  // ---- Draft not used ----
  await page.getByLabel("Chapter text").fill("Changed by hand.").catch(async () => {
    await box.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Chapter text").fill("Changed by hand.");
  });
  await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
  await sleep(700);
  ok(await update.isEnabled(), "a hand edit turns Update on");
  const reader = await context.newPage();
  await reader.goto(`${BASE}/c/${R}`);
  ok((await reader.locator(".choice-written", { hasText: "Go on" }).locator(".draft-mark").innerText()) === "Draft not used", "the reading page marks the choice whose chapter has a draft not used");
  await reader.goto(`${BASE}/drafts`);
  const row = reader.locator(".card", { hasText: "Chapter A" });
  ok((await row.locator(".draft-mark").innerText()) === "Draft not used", "…and so does the Drafts list");

  // ---- a new chapter: unfolded, Post off until there is text ----
  await page.goto(`${BASE}/c/${R}/desk?choice=${turnBack.id}`);
  const nbox = page.locator("section.desk-box");
  await nbox.getByLabel("Chapter title").waitFor();
  ok((await nbox.getByRole("button", { name: /Prompt and drafts/ }).getAttribute("aria-expanded")) === "true", "Prompt and drafts is unfolded on a new chapter");
  ok(await page.locator("aside.desk-side").getByLabel("New entry").isVisible(), "the codex column works on a new chapter");
  const postButton = nbox.getByRole("button", { name: "Post chapter" });
  ok(await postButton.isDisabled(), "Post chapter is off until there is text");
  await page.locator(".desk-bar").getByLabel("More for this chapter").click();
  const newItems = (await page.locator(".desk-bar .more-menu-items").locator(":scope > a, :scope > button").allInnerTexts()).map((t) => t.trim());
  ok(newItems.join("|") === "Discard draft…", "a new chapter's ⋯ menu: the summary model and Discard draft…: " + newItems.join("|"));
  await page.locator(".desk-bar .more-menu > summary").click();
  await nbox.getByLabel("Chapter text").fill("They turned back.");
  ok(await postButton.isEnabled(), "…and on once there is");
  await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
  await reader.goto(`${BASE}/c/${R}`);
  ok((await reader.locator(".choice-unwritten", { hasText: "Turn back" }).locator(".choice-draft").innerText()).trim() === "draft", "the unposted chapter shows 'draft' on its choice");
  await postButton.click();
  await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1$/);
  const B = new URL(page.url()).pathname.split("/")[2];
  const posted = (await send("GET", `/api/chapters/${B}`)).chapter;
  ok(posted.body === "They turned back." && posted.title === "Turn back", "Post makes the chapter (titled with its choice when it has none)");
  await page.locator("section.desk-box").getByLabel("Chapter title").waitFor();
  ok((await page.locator("section.desk-box .desk-fold").first().getAttribute("aria-expanded")) === "false" && (await page.locator(".desk-bar-note").innerText()).startsWith("Posted"), "…and the desk stays on it, as a posted chapter");
  ok((await send("GET", `/api/drafts/${encodeURIComponent(`fill:${turnBack.id}`)}`)).draft === undefined, "…its draft is gone");
  ok(!!(await until(async () => (await send("GET", `/api/chapters/${B}`)).chapter.summary === "The AI's summary.")), "…and its summary is written in the background");

  // ---- phone width ----
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/c/${A}/desk`);
  await page.locator("section.desk-box").getByLabel("Chapter title").waitFor();
  await page.locator("section.desk-box .desk-fold").first().click();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "at phone width the box fits the screen");
  await reader.close();
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  for (const key of drafts) await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  await browser.close();
  await ai.restore();
  await fake.close();
}
process.exit(failed ? 1 : 0);
