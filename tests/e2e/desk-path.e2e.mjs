import { startFakeAi } from "../fakeAi.mjs";
import { launch, useMockAi } from "./browser.mjs";
import { factRow, fillFact } from "./entryPage.mjs";

// The writing desk's path and choices (step 5): the earlier chapters as blocks that fold (title and text unfolded,
// summary folded), "Unfold all" / "Fold all", ✎ moving the desk to a block's chapter with the fold states kept;
// opening from the reading page's Edit starting unfolded and scrolled to the box; the "→ …" line renaming the choice in place;
// "What happens next?" (a written choice opens its chapter on the desk, an unwritten one starts its draft, Add a new
// suggestion, Suggest choices); "Draft not used" and "draft"; Back between two desks keeping the folds. And on a new
// chapter: a new entry and facts held in the draft (shown on the desk, not saved), then saved at it by Post.
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
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(100);
  }
};
const codexAt = async (chapter, name) => (await send("GET", `/api/chapters/${chapter}/codex`)).entries.find((e) => e.name === name);
const putDraft = (key, fields) =>
  send("PUT", `/api/drafts/${encodeURIComponent(key)}`, {
    draft: { key, href: "/", label: key, updatedAt: 0, storyTitle: "", premise: "", newChoiceLabel: "", title: "", body: "", choices: [""], prompt: "", undo: [], ...fields },
    base: null,
  });

const fake = await startFakeAi({
  port: 3222,
  delay: 5,
  reply: (body) => {
    const system = body.messages?.[0]?.content ?? "";
    if (system.includes("Output format")) return "# Moth\n\nMoth flew.";
    if (system.includes("running summary")) return "SUMMARY: A summary.\nSTORY SO FAR: So far.";
    if (system.includes("button text and nothing else")) return "Go";
    return "1. Run\n2. Hide";
  },
});
const ai = await useMockAi(BASE, { autoSuggestChoices: false });
const browser = await launch();
const drafts = [];
try {
  // Root -> A ("Go on") -> B ("Climb") -> C ("Written next"); B also has "Unwritten one" and "Has a draft".
  const story = await post("/api/stories", { title: "Path Tale", premise: "p", chapter: { title: "Root", body: "It began in the Hollow.", choices: ["Go on"] } });
  const R = story.chapter_id;
  const choiceOf = async (id, label) => (await send("GET", `/api/chapters/${id}`)).choices.find((c) => c.label === label);
  const A = (await post("/api/chapters", { choice_id: (await choiceOf(R, "Go on")).id, title: "Chapter A", body: "A walked on.", summary: "A walks.", choices: ["Climb"] })).chapter_id;
  const B = (await post("/api/chapters", { choice_id: (await choiceOf(A, "Climb")).id, title: "Chapter B", body: "B climbed.", choices: ["Written next", "Unwritten one", "Has a draft"] })).chapter_id;
  const C = (await post("/api/chapters", { choice_id: (await choiceOf(B, "Written next")).id, title: "Chapter C", body: "C came next." })).chapter_id;
  const unwritten = await choiceOf(B, "Unwritten one");
  const hasDraft = await choiceOf(B, "Has a draft");
  drafts.push(`edit:${A}`, `edit:${B}`, `edit:${C}`, `edit:${R}`, `fill:${hasDraft.id}`, `fill:${unwritten.id}`, `new:${B}`);
  // Work left behind: A and C have drafts not used, "Has a draft" a draft.
  await putDraft(`edit:${A}`, { title: "Chapter A", body: "A walked on, differently." });
  await putDraft(`edit:${C}`, { title: "Chapter C", body: "C came next, differently." });
  await putDraft(`fill:${hasDraft.id}`, { newChoiceLabel: "Has a draft", body: "Begun." });
  const wren = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Wren", type: "character", aliases: [], content: "" })).entry_id;
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: wren, op: "set", aspect: "Hair", text: "short and brown" });
  await send("PUT", "/api/queue/paused", { paused: true });

  const context = await browser.newContext({ viewport: { width: 1400, height: 700 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const blocks = page.locator("article.desk-block");
  const block = (n) => page.locator(`article.desk-block[aria-label^="Chapter ${n}:"]`);
  const fold = (n) => block(n).locator(".desk-block-fold");
  const isOpen = async (n) => (await fold(n).getAttribute("aria-expanded")) === "true";
  const boxTitle = () => page.locator("section.desk-box").getByLabel("Chapter title");
  // The box's top is just under the site's header, unless the page can't scroll that far.
  const scrolledToBox = () =>
    until(() =>
      page.evaluate(() => {
        const top = document.querySelector(".desk-here").getBoundingClientRect().top;
        const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0;
        const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        return window.scrollY > 0 && ((top >= 0 && top <= header + 40) || (atEnd && top >= 0 && top < window.innerHeight / 2));
      }),
    );

  // ---- opened from outside (the reading page's Edit): every block unfolded, scrolled to the box ----
  await page.goto(`${BASE}/c/${B}`);
  await page.waitForLoadState("load");
  await page.locator(".chapter-actions").getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(`**/c/${B}/desk`);
  await boxTitle().waitFor();
  ok((await blocks.count()) === 2, "two blocks above the box: Root and Chapter A");
  ok((await isOpen(1)) && (await isOpen(2)), "opened from outside, every block starts unfolded");
  ok((await block(1).locator(".prose").innerText()).includes("It began in the Hollow."), "an unfolded block shows the chapter's text");
  ok((await block(2).innerText()).includes("Chapter A") && (await block(2).locator(".desk-block-fold small").count()) === 0, "…with its title, and no summary");
  ok(!!(await until(async () => (await page.evaluate(() => window.scrollY)) > 100)), "the page is scrolled down to the chapter's box");
  ok(await scrolledToBox(), "…with the box at the top of the window (or the page scrolled as far as it goes)");
  ok((await block(2).locator(".draft-mark").innerText()) === "Draft not used" && (await block(1).locator(".draft-mark").count()) === 0, "Chapter A's block is marked Draft not used, Root's isn't");
  ok((await page.locator(".desk-via").allInnerTexts()).map((t) => t.trim()).join("|") === "→ Go on|→ Climb", "the choices leading to A and to the box show as → lines");

  // ---- folding ----
  await fold(1).click();
  ok(!(await isOpen(1)) && (await block(1).locator(".desk-block-fold small").innerText()) === "No summary yet" && (await block(1).locator(".prose").count()) === 0, "a folded block shows its title and summary line, no text");
  await fold(2).click();
  ok((await block(2).locator(".desk-block-fold small").innerText()) === "A walks.", "…the chapter's summary when it has one");
  const all = page.locator(".desk-path-head button");
  ok((await all.innerText()) === "Unfold all", "with every block folded the button says Unfold all");
  await all.click();
  ok((await isOpen(1)) && (await isOpen(2)) && (await all.innerText()) === "Fold all", "Unfold all unfolds them, and the button says Fold all");
  await all.click();
  ok(!(await isOpen(1)) && !(await isOpen(2)), "Fold all folds them");
  await fold(2).click(); // Root folded, Chapter A unfolded

  // ---- ✎ moves the desk to that chapter, keeping fold states ----
  await block(2).getByRole("link", { name: "Edit “Chapter A”" }).click();
  await page.waitForURL(`**/c/${A}/desk`);
  await until(async () => (await boxTitle().inputValue()) === "Chapter A");
  ok((await blocks.count()) === 1 && !(await isOpen(1)), "✎ on Chapter A: the desk is on it, with Root above it still folded");
  // Back on B by its choice in "What happens next?": A was unfolded, and stays so.
  await page.locator(".desk-next").getByRole("link", { name: /Climb/ }).click();
  await page.waitForURL(`**/c/${B}/desk`);
  await until(async () => (await boxTitle().inputValue()) === "Chapter B");
  ok(!(await isOpen(1)) && (await isOpen(2)), "a written choice opens its chapter on the desk, the folds as they were");
  ok(await scrolledToBox(), "…scrolled to its box");

  // ---- the → line: rename in place ----
  const revision = (await send("GET", `/api/chapters/${B}`)).chapter.revision;
  await page.locator(".desk-here").getByRole("button", { name: /Choice that leads here: Climb/ }).click();
  const via = page.locator(".desk-here").getByLabel("Choice text");
  await via.fill("Climb the stair");
  await via.press("Enter");
  ok(!!(await until(async () => (await choiceOf(A, "Climb the stair")) !== undefined)), "the → line renames the choice that leads here");
  ok((await send("GET", `/api/chapters/${B}`)).chapter.revision === revision, "…without changing the chapter");
  ok(!!(await until(async () => (await page.locator(".desk-here .desk-via").innerText()).includes("Climb the stair"))), "…and shows the new text");

  // ---- What happens next? ----
  const next = page.locator(".desk-next");
  ok((await next.getByRole("heading").innerText()) === "What happens next?", "under the box: What happens next?");
  const rows = await next.locator(".choice-written, .choice-unwritten").allInnerTexts();
  ok(rows.length === 3 && rows[0].includes("Written next") && rows[1].includes("Unwritten one") && rows[2].includes("Has a draft"), "a row per choice: " + rows.join(" | "));
  ok((await next.locator(".choice-written", { hasText: "Written next" }).locator(".draft-mark").innerText()) === "Draft not used", "the written choice whose chapter has a draft not used is marked");
  ok((await next.locator(".choice-unwritten", { hasText: "Has a draft" }).locator(".choice-draft").innerText()).trim() === "draft", "the unwritten choice with a draft shows 'draft'");
  ok((await next.locator(".choice-unwritten", { hasText: "Unwritten one" }).getAttribute("href")) === `/c/${B}/desk?choice=${unwritten.id}`, "an unwritten choice links to its new chapter on the desk");

  // Add a new suggestion, and Suggest choices (the AI)
  await next.getByLabel("Add a new suggestion").fill("Another way");
  await next.getByLabel("Add a new suggestion").press("Enter");
  ok(!!(await until(() => next.locator(".choice-unwritten", { hasText: "Another way" }).isVisible())), "Add a new suggestion adds an unwritten choice to the list");
  await next.getByRole("button", { name: "Suggest choices" }).click();
  await next.getByRole("button", { name: "+ Hide" }).click();
  ok(!!(await until(() => next.locator(".choice-unwritten", { hasText: "Hide" }).isVisible())), "Suggest choices offers choices; one picked joins the list");
  ok((await boxTitle().inputValue()) === "Chapter B", "…and the desk stays on the chapter");

  // A written choice opens its chapter; Back comes back to B with the folds kept.
  await next.locator(".choice-written", { hasText: "Written next" }).click();
  await page.waitForURL(`**/c/${C}/desk`);
  await until(async () => (await boxTitle().inputValue()) === "Chapter C");
  ok((await blocks.count()) === 3 && !(await isOpen(1)) && (await isOpen(2)) && !(await isOpen(3)), "Chapter C: Root folded, A unfolded, B (new as a block) folded");
  await page.goBack();
  await page.waitForURL(`**/c/${B}/desk`);
  await until(async () => (await boxTitle().inputValue()) === "Chapter B");
  ok(!(await isOpen(1)) && (await isOpen(2)), "Back to B keeps the fold states");

  // ---- an unwritten choice starts its draft, on the desk ----
  await next.locator(".choice-unwritten", { hasText: "Unwritten one" }).click();
  await page.waitForURL(`**/c/${B}/desk?choice=${unwritten.id}`);
  const nbox = page.locator("section.desk-box");
  await nbox.getByRole("button", { name: "Post chapter" }).waitFor();
  ok((await blocks.count()) === 3 && !(await isOpen(1)) && (await isOpen(2)), "a new chapter's desk: every chapter above it is a block, folds kept");
  ok((await page.locator(".desk-here .desk-via").innerText()).includes("Unwritten one"), "…the → line shows its choice");
  ok((await page.locator(".desk-next").count()) === 0, "…and no What happens next? until it is posted");

  // ---- codex changes on a new chapter: held in the draft ----
  await page.locator("aside.desk-side").getByLabel("New entry").click();
  const entryCol = page.locator("section.desk-entry");
  ok((await entryCol.locator(".desk-held-note").innerText()).includes("saved when you post it"), "the entry column says changes are saved when the chapter is posted");
  await entryCol.getByLabel("Name").fill("Moth");
  await entryCol.getByRole("button", { name: "Add entry" }).click();
  await page.locator('section.desk-entry[aria-label="Codex entry: Moth"]').waitFor();
  await entryCol.locator(".entry-facts").getByRole("button", { name: "+ Add a fact" }).click();
  await fillFact(page, { aspect: "Wings", text: "dusty grey" });
  await factRow(page, "dusty grey").waitFor();
  ok((await factRow(page, "dusty grey").innerText()).includes("changed here"), "a fact added to the new entry shows, held for this chapter");
  await page.locator("aside.desk-side .desk-row", { hasText: "Wren" }).click();
  await page.locator('section.desk-entry[aria-label="Codex entry: Wren"]').waitFor();
  await entryCol.locator(".entry-facts").getByRole("button", { name: "+ Add a fact" }).click();
  await fillFact(page, { aspect: "Eyes", text: "green as moss" });
  await factRow(page, "green as moss").waitFor();
  ok((await entryCol.locator(".desk-held-note").innerText()).includes("Wren has changes held"), "an entry with held changes says so");
  const heldRows = await page.locator("aside.desk-side .desk-row", { has: page.locator(".desk-chip", { hasText: "held" }) }).allInnerTexts();
  ok(heldRows.some((t) => t.includes("Moth")) && heldRows.some((t) => t.includes("Wren")), "the codex list marks Moth and Wren 'held'");
  await entryCol.getByLabel("More entry actions").click();
  const retire = entryCol.getByRole("button", { name: "Retire…" });
  ok((await retire.isDisabled()) && ((await retire.getAttribute("title")) ?? "").startsWith("Post the chapter first"), "Retire waits for the Post (greyed out, with why)");
  await entryCol.getByLabel("More entry actions").click();
  await page.waitForTimeout(800);
  const held = (await send("GET", `/api/drafts/${encodeURIComponent(`fill:${unwritten.id}`)}`)).draft;
  ok(held?.codexChanges?.length === 1 && held?.codexFactChanges?.length === 2, "the draft holds the new entry and both facts");
  ok((await codexAt(B, "Moth")) === undefined && !(await codexAt(B, "Wren")).description.includes("green as moss"), "…and nothing is saved yet");

  // Post saves them at the new chapter.
  await nbox.getByLabel("Chapter text").fill("Moth flew past Wren.");
  await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
  await nbox.getByRole("button", { name: "Post chapter" }).click();
  await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1$/);
  const D = new URL(page.url()).pathname.split("/")[2];
  await boxTitle().waitFor();
  const moth = await codexAt(D, "Moth");
  ok(!!moth && moth.description.includes("dusty grey"), "Post saves the new entry and its fact at the new chapter");
  ok((await codexAt(D, "Wren")).description.includes("green as moss") && !(await codexAt(B, "Wren")).description.includes("green as moss"), "…and Wren's fact from the new chapter on, not before");
  ok((await blocks.count()) === 3 && !(await isOpen(1)) && (await isOpen(2)), "after Post the desk is on the new chapter, the folds kept");
  ok((await page.locator(".desk-next").count()) === 1, "…and What happens next? shows once it is posted");

  // ---- Edit again: from outside, unfolded whatever the folds were ----
  await page.goto(`${BASE}/c/${B}`);
  await page.waitForLoadState("load");
  await page.locator(".chapter-actions").getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(`**/c/${B}/desk`);
  await boxTitle().waitFor();
  ok((await isOpen(1)) && (await isOpen(2)), "opened from the reading page's Edit again, the blocks start unfolded");

  // ---- phone width ----
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await boxTitle().waitFor();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "at phone width the path, box and choices fit the screen");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  for (const key of drafts) await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  for (const item of (await send("GET", "/api/queue")).items ?? []) await fetch(`${BASE}/api/queue/items/${item.key}`, { method: "DELETE" });
  await send("PUT", "/api/queue/paused", { paused: false });
  await browser.close();
  await ai.restore();
  await fake.close();
}
process.exit(failed ? 1 : 0);
