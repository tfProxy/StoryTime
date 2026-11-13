import { launch, useMockAi } from "./browser.mjs";
import { factRow, fillFact } from "./entryPage.mjs";

// The writing desk (/c/<id>/desk) for a posted chapter: the reading page's Edit opening it; the codex column (Codex |
// Illustrate, search, "In this chapter", the type groups, the count badge, folding to a rail); an open entry (its tabs in
// order, Facts first, or Suggestions when some wait; a fact added and saved at once; Keep and Dismiss; Ask the AI for
// more); "+ ▾" (a new entry, or a shared entry linked in at once); and the chapter's editor beside it, with no codex drawer. The queue is paused, so no AI is called.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);
const clearQueue = async () => {
  for (const item of (await send("GET", "/api/queue")).items ?? []) await fetch(`${BASE}/api/queue/items/${item.key}`, { method: "DELETE" });
};
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    const v = await fn();
    if (v) return v;
  }
  return fn();
};
const codexAt = async (chapter, name) => (await send("GET", `/api/chapters/${chapter}/codex`)).entries.find((e) => e.name === name);

const ai = await useMockAi(BASE);
const browser = await launch();
let A = null;
try {
  // Root -> A (-> an unwritten choice). Wren, the Hollow and the Lantern start at the root; Oda at A.
  const story = await post("/api/stories", { title: "Desk Tale", premise: "p", chapter: { title: "Root", body: "Wren stood in the Hollow.", choices: ["Go on"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  A = (await post("/api/chapters", { choice_id: (await send("GET", `/api/chapters/${R}`)).choices[0].id, title: "Chapter A", body: "Wren walked with Oda. Oda laughed.", choices: ["Onward"] })).chapter_id;
  const make = async (at, name, type, aliases = []) => (await post("/api/codex", { anchor_chapter_id: at, op: "create", name, type, aliases, content: "" })).entry_id;
  const wren = await make(R, "Wren", "character", ["Little Bird"]);
  await make(R, "The Hollow", "place");
  await make(R, "Lantern", "item");
  const oda = await make(A, "Oda", "character");
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: wren, op: "set", aspect: "Hair", text: "short and brown" });
  // Two suggestions for Oda, from reading Chapter A, and one idea the AI made up for Wren
  const rev = (await send("GET", `/api/chapters/${A}`)).chapter.revision;
  await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: rev,
    suggestions: [
      { kind: "set", entry_id: oda, aspect: "Mood", form: "", after: "amused", quote: "Oda laughed" },
      { kind: "set", entry_id: oda, aspect: "Company", form: "", after: "walks with Wren", quote: "Wren walked with Oda" },
    ],
  });
  await post(`/api/chapters/${A}/codex-suggestions`, { revision: rev, source: "expand", entry_id: wren, suggestions: [{ kind: "set", entry_id: wren, aspect: "Voice", form: "", after: "low and dry", quote: "" }] });

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  await send("PUT", "/api/queue/paused", { paused: true });

  // ---- the reading page's Edit opens the desk ----
  await page.goto(`${BASE}/c/${A}`);
  await page.getByRole("heading", { name: "Chapter A" }).waitFor();
  await page.waitForLoadState("load");
  const actions = page.locator(".chapter-actions");
  ok((await actions.getByRole("link", { name: "Desk", exact: true }).count()) === 0, "the reading page has no separate Desk button");
  await actions.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(`${BASE}/c/${A}/desk`);
  const side = page.locator("aside.desk-side");
  await side.waitFor();
  // The editor has loaded the draft when its title box shows.
  await page.getByRole("heading", { name: "Edit “Chapter A”" }).waitFor();
  ok(true, "Edit opens the desk for the chapter");
  ok((await page.locator(".desk-bar").getByRole("link", { name: "Edit page" }).count()) === 0, "the desk's top bar has no link to an old Edit page");

  // ---- the codex column ----
  ok((await side.getByRole("button", { name: "Codex", exact: true }).getAttribute("aria-pressed")) === "true" && (await side.getByRole("button", { name: "Illustrate", exact: true }).isEnabled()), "Codex | Illustrate at the top, on Codex; Illustrate is offered, as the chapter is posted (desk-illustrate tests it)");
  const inChapter = side.locator(".desk-group", { hasText: "In this chapter" });
  await inChapter.locator(".desk-row-name", { hasText: "Oda" }).waitFor();
  const groupNames = await side.locator(".desk-group > summary").allInnerTexts();
  ok(groupNames.map((t) => t.replace(/\s*\d+$/, "").trim().toLowerCase()).join("|") === "in this chapter|characters|places|things", "groups: In this chapter, then Characters, Places, Things: " + JSON.stringify(groupNames));
  ok((await inChapter.locator(".desk-row-name").allInnerTexts()).sort().join() === "Oda,Wren", "In this chapter lists the entries the draft names (Wren and Oda), not the Hollow or the Lantern");
  ok((await side.locator(".desk-group", { hasText: "Places" }).locator(".desk-row-name").allInnerTexts()).join() === "The Hollow", "the Hollow is under Places");
  ok((await side.locator(".desk-group", { hasText: "Things" }).locator(".desk-row-name").allInnerTexts()).join() === "Lantern", "the Lantern (an item) is under Things");
  await page.locator(".site-menu > summary").click();
  ok((await page.locator(".site-menu").getByRole("button", { name: "Codex", exact: true }).count()) === 0 && (await page.getByText("Codex for this prompt").count()) === 0, "no Codex drawer in the ☰ menu and no 'Codex for this prompt' on the desk");
  await page.locator(".site-menu > summary").click();

  // the count badge
  const odaRow = side.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row", { hasText: "Oda" });
  ok((await odaRow.locator(".desk-badge").innerText()).startsWith("2"), "Oda's row shows 2 suggestions waiting");
  ok((await side.locator(".desk-group", { hasText: "Places" }).locator(".desk-badge").count()) === 0, "entries with none waiting have no badge");

  // a group folds
  await side.locator(".desk-group > summary", { hasText: "Places" }).click();
  ok(!(await side.locator(".desk-row", { hasText: "The Hollow" }).isVisible()), "a group folds");
  await side.locator(".desk-group > summary", { hasText: "Places" }).click();

  // search
  await side.getByLabel("Search entries").fill("hol");
  ok((await side.locator(".desk-row-name").allInnerTexts()).join() === "The Hollow", "search keeps the entries whose names match");
  await side.getByLabel("Search entries").fill("little");
  ok((await side.locator(".desk-row-name").allInnerTexts()).join() === "Wren,Wren", "…or a keyword (Wren is in this chapter and under Characters)");
  await side.getByLabel("Search entries").fill("");

  // ---- an entry with nothing waiting opens on Facts ----
  await side.locator(".desk-group", { hasText: "Places" }).locator(".desk-row", { hasText: "The Hollow" }).click();
  const entry = page.locator("section.desk-entry");
  await entry.getByRole("heading", { name: "The Hollow" }).waitFor();
  ok((await entry.innerText()).includes("as of “Chapter A”"), "the entry shows the chapter it is as of");
  ok((await entry.getByRole("tab").allInnerTexts()).join("|") === "Facts|Preview|Suggestions|History", "tabs in order: Facts, Preview, Suggestions, History");
  ok((await entry.getByRole("tab", { name: "Facts" }).getAttribute("aria-selected")) === "true", "Facts is the default tab");
  const deskBoxes = await Promise.all([side, entry, page.locator(".desk-story")].map((l) => l.boundingBox()));
  ok(deskBoxes[0].x < deskBoxes[1].x && deskBoxes[1].x < deskBoxes[2].x && Math.abs(deskBoxes[0].y - deskBoxes[1].y) < 4, "three columns: the codex, the entry, the story");

  // ---- Wren: one idea waiting, so Suggestions opens first ----
  await side.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row", { hasText: "Wren" }).click();
  await entry.getByRole("heading", { name: "Wren" }).waitFor();
  ok((await entry.getByRole("tab", { name: "Suggestions (1)" }).getAttribute("aria-selected")) === "true", "with a suggestion waiting, Suggestions (with its count) opens first");
  const idea = entry.locator(".desk-sug", { hasText: "low and dry" });
  ok((await idea.innerText()).includes("The AI's own idea. Nothing in the story says this."), "an idea says it is the AI's own");
  ok(await idea.getByRole("radio", { name: /where Wren first appears \(“Root”\): it was always so/ }).isChecked(), "…and takes effect from where Wren first appears by default");

  // Facts: the buttons come first; a fact added is saved at once at this chapter
  await entry.getByRole("tab", { name: "Facts" }).click();
  const facts = entry.locator(".entry-facts");
  const addBox = await facts.getByRole("button", { name: "+ Add a fact" }).boundingBox();
  const hairBox = await factRow(page, "short and brown").boundingBox();
  ok(addBox.y < hairBox.y, "+ Add a fact sits above the facts");
  ok((await facts.getByRole("button", { name: /Flesh out/ }).count()) === 0, "no Flesh out button (Suggestions asks the AI)");
  await facts.getByRole("button", { name: "+ Add a fact" }).click();
  const formBox = await page.locator(".ef-editor").boundingBox();
  ok(formBox.y < hairBox.y + 4, "the new-fact form opens right under the buttons");
  await fillFact(page, { aspect: "Eyes", text: "grey as rain" });
  await factRow(page, "grey as rain").waitFor();
  ok((await codexAt(A, "Wren")).description.includes("Eyes: grey as rain") && !(await codexAt(R, "Wren")).description.includes("grey as rain"), "the fact is saved at once, from this chapter on");

  // Preview and History
  await entry.getByRole("tab", { name: "Preview" }).click();
  ok((await entry.locator(".fact-ai").innerText()).includes("grey as rain"), "Preview shows the text the AI is sent");
  await entry.getByRole("tab", { name: "History" }).click();
  ok((await entry.locator("ol.history li").count()) >= 1, "History lists the entry's versions");

  // Keep the idea from where Wren first appears
  await entry.getByRole("tab", { name: /^Suggestions/ }).click();
  await idea.getByRole("button", { name: "Keep", exact: true }).click();
  await entry.locator(".desk-sug.done", { hasText: "Voice" }).waitFor();
  ok((await codexAt(R, "Wren")).description.includes("Voice: low and dry"), "Keep saves the idea from where Wren first appears (the root has it)");
  await page.waitForFunction(() => !document.querySelector(".desk-row.on .desk-badge"));
  ok((await entry.getByRole("tab", { name: "Suggestions", exact: true }).count()) === 1, "the counts go down when it is kept");

  // Ask the AI for more: read this chapter, with a focus; the form stays
  const ask = entry.locator("form.desk-ask");
  ok(await ask.getByRole("radio", { name: /Read this chapter/ }).isChecked(), "Ask the AI for more: Read this chapter is the default");
  await ask.getByLabel("Focus (optional)").fill("her voice");
  let queued = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/update-entry`) && r.request().method() === "POST");
  await ask.getByRole("button", { name: "Suggest facts" }).click();
  let run = await send("GET", `/api/ai-runs/${(await (await queued).json()).run_id}`);
  ok(run.tasks.length === 1 && run.tasks[0].kind === "codex" && run.tasks[0].chapterId === A && run.tasks[0].entryId === wren && run.tasks[0].hint === "her voice", "Read this chapter reads this chapter for Wren, with the focus");
  ok(await ask.getByLabel("Focus (optional)").isVisible(), "…and the form stays");
  await clearQueue();
  await page.reload();
  await side.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row", { hasText: "Wren" }).click();
  await entry.getByRole("tab", { name: /^Suggestions/ }).click();
  await ask.getByRole("radio", { name: /Invent new details/ }).check();
  queued = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/flesh-out`) && r.request().method() === "POST");
  await ask.getByRole("button", { name: "Suggest facts" }).click();
  run = await send("GET", `/api/ai-runs/${(await (await queued).json()).run_id}`);
  ok(run.tasks[0].kind === "expand" && run.tasks[0].mode === "invent" && run.tasks[0].chapterId === A, "Invent new details makes a Flesh out run at this chapter");
  await clearQueue();

  // ---- Oda: Keep one (from its chapter), Dismiss the other ----
  await side.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row", { hasText: "Oda" }).click();
  await entry.getByRole("heading", { name: "Oda" }).waitFor();
  ok((await entry.getByRole("tab", { name: "Suggestions (2)" }).getAttribute("aria-selected")) === "true", "Oda opens on Suggestions (2)");
  const mood = entry.locator(".desk-sug", { hasText: "amused" });
  ok((await mood.innerText()).includes("From “Chapter A”: “Oda laughed”"), "a suggestion from the text shows its quote and chapter");
  ok((await mood.getByLabel("Takes effect from").inputValue()) === A, "…and takes effect from its chapter");
  await mood.getByRole("button", { name: "Keep", exact: true }).click();
  await entry.locator(".desk-sug.done", { hasText: "Mood" }).waitFor();
  ok((await codexAt(A, "Oda")).description.includes("Mood: amused"), "Keep saves the fact");
  await entry.locator(".desk-sug", { hasText: "walks with Wren" }).getByRole("button", { name: "Dismiss" }).click();
  await entry.locator(".desk-sug.done", { hasText: "Dismissed" }).waitFor();
  ok(!(await codexAt(A, "Oda")).description.includes("walks with Wren"), "Dismiss drops it");
  await page.waitForFunction(() => document.querySelectorAll(".desk-badge").length === 0);
  ok(true, "no badges are left");

  // the ⋯ menu
  await entry.getByLabel("More entry actions", { exact: true }).click();
  const menu = entry.locator(".more-menu-items");
  const items = (await menu.locator("a, button").allInnerTexts()).map((t) => t.trim());
  ok(items.join("|") === "Edit details|Compare with a chapter…|Share to other stories…|Open on its own page|Remove from this chapter only…|Retire…", "the ⋯ menu: " + items.join(" | "));
  ok(await menu.getByRole("button", { name: "Remove from this chapter only…" }).isDisabled(), "Remove from this chapter only is greyed when no chapter follows this one");
  ok((await menu.getByRole("link", { name: "Open on its own page" }).getAttribute("href")) === `/s/${sid}/codex/${oda}?at=${A}`, "Open on its own page links to the entry page at this chapter");
  await menu.getByRole("button", { name: "Edit details" }).click();
  await entry.getByRole("textbox", { name: /^Keywords/ }).fill("the laughing one");
  await entry.getByRole("button", { name: "Save changes" }).click();
  await entry.getByRole("status").filter({ hasText: "Saved" }).waitFor();
  ok((await codexAt(A, "Oda")).aliases.join() === "the laughing one", "Edit details saves at once");

  // close the entry
  await entry.getByRole("button", { name: "Close entry" }).click();
  ok((await page.locator("section.desk-entry").count()) === 0, "× closes the entry");

  // ---- the column folds to a rail ----
  // « sits in the tabs' row; the search box and + have the row below to themselves
  const modesRow = side.locator(".desk-modes-row");
  const modesText = await modesRow.innerText();
  ok(modesText.includes("Codex") && modesText.includes("Illustrate") && (await modesRow.getByRole("button", { name: "Fold the codex" }).count()) === 1, "« is in the row with the Codex | Illustrate tabs");
  const sideHead = side.locator(".desk-side-head");
  ok((await sideHead.getByLabel("Search entries").count()) === 1 && (await sideHead.getByRole("button", { name: "New entry" }).count()) === 1 && (await sideHead.getByRole("button", { name: "Fold the codex" }).count()) === 0, "the search row has the search box and + , and no «");
  await side.getByRole("button", { name: "Fold the codex" }).click();
  const rail = page.locator("aside.desk-rail");
  ok((await rail.innerText()).toLowerCase().includes("codex · 4 entries") && (await page.getByLabel("Search entries").count()) === 0, "the codex folds to a rail");
  const railBox = await rail.boundingBox();
  ok(railBox.width < 60, "…a narrow one");
  await rail.getByRole("button").click();
  await page.getByLabel("Search entries").waitFor();
  ok(true, "the rail opens the codex again");

  // ---- "+ ▾": a new entry, or a shared entry linked in, at once on a posted chapter ----
  const sharedName = `Desk Mill ${Date.now().toString(36)}`;
  const sharedId = (await post("/api/shared", { name: sharedName, type: "place", aliases: ["the old mill"] })).id;
  await side.getByRole("button", { name: "More ways to add an entry" }).click();
  const addMenu = side.getByRole("menu", { name: "Add an entry" });
  const addChoices = (await addMenu.getByRole("menuitem").allInnerTexts()).map((t) => t.split("\n")[0].trim());
  ok(addChoices.join("|") === "New entry|Add a shared entry…", "+ ▾ offers New entry and Add a shared entry…: " + addChoices.join(" | "));
  await addMenu.getByRole("menuitem", { name: /^Add a shared entry/ }).click();
  const picker = page.locator('section.desk-entry[aria-label="Add a shared entry"]');
  await picker.getByRole("heading", { name: "Add a shared entry" }).waitFor();
  ok((await addMenu.count()) === 0, "…the menu closes, and the entry column shows the shared entries");
  await picker.getByRole("button", { name: new RegExp(sharedName) }).click();
  await page.locator(`section.desk-entry[aria-label="Codex entry: ${sharedName}"]`).waitFor();
  const linked = await until(() => codexAt(A, sharedName));
  ok(linked?.shared_entry_id === sharedId && (await codexAt(R, sharedName)) === undefined, "picking one links it at once, from this chapter on (not before)");
  const sharedRow = side.locator(".desk-group", { hasText: "Places" }).locator(".desk-row", { hasText: sharedName });
  await sharedRow.waitFor();
  ok((await sharedRow.locator(".desk-chip", { hasText: "shared" }).count()) === 1, "…and the codex list shows it, marked shared");
  await side.getByRole("button", { name: "More ways to add an entry" }).click();
  await addMenu.getByRole("menuitem", { name: /^Add a shared entry/ }).click();
  await picker.getByRole("heading", { name: "Add a shared entry" }).waitFor();
  await picker.locator(".meta").first().waitFor();
  await page.waitForFunction(() => !/Loading…/.test(document.querySelector('section.desk-entry[aria-label="Add a shared entry"]')?.textContent ?? ""));
  ok((await picker.getByRole("button", { name: new RegExp(sharedName) }).count()) === 0, "…and is not offered again");
  await picker.getByRole("button", { name: "Close" }).click();
  // The menu's New entry opens the new-entry form, as + does.
  await side.getByRole("button", { name: "More ways to add an entry" }).click();
  await addMenu.getByRole("menuitem", { name: /^New entry/ }).click();
  await page.locator('section.desk-entry[aria-label="New entry"]').getByRole("heading", { name: "New entry" }).waitFor();
  ok(true, "the menu's New entry opens the new-entry form");
  await page.locator('section.desk-entry[aria-label="New entry"]').getByRole("button", { name: "Close" }).click();

  // ---- phone width: nothing scrolls sideways ----
  // (On a phone the codex is a sheet from the bottom bar, its entries to read: see desk-phone.e2e.mjs.)
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator("nav.desk-tabbar").getByRole("button", { name: "Codex", exact: true }).click();
  await side.locator(".desk-row", { hasText: "The Hollow" }).first().click();
  await page.locator("section.desk-phone-entry").getByRole("heading", { name: "The Hollow" }).waitFor();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "at phone width the desk fits the screen");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await clearQueue();
  await send("PUT", "/api/queue/paused", { paused: false });
  if (A) await fetch(`${BASE}/api/drafts/${encodeURIComponent(`edit:${A}`)}`, { method: "DELETE" });
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
