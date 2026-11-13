import { startFakeAi } from "../fakeAi.mjs";
import { launch, useMockAi } from "./browser.mjs";
import { factRow, fillFact } from "./entryPage.mjs";

// The writing desk's text tied to the codex (step 7) and the prompt toggle on the codex rows: the entries the chapter's
// text names are listed under it, change as the text does, and open their entry; words selected in the text (or in an
// unfolded block of the path) and "Add as a fact…" open the new-fact form with them as its quote, in the entry they
// name or one picked, saved at a posted chapter and held in the draft of a new one. Each codex row's toggle pins the
// entry to the prompt or leaves it out (kept in the draft), the rows are marked, and Generate sends what was picked.
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
const draftOf = async (key) => (await send("GET", `/api/drafts/${encodeURIComponent(key)}`)).draft;

const fake = await startFakeAi({
  port: 3222,
  delay: 5,
  reply: (body) => {
    const system = body.messages?.[0]?.content ?? "";
    if (system.includes("Output format")) return "# Chapter A\n\nA new text.";
    if (system.includes("running summary")) return "SUMMARY: A summary.\nSTORY SO FAR: So far.";
    if (system.includes("button text and nothing else")) return "Go";
    return "1. Run\n2. Hide";
  },
});
const ai = await useMockAi(BASE);
const browser = await launch();
const drafts = [];
try {
  // Root -> A (-> "Onward", unwritten). Mara, Tobin (keyword "the smith"), the Mill and the Lantern start at the root.
  const story = await post("/api/stories", { title: "Text Tale", premise: "p", chapter: { title: "Root", body: "Mara met Tobin at the Mill.", choices: ["Go on"] } });
  const R = story.chapter_id;
  const A = (await post("/api/chapters", { choice_id: (await send("GET", `/api/chapters/${R}`)).choices[0].id, title: "Chapter A", body: "Mara walked to the Mill. Her cloak was green.", choices: ["Onward"] })).chapter_id;
  const onward = (await send("GET", `/api/chapters/${A}`)).choices.find((c) => c.label === "Onward");
  drafts.push(`edit:${A}`, `edit:${R}`, `fill:${onward.id}`);
  const make = async (name, type, aliases = []) => (await post("/api/codex", { anchor_chapter_id: R, op: "create", name, type, aliases, content: "" })).entry_id;
  const mara = await make("Mara", "character");
  const tobin = await make("Tobin", "character", ["the smith"]);
  const mill = await make("The Mill", "place");
  const lantern = await make("Lantern", "item");
  // Facts, so each entry has a line in the prompt when it is sent.
  for (const [id, aspect, text] of [[mara, "Hair", "red and long"], [tobin, "Trade", "smith"], [mill, "Look", "old stone"], [lantern, "Light", "glows blue"]]) {
    await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: id, op: "set", aspect, text });
  }

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const side = page.locator("aside.desk-side");
  const box = page.locator("section.desk-box");
  const textBox = box.getByLabel("Chapter text");
  const namedLine = box.locator(".desk-named");
  const namedNames = async () => (await namedLine.locator(".desk-name").allInnerTexts().catch(() => [])).sort().join(",");
  const entryCol = (name) => page.locator(`section.desk-entry[aria-label="Codex entry: ${name}"]`);
  /** Selects these words in the chapter's text box, as a drag would. */
  const selectInText = async (words) => {
    await textBox.focus();
    await textBox.evaluate((el, w) => {
      const at = el.value.indexOf(w);
      el.setSelectionRange(at, at + w.length);
    }, words);
    await page.keyboard.press("Shift");
  };

  // ---- a posted chapter: the names under the text ----
  await page.goto(`${BASE}/c/${A}/desk`);
  await textBox.waitFor();
  await until(async () => (await namedNames()) === "Mara,The Mill");
  ok((await namedNames()) === "Mara,The Mill", "under the text: the entries it names (Mara, the Mill): " + (await namedNames()));
  const tb = await textBox.boundingBox();
  const lb = await namedLine.boundingBox();
  ok(lb.y >= tb.y + tb.height - 2, "…right under the text box");
  await textBox.fill("Mara walked with the smith. Her cloak was green.");
  await until(async () => (await namedNames()) === "Mara,Tobin");
  ok((await namedNames()) === "Mara,Tobin", "…they change as the text does (a keyword names Tobin; the Mill is gone): " + (await namedNames()));
  await namedLine.getByRole("button", { name: "Tobin", exact: true }).click();
  await entryCol("Tobin").waitFor();
  ok(await entryCol("Tobin").isVisible(), "a name opens its entry in the entry column");
  ok((await namedLine.getByRole("button", { name: "Tobin", exact: true }).getAttribute("aria-current")) === "true", "…and is marked as the one open");
  ok((await namedLine.getByRole("button", { name: "Add as a fact…" }).count()) === 0, "no Add as a fact… without a selection");

  // ---- select words, Add as a fact…: no entry named, so one is picked ----
  await entryCol("Tobin").getByRole("button", { name: "Close entry" }).click();
  await selectInText("Her cloak was green.");
  const addFact = namedLine.getByRole("button", { name: "Add as a fact…" });
  await addFact.waitFor();
  ok(true, "selecting words in the text offers Add as a fact… on the line under it");
  await addFact.click();
  const picker = page.locator("section.desk-entry").getByLabel("Entry for the fact");
  await picker.waitFor();
  ok((await picker.inputValue()) === "" && (await page.locator('section.desk-entry[aria-label="Add as a fact"] .fact-quote').innerText()).includes("Her cloak was green."), "…words naming no entry: the quote shows and an entry is to be chosen");
  await picker.selectOption({ label: "Mara" });
  await entryCol("Mara").waitFor();
  const quoteShown = entryCol("Mara").locator(".ef-editor .ef-quote");
  ok((await quoteShown.innerText()).includes("Her cloak was green."), "…picking Mara opens her new-fact form with the words as its quote");
  await fillFact(page, { aspect: "Cloak", text: "green" });
  await factRow(page, "green").waitFor();
  const cloak = (await until(async () => (await codexAt(A, "Mara")).facts.find((f) => f.text === "green")))?.op;
  ok(cloak?.anchor_chapter_id === A && cloak?.quote === "Her cloak was green.", "…saved at once at the chapter, with the quote: " + JSON.stringify(cloak && { at: cloak.anchor_chapter_id === A, quote: cloak.quote }));
  ok(!(await codexAt(R, "Mara")).facts.some((f) => f.text === "green"), "…and not before it");
  ok((await page.locator(".desk-quote-pick").count()) === 0, "…and the picker is gone once it is saved");

  // ---- words that name an entry: it is the one picked, and Cancel ----
  await selectInText("the smith");
  await addFact.click();
  await entryCol("Tobin").waitFor();
  ok((await picker.inputValue()) === tobin && (await entryCol("Tobin").locator(".ef-quote").innerText()).includes("the smith"), "words that name Tobin (by keyword) pick Tobin");
  await page.locator(".desk-quote-pick").getByRole("button", { name: "Cancel" }).click();
  ok((await page.locator(".desk-quote-pick").count()) === 0, "Cancel puts the quote away");

  // ---- in an unfolded block of the path ----
  const rootText = page.locator('article.desk-block[aria-label^="Chapter 1:"] .desk-block-text');
  await rootText.locator(".prose").waitFor();
  await rootText.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.textContent.indexOf("the Mill");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "the Mill".length);
      document.getSelection().removeAllRanges();
      document.getSelection().addRange(range);
      return;
    }
  });
  const blockAdd = rootText.getByRole("button", { name: "Add as a fact…" });
  await blockAdd.waitFor();
  await blockAdd.click();
  await entryCol("The Mill").waitFor();
  ok((await entryCol("The Mill").locator(".ef-quote").innerText()).includes("the Mill"), "words selected in a path block offer Add as a fact… too (the Mill picked)");
  await page.locator(".desk-quote-pick").getByRole("button", { name: "Cancel" }).click();
  await entryCol("The Mill").getByRole("button", { name: "Close entry" }).click();

  // ---- the prompt toggle: pin the Lantern, leave Mara out ----
  const things = side.locator(".desk-group", { hasText: "Things" });
  const lanternRow = things.locator(".desk-row-item", { hasText: "Lantern" });
  ok((await side.locator(".desk-group", { hasText: "In this chapter" }).locator(".desk-row-name", { hasText: "Lantern" }).count()) === 0, "the Lantern isn't in this chapter at first");
  await lanternRow.getByRole("button", { name: "Pin Lantern to the prompt" }).click();
  await lanternRow.locator(".desk-pick-chip", { hasText: "pinned" }).waitFor();
  ok(true, "the toggle pins the Lantern, and its row says pinned");
  ok((await side.locator(".desk-group", { hasText: "In this chapter" }).locator(".desk-row-item", { hasText: "Lantern" }).locator(".desk-pick-chip", { hasText: "pinned" }).count()) === 1, "…a pinned entry is listed under In this chapter, though the text doesn't name it");
  const maraRow = side.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row-item", { hasText: "Mara" });
  await maraRow.getByRole("button", { name: "Pin Mara to the prompt" }).click();
  await maraRow.getByRole("button", { name: "Leave Mara out of the prompt" }).click();
  await maraRow.locator(".desk-pick-chip", { hasText: "left out" }).waitFor();
  ok(await maraRow.evaluate((li) => getComputedStyle(li.querySelector(".desk-row-name")).textDecorationLine === "line-through"), "a second click leaves Mara out: marked left out, her name struck through");
  const kept = await until(async () => {
    const d = await draftOf(`edit:${A}`);
    return d?.codexOverrides?.include?.includes(lantern) && d.codexOverrides.exclude?.includes(mara) && !d.codexOverrides.include.includes(mara) ? d : null;
  });
  ok(!!kept, "…both kept in the draft's codexOverrides: " + JSON.stringify((await draftOf(`edit:${A}`))?.codexOverrides));

  // Generate sends the pinned Lantern and leaves Mara out, though Root and the text name her.
  await box.getByRole("button", { name: /Prompt and drafts/ }).click();
  await box.getByLabel("Prompt", { exact: true }).fill("Mara goes on.");
  const before = fake.requests.length;
  await box.locator(".desk-gen-row").getByRole("button", { name: /^Generate/ }).click();
  const req = await until(async () => fake.requests.slice(before).find((r) => (r.body.messages?.[0]?.content ?? "").includes("Output format")), 20000);
  const sent = (req?.body.messages ?? []).map((m) => m.content).join("\n");
  ok(/Lantern \[item\]/.test(sent) && /glows blue/.test(sent), "Generate sends the pinned Lantern with the prompt");
  ok(!/Mara \[character\]/.test(sent) && !/red and long/.test(sent), "…and leaves out Mara");
  ok(/Tobin \[character\]/.test(sent), "…while Tobin, named in the story, still goes as usual");
  await page.waitForFunction(() => !/Writing/.test(document.querySelector(".desk-gen-row")?.textContent ?? ""), null, { timeout: 20000 });

  // The third click puts Mara back to auto.
  await maraRow.getByRole("button", { name: /Let the text decide whether Mara/ }).click();
  ok(!!(await until(async () => (await maraRow.locator(".desk-pick-chip").count()) === 0)), "a third click puts Mara back to auto (no mark)");

  // ---- a new chapter: names include entries held in the draft, a fact from the text is held ----
  await page.goto(`${BASE}/c/${A}/desk?choice=${onward.id}`);
  await box.getByRole("button", { name: "Post chapter" }).waitFor();
  await side.getByLabel("New entry").click();
  const col = page.locator("section.desk-entry");
  await col.getByLabel("Name").fill("Pell");
  await col.getByRole("button", { name: "Add entry" }).click();
  await entryCol("Pell").waitFor();
  await entryCol("Pell").getByRole("button", { name: "Close entry" }).click();
  await textBox.fill("Pell ran past Tobin, quick as a hare.");
  await until(async () => (await namedNames()) === "Pell,Tobin");
  ok((await namedNames()) === "Pell,Tobin", "on a new chapter the names under the text include an entry held in the draft (Pell): " + (await namedNames()));
  await selectInText("Pell ran");
  await addFact.click();
  await entryCol("Pell").waitFor();
  ok((await picker.inputValue()).startsWith("draft-"), "…words naming the held entry pick it");
  await fillFact(page, { aspect: "Speed", text: "quick as a hare" });
  await factRow(page, "quick as a hare").waitFor();
  const heldFact = await until(async () => (await draftOf(`fill:${onward.id}`))?.codexFactChanges?.find((f) => f.text === "quick as a hare"));
  ok(heldFact?.quote === "Pell ran", "…the fact is held in the draft with its quote: " + JSON.stringify(heldFact));
  ok((await codexAt(A, "Pell")) === undefined, "…and nothing is saved yet");
  // A held entry can be pinned too.
  const pellRow = side.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row-item", { hasText: "Pell" });
  await pellRow.getByRole("button", { name: "Pin Pell to the prompt" }).click();
  await pellRow.locator(".desk-pick-chip", { hasText: "pinned" }).waitFor();
  ok(!!(await until(async () => (await draftOf(`fill:${onward.id}`))?.codexOverrides?.include?.some((k) => k.startsWith("draft-")))), "a held entry pins in the new chapter's draft");

  // ---- phone width: the line under the text fits ----
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/c/${A}/desk`);
  await textBox.fill("Mara walked with Tobin and the smith to the Mill, carrying the Lantern.");
  await until(async () => (await namedNames()) === "Lantern,Mara,The Mill,Tobin");
  ok((await namedNames()) === "Lantern,Mara,The Mill,Tobin", "at phone width the names show under the text");
  await selectInText("carrying the Lantern");
  await sleep(300);
  ok((await page.getByRole("button", { name: "Add as a fact…" }).count()) === 0, "…but no Add as a fact… on a phone (the codex is for looking things up there)");
  await namedLine.getByRole("button", { name: "Mara", exact: true }).click();
  const read = page.locator('section.desk-phone-entry[aria-label="Codex entry: Mara"]');
  await read.waitFor();
  ok((await read.innerText()).includes("red and long") && (await page.locator(".desk-tabbar").getByRole("button", { name: "Codex" }).getAttribute("aria-pressed")) === "true", "a name opens the entry to read in the phone's codex sheet");
  await page.locator(".desk-sheet-back").click();
  await side.locator(".desk-row-item").first().waitFor();
  ok((await side.locator(".desk-pick").count()) === 0 && (await side.locator(".desk-pick-chip", { hasText: "pinned" }).count()) > 0, "the phone's codex sheet has no prompt toggles, but still marks the pinned Lantern");
  await page.locator(".desk-sheet-head").getByRole("button", { name: "Close" }).click();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "at phone width the page fits the screen");
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
