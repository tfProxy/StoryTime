import { launch, useMockAi } from "./browser.mjs";

// The Story Bible's Codex section: the Section select on a phone, the scope line, the ⋯ menu, entries in folds by type
// with their suggestions inside their cards, and the old chapter codex page redirecting here. Suggestions are seeded
// through the worker's route, so no AI is involved.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE);
const browser = await launch();
try {
  // ---- a story: Root -> A, with Rowan (character) and the Hall (place) from the start ----
  const story = await post("/api/stories", { title: "Bible Codex Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood in the Hall.", choices: ["Go to A"] } });
  const storyId = story.story_id;
  const root = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${root}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan was uneasy at the ford.", choices: [] })).chapter_id;
  const entry = (anchor, name, type) => post("/api/codex", { anchor_chapter_id: anchor, op: "create", name, type, aliases: [], content: `About ${name}.`, always_include: false });
  const rowan = (await entry(root, "Rowan", "character")).entry_id;
  await entry(root, "The Hall", "place");
  const rev = async (id) => (await send("GET", `/api/chapters/${id}`)).chapter.revision;
  await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: await rev(A),
    suggestions: [
      { kind: "set", entry_id: rowan, aspect: "Mood", form: "", after: "uneasy", quote: "Rowan was uneasy at the ford." },
      { kind: "entry", aspect: "", form: "", after: "", quote: "the ford", entry: { name: "The Ford", type: "place", aliases: [], notes: "A shallow crossing.", facts: [] } },
    ],
  });
  const codexNames = async (id) => (await send("GET", `/api/chapters/${id}/codex`)).entries.map((e) => e.name);

  const bible = (chapter) => `${BASE}/s/${storyId}/review?tab=codex${chapter ? `&chapter=${chapter}` : ""}`;
  const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // ---- the old chapter codex page redirects, passing review along ----
  const desk = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  desk.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  await desk.goto(`${BASE}/c/${A}/codex`);
  ok(desk.url() === bible(A), "/c/<id>/codex goes to the Bible's Codex section at that chapter: " + desk.url());
  await desk.goto(`${BASE}/c/${A}/codex?review=1`);
  ok(desk.url() === `${bible(A)}&review=1`, "…and keeps review=1");
  ok(await desk.getByRole("button", { name: "Check this chapter with AI" }).isVisible(), "…which offers the AI check");
  await desk.goto(`${BASE}/c/${A}`);
  const codexButton = desk.locator(".chapter-actions").getByRole("link", { name: "Codex" });
  ok((await codexButton.getAttribute("href")) === `/s/${storyId}/review?tab=codex&chapter=${A}`, "the chapter page's Codex button points straight at the Bible");

  // ---- wide screens keep the tab strip ----
  await desk.goto(bible(A));
  ok(await desk.getByRole("navigation", { name: "Story Bible" }).isVisible() && !(await desk.getByLabel("Section").isVisible()), "on a wide screen the tab strip shows, not the select");
  ok((await desk.getByRole("heading", { level: 1 }).count()) === 1, "…and the page has one heading");
  await desk.context().close();

  // ---- a phone ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  await page.goto(bible(A));

  // Section select
  const section = page.getByLabel("Section");
  ok(await section.isVisible() && !(await page.getByRole("navigation", { name: "Story Bible" }).isVisible()), "on a phone the Section select shows, not the tab strip");
  const optionText = await section.locator("option").allInnerTexts();
  ok(optionText.join("|").startsWith("Overview|Issues|Continuity|Codex (2 to review)|Tags|Summaries") || /Codex \(\d+ to review\)/.test(optionText.join("|")), "it lists the sections with their open counts: " + optionText.join(" | "));
  ok((await section.inputValue()) === "codex", "…and shows Codex");
  const order = await page.evaluate(() => {
    const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    return [top(".story-tabs-wrap"), top(".bible-section-select"), top(".bible-scope")];
  });
  ok(order[0] < order[1] && order[1] < order[2], "story tabs, then Section, then the scope line");
  ok(await sideways(page), "no sideways scroll at 390px");

  // Scope line
  const scope = page.locator(".bible-scope");
  ok((await scope.innerText()).includes("Showing Root › Chapter A") && (await scope.getByRole("link", { name: "← Back to reading “Chapter A”" }).getAttribute("href")) === `/c/${A}`, "the scope line says Showing Root › Chapter A, with a way back to reading");
  await scope.getByRole("button", { name: "Change…" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a chapter" });
  await dialog.getByRole("button", { name: "The whole story" }).click();
  await page.waitForURL(`${BASE}/s/${storyId}/review?tab=codex`);
  ok((await scope.innerText()).includes("Showing the whole story") && (await scope.getByRole("button", { name: "Pick a chapter…" }).count()) === 1, "Change… to The whole story: “Showing the whole story”, Pick a chapter…");
  await scope.getByRole("button", { name: "Pick a chapter…" }).click();
  await page.getByRole("dialog", { name: "Choose a chapter" }).getByRole("searchbox").fill("Chapter A");
  await page.getByRole("dialog", { name: "Choose a chapter" }).locator(".chapter-tree-results button").click();
  await page.waitForURL(bible(A));
  ok(true, "Pick a chapter… goes back to that chapter, keeping the section");

  // Section select navigates and keeps the chapter
  await section.selectOption("tags");
  await page.waitForURL(`${BASE}/s/${storyId}/review?tab=tags&chapter=${A}`);
  ok(true, "choosing a section in the select navigates, keeping the chapter");
  await page.getByLabel("Section").selectOption("codex");
  await page.waitForURL(bible(A));
  const menu = page.locator('summary[aria-label="Codex actions"]');
  ok((await menu.count()) === 1, "the ⋯ menu (Codex actions) is on the Codex section");
  await page.goto(`${BASE}/s/${storyId}/review?tab=tags`);
  ok((await menu.count()) === 0, "…and not on the other sections");

  // Groups with counts, folding
  await page.goto(bible(A));
  const groups = page.locator("details.codex-group");
  await page.getByText("· 1 suggestion").first().waitFor();
  const summaries = (await groups.locator("> summary").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  ok(summaries.join("|") === "Characters (1) · 1 suggestion|Places (1) · 1 suggestion", "entries are grouped by type with counts and suggestions: " + summaries.join(" | "));
  const characters = groups.filter({ hasText: "Characters" });
  ok((await characters.evaluate((d) => d.open)) === true, "a group with entries is open");
  await characters.locator("> summary").click();
  ok((await characters.evaluate((d) => d.open)) === false, "…and folds when its heading is tapped");
  await characters.locator("> summary").click();

  // A suggestion inside its entry's card
  const rowanCard = page.locator("li.entry-with-extra", { hasText: "Rowan" });
  ok((await rowanCard.locator("article.inbox-card", { hasText: "Rowan was uneasy at the ford." }).count()) === 1, "the suggestion shows inside Rowan's card, with its quote");
  ok((await page.locator("h2", { hasText: /Codex inbox/ }).count()) === 0, "…and there is no separate inbox box");
  const newCard = page.locator("li.codex-suggested", { hasText: "The Ford" });
  ok((await newCard.innerText()).includes("Suggested new entry:") && (await newCard.getByRole("button", { name: "Add it" }).count()) === 1 && (await newCard.getByRole("button", { name: "Dismiss" }).count()) === 1, "a suggested new entry is a dashed card in its group, with Add it / Dismiss");
  ok(await sideways(page), "no sideways scroll with the cards at 390px");
  await rowanCard.getByRole("button", { name: "Accept" }).click();
  await rowanCard.getByText(/Saved to/).waitFor();
  ok(true, "Accept saves it");
  await page.reload();
  ok((await rowanCard.locator("article.inbox-card").count()) === 0, "…and the card has no suggestion left after a reload");
  const factsAtA = (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Rowan");
  ok(JSON.stringify(factsAtA.facts).includes("uneasy"), "…and Rowan has the fact at Chapter A");
  await page.locator("li.codex-suggested", { hasText: "The Ford" }).getByRole("button", { name: "Add it" }).click();
  await page.waitForFunction(async ([u]) => (await (await fetch(u)).json()).entries.some((e) => e.name === "The Ford"), [`/api/chapters/${A}/codex`]);
  ok(true, "Add it creates the suggested entry");

  // New entry from the ⋯ menu, at the chapter
  await page.goto(bible(A));
  await menu.click();
  const items = (await page.locator(".more-menu-items button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  ok(items.join("|") === "New entry from here|New entry from the shared codex…|Check this chapter with AI Suggests changes to entries", "the menu: " + items.join(" | "));
  const menuBox = await page.locator(".more-menu-items").boundingBox();
  ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, "…and fits on the screen");
  await page.getByRole("button", { name: "New entry from here" }).click();
  await page.getByLabel("Name").fill("Hollow Oak");
  await page.getByLabel("Type").selectOption("item");
  await page.getByRole("button", { name: "Add entry" }).click();
  await page.waitForURL(/\/s\/[^/]+\/codex\/[^/?]+\?at=/);
  ok(page.url().endsWith(`?at=${A}`), "New entry from here opens the new entry's page at that chapter");
  ok((await codexNames(A)).includes("Hollow Oak") && !(await codexNames(root)).includes("Hollow Oak"), "…and the entry starts at that chapter, not before it");

  // Whole story: ⋯ → New entry, anchored at the first chapter
  await page.goto(bible());
  await page.locator("details.codex-group").first().waitFor();
  const wholeGroups = (await page.locator("details.codex-group > summary").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  ok(wholeGroups.some((t) => t.startsWith("Characters (1)")) && wholeGroups.some((t) => t.startsWith("Items (1)")), "the whole story lists every entry on any branch in the same folds: " + wholeGroups.join(" | "));
  await menu.click();
  const wholeItems = (await page.locator(".more-menu-items button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  ok(wholeItems[0] === "New entry" && wholeItems[2].startsWith("Check every chapter with AI"), "the whole-story menu says New entry and Check every chapter with AI");
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  await page.getByLabel("Name").fill("Story Wide");
  await page.getByRole("button", { name: "Add entry" }).click();
  await page.waitForURL(/\/s\/[^/]+\/codex\/[^/?]+\?at=/);
  ok(page.url().endsWith(`?at=${root}`), "New entry at the whole-story scope opens at the first chapter");
  ok((await codexNames(root)).includes("Story Wide"), "…and the entry is in the codex from the first chapter on");

  // A suggestion on the whole-story scope is counted on the entry's card
  await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: await rev(A),
    suggestions: [{ kind: "set", entry_id: rowan, aspect: "Hair", form: "", after: "silver", quote: "Her hair was silver." }],
  });
  await page.goto(bible());
  await page.locator("a.entry-card", { hasText: "Rowan" }).getByText("1 suggestion").waitFor();
  ok(true, "on the whole story an entry's card says how many suggestions it has");

  // The shared-codex form opens from the menu
  await menu.click();
  await page.getByRole("button", { name: "New entry from the shared codex…" }).click();
  await page.getByText(/shared codex is empty|Shared entry|Every shared entry/).first().waitFor();
  ok(true, "New entry from the shared codex… opens the shared-entry form");

  // ---- empty state ----
  const empty = await post("/api/stories", { title: "Empty Codex Tale", premise: "p", chapter: { title: "Only", body: "Nothing here.", choices: [] } });
  await page.goto(`${BASE}/s/${empty.story_id}/review?tab=codex`);
  ok(await page.getByText("No entries yet.").isVisible(), "an empty codex says “No entries yet.”");
  const add = page.getByRole("button", { name: "+ New entry" });
  ok(await add.isVisible(), "…with a visible + New entry button");
  await add.click();
  ok(await page.getByLabel("Name").isVisible(), "…which opens the new-entry form at the top of the list");
  ok(await sideways(page), "no sideways scroll at 390px with the form open");
  await send("DELETE", `/api/stories/${empty.story_id}`).catch(() => {});
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
} finally {
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
