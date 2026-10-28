import { launch, useMockAi } from "./browser.mjs";

// The codex entry's own page: keywords, details, form, facts, notes (not sent to the AI), Turn notes into facts, and
// the places that lead to it (the codex list, the Story Bible, the ☰ menu, the writing page's drawer).
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE); // no automatic codex check; nothing here calls the AI
const browser = await launch();
try {
  // ---- a story with one entry: keywords, notes, two forms, facts ----
  const story = await post("/api/stories", { title: "Entry Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["Go to A"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${R}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan's ears changed.", choices: ["Onward"] })).chapter_id;
  const rowan = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Rowan", type: "character", aliases: ["Ro", "the traveller"], content: "She is shy and quick.", always_include: false })).entry_id;
  const fact = (anchor_chapter_id, aspect, text, form = "") => post("/api/codex/facts", { anchor_chapter_id, entry_id: rowan, op: "set", aspect, form, text });
  await fact(R, "Ears", "round human ears");
  await fact(R, "Tail", "no tail at all", "human");
  await fact(R, "Tail", "a bushy russet tail", "vixen");
  await fact(R, "form", "", "human");
  const entryUrl = (at) => `${BASE}/s/${sid}/codex/${rowan}?at=${at}`;

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const ed = page.locator(".entry-editor");
  const section = (heading) => ed.locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) });
  // (By the fact's own line: a form that is open holds its text in a textarea, which also counts as the row's text.)
  const row = (t) => ed.locator(".fact-row").filter({ has: page.locator(".fact-line", { hasText: t }) });
  const box = async (loc) => (await loc.first().boundingBox());
  const below = async (a, b) => ((await box(a)).y >= (await box(b)).y + (await box(b)).height - 1);
  const entryAt = async (chapter) => (await send("GET", `/api/chapters/${chapter}/codex`)).entries.find((e) => e.name === "Rowan");

  // ---- the list opens the entry's page ----
  await page.goto(`${BASE}/c/${A}/codex`);
  const card = page.locator(".entry-card", { hasText: "Rowan" });
  await card.waitFor();
  const cardText = await card.innerText();
  ok(cardText.includes("Keywords: Ro, the traveller") && cardText.includes("Form: human") && cardText.includes("round human ears"), "the list card shows keywords, form and what the AI reads");
  ok(!cardText.includes("She is shy"), "…and not the notes");
  await card.click();
  await page.getByRole("heading", { name: "Rowan", level: 1 }).waitFor();
  ok(page.url() === entryUrl(A), "the card opens the entry page at this chapter: " + page.url());
  ok(await page.getByRole("link", { name: "← Codex at “Chapter A”" }).isVisible(), "the crumb leads back to the codex at the chapter");
  const path = await page.locator(".entry-path").innerText();
  ok(/Viewing at:\s*Root\s*›\s*Chapter A/.test(path) && (await page.locator(".entry-path a", { hasText: "Root" }).getAttribute("href")) === `/s/${sid}/codex/${rowan}?at=${R}`, "a Viewing at line links each chapter to the entry at that chapter: " + path);

  // ---- keywords are always visible ----
  const keywords = ed.locator(".entry-keywords");
  ok((await keywords.innerText()).includes("Keywords: Ro, the traveller") && (await keywords.innerText()).includes("Words in the story that bring this entry into the AI's prompt."), "the keywords and their hint are on the page");

  // ---- Edit details opens right below the header and saves keywords ----
  await ed.getByRole("button", { name: "Edit details" }).click();
  const details = ed.locator("form.entry-details-form");
  await details.waitFor();
  ok((await below(details, keywords)) && (await below(section("Form"), details)), "Edit details opens its form directly under the header, above the Form section");
  ok((await details.getByLabel(/Takes effect from/).inputValue()) === A, "…with “Takes effect from” on this chapter");
  await details.getByLabel(/Keywords/).fill("Ro, the traveller, the fox");
  await details.getByRole("button", { name: "Save changes" }).click();
  await keywords.getByText("Ro, the traveller, the fox").waitFor();
  ok((await entryAt(A)).aliases.join() === "Ro,the traveller,the fox" && (await entryAt(R)).aliases.join() === "Ro,the traveller", "the keywords were saved at this chapter, not earlier");

  // ---- Change form opens beneath its button: pick an existing form, a stage, and see what the AI reads ----
  const formSection = section("Form");
  const changeForm = formSection.getByRole("button", { name: "Change form" });
  await changeForm.click();
  const formForm = formSection.locator(".fact-form");
  ok(await below(formForm, formSection.locator(".facts-form")), "the form opens right under the Change form button");
  const options = (await formForm.getByLabel("Form", { exact: true }).locator("option").allInnerTexts()).map((t) => t.trim());
  ok(options.join("|") === "human|vixen|New form…", "the form is a drop-down of the current forms, with a New form… option: " + options.join("|"));
  await formForm.getByLabel("Form", { exact: true }).selectOption("vixen");
  await formForm.getByLabel("Stage (optional)").fill("halfway");
  ok(await formForm.getByText("The AI will read: Form: vixen, halfway.").isVisible(), "a live line shows exactly what the AI will read");
  await formForm.getByRole("button", { name: "Save", exact: true }).click();
  await formSection.locator(".facts-form").getByText("Form: vixen").waitFor();
  ok((await formSection.locator(".facts-form").innerText()).includes("halfway"), "the form and its stage show");
  ok((await ed.locator(".fact-ai").innerText()).includes("Form: vixen, halfway."), "What the AI reads has the form line");
  ok(await ed.getByText("vixen (current)").isVisible() && await ed.getByText("human (not current: not sent to the AI)").isVisible(), "the facts are grouped by form, the current one marked");
  await changeForm.click();
  await formForm.getByLabel("Form", { exact: true }).selectOption({ label: "New form…" });
  await formForm.getByLabel("New form name").fill("kit");
  await formForm.getByLabel("Stage (optional)").fill("");
  ok(await formForm.getByText("The AI will read: Form: kit.").isVisible(), "a new form shows its line too");
  await formForm.getByRole("button", { name: "Cancel" }).click();
  ok((await formSection.locator(".facts-form").innerText()).includes("Form: vixen"), "Cancel leaves the form as it was");

  // ---- Add a fact opens at the end of the list ----
  const factsSection = section("Facts");
  await factsSection.getByRole("button", { name: "+ Add a fact" }).click();
  const addForm = factsSection.locator(".fact-form");
  ok(await below(addForm, factsSection.locator(".fact-row").last()), "the add form opens after the last fact");
  await addForm.getByLabel("Aspect").fill("Eyes");
  await addForm.getByLabel("Fact", { exact: true }).fill("amber");
  await addForm.getByRole("button", { name: "Save", exact: true }).click();
  await row("amber").waitFor();
  ok(await row("amber").getByText("changed here").isVisible(), "the new fact is marked changed here");

  // ---- a row's Edit opens under the row and saves ----
  await row("amber").getByRole("button", { name: "Edit" }).click();
  ok((await row("amber").locator(".fact-form").count()) === 1, "Edit opens the form inside the row");
  await row("amber").getByLabel("Fact", { exact: true }).fill("amber with gold flecks");
  await row("amber").getByRole("button", { name: "Save", exact: true }).click();
  await row("gold flecks").waitFor();
  ok(true, "the edited fact saved");
  await row("gold flecks").getByRole("button", { name: "History" }).click();
  ok(await row("gold flecks").getByText("Added", { exact: true }).isVisible() && await row("gold flecks").getByText("Changed", { exact: true }).isVisible(), "History shows the fact's versions");
  await row("gold flecks").getByRole("button", { name: "Remove" }).click();
  await row("gold flecks").waitFor({ state: "detached" });
  ok(true, "Remove takes the fact off");

  // ---- notes: not what the AI reads; Edit and Clear ----
  const notes = section("Your notes (not sent to the AI)");
  ok((await notes.innerText()).includes("She is shy and quick.") && !(await ed.locator(".fact-ai").innerText()).includes("She is shy"), "the notes are shown apart from what the AI reads");
  await notes.getByRole("button", { name: "Edit", exact: true }).click();
  ok((await notes.getByLabel("Notes", { exact: true }).count()) === 1, "Edit opens the textarea right there");
  await notes.getByLabel("Notes", { exact: true }).fill("She is shy. She loves apples.");
  await notes.getByRole("button", { name: "Save", exact: true }).click();
  await notes.locator(".entry-notes", { hasText: "She loves apples." }).waitFor();
  const saved = await entryAt(A);
  ok(saved.content === "She is shy. She loves apples." && saved.name === "Rowan" && saved.aliases.join() === "Ro,the traveller,the fox", "saving the notes keeps the other fields");
  ok(!(await ed.locator(".fact-ai").innerText()).includes("apples"), "…and the AI still doesn't read them");
  await notes.getByRole("button", { name: "Clear" }).click();
  await notes.getByText("No notes.").waitFor();
  ok((await entryAt(A)).content === "", "Clear empties the notes");
  ok((await notes.getByRole("button", { name: "Turn notes into facts" }).count()) === 0, "…and there is nothing to turn into facts");
  await notes.getByRole("button", { name: "Edit", exact: true }).click();
  await notes.getByLabel("Notes", { exact: true }).fill("She was born in the north. She hates the cold.");
  await notes.getByRole("button", { name: "Save", exact: true }).click();

  // ---- Turn notes into facts: a run is queued (the queue is paused, so no AI is called) ----
  await send("PUT", "/api/queue/paused", { paused: true });
  const queued = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/notes-to-facts`) && r.request().method() === "POST");
  await notes.getByRole("button", { name: "Turn notes into facts" }).click();
  const made = await (await queued).json();
  const run = await send("GET", `/api/ai-runs/${made.run_id}`);
  ok(typeof made.run_id === "string" && made.tasks === 1 && run.tasks[0].kind === "notes" && run.tasks[0].entryId === rowan, "the button makes a run with a notes task for this entry");
  const inbox = notes.getByRole("link", { name: "Open the codex inbox" });
  await inbox.waitFor();
  ok((await inbox.getAttribute("href")) === `/s/${sid}/review?tab=codex&chapter=${A}`, "…with a link to the inbox, at the chapter the notes were written");
  for (const item of (await send("GET", "/api/queue")).items ?? []) await fetch(`${BASE}/api/queue/items/${item.key}`, { method: "DELETE" });
  await send("PUT", "/api/queue/paused", { paused: false });

  // ---- suggestions waiting for this entry ----
  const rev = (await send("GET", `/api/chapters/${A}`)).chapter.revision;
  await post(`/api/chapters/${A}/codex-suggestions`, { revision: rev, suggestions: [{ kind: "set", entry_id: rowan, aspect: "Hair", form: "", after: "silver", quote: "Rowan's ears changed." }] });
  await page.goto(entryUrl(A));
  ok(await ed.getByText("1 suggestion waiting for Rowan").isVisible(), "an open suggestion is counted on the entry page");
  ok((await ed.getByRole("link", { name: "Review" }).getAttribute("href")) === `/s/${sid}/review?tab=codex`, "…with a link to the Story Bible's codex tab");

  // ---- a missing or foreign ?at= opens the chapter where the entry was last changed ----
  await page.goto(`${BASE}/s/${sid}/codex/${rowan}`);
  ok(page.url().endsWith(`/codex/${rowan}`) && (await page.locator(".entry-path strong").innerText()) === "Chapter A", "without ?at= the entry opens where it was last changed");
  await page.goto(`${BASE}/s/${sid}/codex/${rowan}?at=nonsense`);
  ok(await page.getByRole("heading", { name: "Rowan", level: 1 }).isVisible(), "a chapter that isn't in the story is ignored");

  // ---- the Story Bible lists the entry and links to its page, not the pictures page ----
  await page.goto(`${BASE}/s/${sid}/review?tab=codex`);
  const bibleLink = page.locator(".entry-cards a", { hasText: "Rowan" });
  const href = await bibleLink.getAttribute("href");
  ok(/^\/s\/[^/]+\/codex\/[^/]+\?at=/.test(href) && !href.includes("/pictures"), "the Story Bible's entry list links to the entry page: " + href);
  await bibleLink.click();
  await page.getByRole("heading", { name: "Rowan", level: 1 }).waitFor();
  await page.goto(`${BASE}/s/${sid}/review?tab=codex&chapter=${A}`);
  await page.locator(".entry-card", { hasText: "Rowan" }).waitFor();
  ok(true, "choosing a chapter lists the entries as cards, as of that chapter");

  // ---- the ☰ menu leads to the Story Bible from a chapter page and a story page ----
  await page.goto(`${BASE}/c/${A}`);
  await page.locator(".site-menu > summary").click();
  await page.locator(".site-menu").getByRole("link", { name: "Story Bible", exact: true }).click();
  await page.waitForURL(new RegExp(`/s/${sid}/review\\?chapter=${A}`));
  ok(await page.getByRole("heading", { name: "Story Bible", level: 1 }).isVisible(), "the ☰ menu's Story Bible link lands on the Story Bible");
  await page.goto(`${BASE}/s/${sid}/details`);
  await page.locator(".site-menu > summary").click();
  ok((await page.locator(".site-menu").getByRole("link", { name: "Story Bible", exact: true }).getAttribute("href")) === `/s/${sid}/review`, "…and so does the story pages' menu");
  await page.goto(`${BASE}/c/${A}/write?choice=${(await send("GET", `/api/chapters/${A}`)).choices[0].id}`);
  await page.locator(".site-menu > summary").click();
  ok((await page.locator(".site-menu").getByRole("link", { name: "Story Bible", exact: true }).count()) === 1, "…and the writing page's menu");

  // ---- the writing page's drawer opens the entry inside the drawer ----
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  const drawer = page.locator("aside.codex-drawer");
  await drawer.waitFor();
  await drawer.locator(".entry-card", { hasText: "Rowan" }).click();
  await drawer.getByRole("heading", { name: "Rowan" }).waitFor();
  ok(page.url().includes("/write") && (await drawer.getByRole("button", { name: "Edit details" }).isVisible()) && (await drawer.locator(".entry-keywords").innerText()).includes("the fox"), "tapping a card opens the entry in the drawer, without leaving the page");
  await drawer.getByRole("button", { name: "← All entries" }).click();
  await drawer.locator(".entry-card", { hasText: "Rowan" }).waitFor();
  ok(true, "← All entries goes back to the list");
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
} finally {
  await send("PUT", "/api/queue/paused", { paused: false }).catch(() => {});
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
