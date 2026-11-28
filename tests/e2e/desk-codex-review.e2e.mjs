import { launch, useMockAi } from "./browser.mjs";

// Checking the AI's codex changes on the writing desk. On the desk of a chapter the AI has read (with "Apply the AI's
// codex changes automatically" on): the side column's entry row has an "AI n" chip; the entry's Facts tab lists the facts
// changed at the chapter first ("was …" or "new in this chapter"), each one the AI applied with Approve and Undo, and
// "Approve all" when there are two or more; an open suggestion is a marker under its fact (opening the Suggestions tab);
// and the side column's "Suggested entries" adds a new entry the AI found, or dismisses it.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE); // no automatic codex check: the reading below is posted by hand
const browser = await launch();
let sid = null;
try {
  const story = await post("/api/stories", { title: "Desk Review Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["Go"] } });
  sid = story.story_id;
  const R = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${R}`)).choices[0];
  const body = "Rowan's ears changed. Her eyes glowed amber. Her hair was russet. Her voice was a low rasp. Kestrel the hawk joined her. She moved with a limp.";
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body })).chapter_id;
  const rowan = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Rowan", type: "character" })).entry_id;
  const fact = (anchor, aspect, text) => post("/api/codex/facts", { anchor_chapter_id: anchor, entry_id: rowan, op: "set", aspect, form: "", text });
  await fact(R, "Ears", "round human ears");
  await fact(R, "Hair", "black hair");
  await fact(R, "Boots", "old boots");
  await fact(A, "Mood", "calm"); // the owner's own change at the chapter

  // The reading the server's codex check would save, with the setting on: four facts applied, an entry and a fact waiting.
  const settings = (await send("GET", "/api/settings")).settings;
  await send("PUT", "/api/settings", { ...settings, autoCodex: true, autoApplyCodex: true });
  const saved = await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: 1,
    suggestions: [
      { kind: "set", entry_id: rowan, aspect: "Ears", after: "tall fox ears", quote: "Rowan's ears changed" },
      { kind: "set", entry_id: rowan, aspect: "Eyes", after: "amber eyes", quote: "Her eyes glowed amber" },
      { kind: "set", entry_id: rowan, aspect: "Hair", after: "russet hair", quote: "Her hair was russet" },
      { kind: "set", entry_id: rowan, aspect: "Voice", after: "a low rasp", quote: "Her voice was a low rasp" },
      { kind: "entry", entry: { name: "Kestrel", type: "character", aliases: [], notes: "A hunting hawk.", facts: [] }, quote: "Kestrel the hawk joined her" },
      { kind: "set", entry_id: rowan, aspect: "Gait", after: "walks with a limp", quote: "Rowan's ears changed" }, // shows no part of the fact: waits
    ],
  });
  await send("PUT", "/api/settings", { ...settings, autoCodex: false, autoApplyCodex: true });
  ok(saved.applied === 4 && saved.saved === 6, "the reading is applied: " + JSON.stringify(saved));
  // A second entry whose changes wait for the owner (a Flesh out reading of it, so the first reading stays as it is; the
  // AI applies nothing from it): a contradiction, a fact to edit before keeping, and one in a category not on the list.
  const mira = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Mira", type: "character" })).entry_id;
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: mira, op: "set", aspect: "Eyes", form: "", text: "green" });
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: mira, op: "set", aspect: "Hair", form: "", text: "dark" });
  const waitingMira = await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: 1,
    source: "expand",
    entry_id: mira,
    suggestions: [
      { kind: "conflict", entry_id: mira, aspect: "Eyes", after: "amber", quote: "Her eyes glowed amber" },
      { kind: "set", entry_id: mira, aspect: "Hair", after: "russet", quote: "Her hair was russet" },
      { kind: "set", entry_id: mira, aspect: "Scarf", after: "a green scarf", quote: "She moved with a limp" },
    ],
  });
  ok(waitingMira.saved === 3 && !waitingMira.applied, "three changes for Mira wait for the owner: " + JSON.stringify(waitingMira));
  const rowanAt = async () => (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Rowan");
  const factOf = async (aspect) => (await rowanAt()).facts.find((f) => f.aspect === aspect);

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());

  await page.goto(`${BASE}/c/${A}/desk`);
  const side = page.locator("aside.desk-side");
  // (Rowan is named in the chapter, so the list has a row for him under "In this chapter" and one under Characters.)
  const rowanRow = side.locator(".desk-row", { has: page.locator(".desk-row-name", { hasText: /^Rowan$/ }) }).first();
  await rowanRow.waitFor();

  // ---- the side column ----
  const chip = rowanRow.locator(".desk-chip-ai");
  ok((await chip.innerText()).includes("AI 4"), "the entry's row has an 'AI 4' chip: " + (await rowanRow.innerText()).replace(/\s+/g, " "));
  const proposed = side.locator(".desk-proposed");
  await proposed.waitFor();
  ok(/suggested entries/i.test(await proposed.locator("summary").innerText()) && (await proposed.locator(".desk-row-name").allInnerTexts()).join() === "Kestrel", "'Suggested entries' lists the new entry the AI found: " + (await proposed.innerText()).replace(/\s+/g, " "));

  // ---- the Facts tab ----
  await rowanRow.click();
  const col = page.locator('section.desk-entry[aria-label="Codex entry: Rowan"]');
  await col.waitFor();
  await col.getByRole("tab", { name: "Facts" }).click();
  const here = col.getByRole("group", { name: "Changed in this chapter" });
  await here.waitFor();
  ok((await here.getByRole("heading").innerText()) === "Changed in this chapter (5)", "the group counts the five facts changed here: " + (await here.getByRole("heading").innerText()));
  const row = (g, aspect) => g.locator(".fact-row").filter({ has: page.locator(".ef-aspect", { hasText: new RegExp(`^${aspect}$`) }) });
  const since = async (aspect) => (await row(here, aspect).locator(".ef-since").innerText()).replace(/\s+/g, " ");
  ok((await since("Ears")).includes("was round human ears") && (await since("Hair")).includes("was black hair"), "a changed fact says what it was");
  ok((await since("Eyes")).includes("new in this chapter") && (await since("Voice")).includes("new in this chapter") && (await since("Mood")).includes("new in this chapter"), "a new fact says so");
  ok((await row(col, "Boots").count()) === 1 && (await row(here, "Boots").count()) === 0, "a fact from an earlier chapter is not in the group");
  ok((await col.getByRole("heading", { name: "From earlier chapters (1)" }).count()) === 1, "…it is under 'From earlier chapters'");
  const aiNote = (aspect) => row(here, aspect).locator(".ef-ai-note");
  ok((await aiNote("Ears").innerText()) === "Added by the AI" && (await aiNote("Eyes").count()) === 1 && (await aiNote("Mood").count()) === 0, "an AI fact says 'Added by the AI'; the owner's does not");
  ok((await col.locator(".ef-marker-ai").count()) === 0, "the old 'Approve or undo' marker is not shown on the desk");
  ok((await col.getByRole("button", { name: "Approve all 4" }).count()) === 1, "'Approve all 4' is offered");

  // ---- a suggestion for the entry is a marker under its fact ----
  const gait = col.locator(".ef-placeholder", { has: page.locator(".ef-aspect", { hasText: /^Gait$/ }) });
  const marker = gait.locator(".ef-marker");
  ok((await marker.count()) === 1 && (await marker.innerText()).includes("walks with a limp"), "an open suggestion shows under its fact in the desk's Facts tab");
  await marker.click();
  ok((await col.getByRole("tab", { name: /^Suggestions/ }).getAttribute("aria-selected")) === "true", "…and clicking it opens the Suggestions tab");
  await col.getByRole("tab", { name: "Facts" }).click();
  await here.waitFor();

  // ---- Approve: the line goes, the fact stays ----
  await here.getByRole("button", { name: "Approve Eyes", exact: true }).click();
  await aiNote("Eyes").waitFor({ state: "detached" });
  ok((await aiNote("Ears").count()) === 1 && (await row(here, "Eyes").count()) === 1, "Approve takes the AI line off that fact only; the fact stays");
  ok(!(await factOf("Eyes")).op.ai_suggestion_id && !!(await factOf("Ears")).op.ai_suggestion_id, "…on the server too");
  await chip.filter({ hasText: "AI 3" }).waitFor();
  ok(true, "the side row's chip counts down to 'AI 3'");

  // ---- Undo: the fact reads as it did before ----
  await here.getByRole("button", { name: "Undo Ears", exact: true }).click();
  await row(col, "Ears").locator(".ef-value", { hasText: "round human ears" }).waitFor();
  ok((await factOf("Ears")).text === "round human ears" && (await factOf("Ears")).op.anchor_chapter_id === R, "Undo puts the earlier text back");
  ok((await row(here, "Ears").count()) === 0 && (await col.getByRole("heading", { name: "From earlier chapters (2)" }).count()) === 1, "…and it is no longer one of the facts changed here");
  await chip.filter({ hasText: "AI 2" }).waitFor();
  ok(true, "the chip counts down to 'AI 2'");

  // ---- Approve all ----
  await here.getByRole("button", { name: "Approve all 2" }).click();
  await here.locator(".ef-ai-note").first().waitFor({ state: "detached" });
  ok((await here.locator(".ef-ai-note").count()) === 0 && (await here.getByRole("button", { name: /^Approve/ }).count()) === 0, "'Approve all' takes every AI line off");
  const after = await rowanAt();
  ok(after.facts.every((f) => !f.op.ai_suggestion_id), "…and no fact is the AI's on the server");
  ok((await rowanRow.locator(".desk-chip-ai").count()) === 0 && (await rowanRow.locator(".desk-chip-changed").innerText()) === "changed", "the side row's chip is 'changed' now, not 'AI n'");

  // ---- Suggested entries: Add it ----
  await proposed.getByRole("button", { name: "Add Kestrel to the codex" }).click();
  await side.locator(".desk-row", { has: page.locator(".desk-row-name", { hasText: /^Kestrel$/ }) }).first().waitFor();
  ok((await send("GET", `/api/chapters/${A}/codex`)).entries.some((e) => e.name === "Kestrel"), "'Add it' adds the entry to the codex, and to the list");
  ok((await proposed.getByRole("button", { name: /^Add Kestrel/ }).count()) === 0 && (await proposed.innerText()).includes("Added"), "…and the suggestion says 'Added'");

  // ---- the Suggestions tab: a contradiction, an edit before keeping, a new category, Dismiss and Undo ----
  const miraRow = side.locator(".desk-row", { has: page.locator(".desk-row-name", { hasText: /^Mira$/ }) }).first();
  await miraRow.click();
  const miraCol = page.locator('section.desk-entry[aria-label="Codex entry: Mira"]');
  await miraCol.waitFor();
  await miraCol.getByRole("tab", { name: /^Suggestions/ }).click();
  await miraCol.getByRole("heading", { name: "Waiting for you (3)" }).waitFor();
  const sug = (aspect) => miraCol.locator("li.desk-sug").filter({ has: page.locator("strong", { hasText: new RegExp(`^${aspect}$`) }) });
  const eyes = sug("Eyes");
  ok((await eyes.innerText()).includes("the text contradicts the codex: amber") && (await eyes.innerText()).includes("“Her eyes glowed amber”"), "a contradiction says so, with the change and the quote");
  ok((await eyes.getByRole("button", { name: "Keep", exact: true }).count()) === 1 && (await eyes.getByRole("button", { name: "Dismiss" }).count()) === 1 && (await eyes.getByRole("button", { name: "Edit", exact: true }).count()) === 0, "…Keep and Dismiss, and no Edit");
  ok((await eyes.getByLabel("Takes effect from").count()) === 1, "a change from a later chapter can take effect from an earlier one on the path");
  const scarf = sug("Scarf");
  ok((await scarf.locator(".desk-chip", { hasText: "New category" }).count()) === 1 && (await eyes.locator(".desk-chip").count()) === 0, "a category that isn't on the list is marked 'New category'");

  // Dismiss, then Undo brings it back.
  await scarf.getByRole("button", { name: "Dismiss" }).click();
  const scarfDone = miraCol.locator("li.desk-sug.done", { hasText: "Dismissed: Scarf" });
  await scarfDone.waitFor();
  await scarfDone.getByRole("button", { name: "Undo" }).click();
  await scarf.getByRole("button", { name: "Keep", exact: true }).waitFor();
  ok(true, "Dismiss collapses a suggestion to 'Dismissed', and Undo brings it back");

  // Edit, then Keep writes the edited words.
  const hair = sug("Hair");
  await hair.getByRole("button", { name: "Edit", exact: true }).click();
  ok((await hair.getByLabel("Fact").inputValue()) === "russet", "Edit opens the suggested words to reword");
  await hair.getByLabel("Fact").fill("russet, cut short");
  await hair.getByRole("button", { name: "Keep", exact: true }).click();
  await miraCol.locator("li.desk-sug.done", { hasText: "Kept: Hair" }).waitFor();
  const miraAt = async () => (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Mira");
  ok((await miraAt()).facts.find((f) => f.aspect === "Hair").text === "russet, cut short", "Keep after Edit saves the edited fact");

  // Keep on the contradiction changes the codex to the new words.
  await eyes.getByRole("button", { name: "Keep", exact: true }).click();
  await miraCol.locator("li.desk-sug.done", { hasText: "Kept: Eyes" }).waitFor();
  ok((await miraAt()).facts.find((f) => f.aspect === "Eyes").text === "amber", "Keep on a contradiction changes the codex");

  // ---- the old review page redirects to the desk, with the entry open ----
  await page.goto(`${BASE}/c/${A}/codex-review?entry=${rowan}`);
  await page.waitForURL(`${BASE}/c/${A}/desk?entry=${rowan}`);
  await page.locator('section.desk-entry[aria-label="Codex entry: Rowan"]').waitFor();
  ok(true, "/c/<id>/codex-review?entry=<id> lands on the desk with that entry open");
  await page.goto(`${BASE}/c/${A}/codex-review`);
  await page.waitForURL(`${BASE}/c/${A}/desk`);
  ok(true, "…and without ?entry= it lands on the desk");

  // ---- the reading page's banner leads to the desk ----
  await page.goto(`${BASE}/c/${A}`);
  const bannerLink = page.locator("p.notice", { hasText: "Codex:" }).getByRole("link", { name: "Review on the desk", exact: true });
  await bannerLink.waitFor();
  ok((await bannerLink.getAttribute("href")) === `/c/${A}/desk`, "the reading page's banner says 'Review on the desk' and links to the chapter's desk");

  await context.close();
} finally {
  if (sid) await send("DELETE", `/api/stories/${sid}`);
  await browser.close();
  await ai.restore();
}
if (failed) process.exit(1);
