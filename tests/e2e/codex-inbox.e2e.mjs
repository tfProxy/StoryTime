import { launch, useMockAi } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

// The codex inbox: suggestions the codex check left. The chapter's codex (in the Story Bible) counts them in a "Changes
// waiting" box that leads to the review page beside the chapter's text (/c/<id>/codex-review); the entry's page at that chapter
// also lists its own in the "Review changes" fold. Also the banner on the chapter page, the count on the codex page, the setting, and the
// buttons that queue a check. Suggestions are seeded through the worker's route, so no AI is involved.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE); // autoCodex off: posting the chapters below must not queue checks
const browser = await launch();
let storyId;
try {
  // ---- a story with an entry that has facts ----
  const story = await post("/api/stories", { title: "Inbox Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there. Her eyes were green. Her voice was low and quiet.", choices: ["Go to A"] } });
  storyId = story.story_id;
  const root = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${root}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan's hair turned silver. Her eyes were blue. Kestrel the hawk joined her.", choices: [] })).chapter_id;
  const rowan = (await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Rowan", type: "character", aliases: [], content: "A young traveller.", always_include: false })).entry_id;
  for (const [aspect, text] of [["Hair", "dark brown hair"], ["Eyes", "green"], ["Weapon", "a wooden sword"], ["Mood", "calm"]]) {
    await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: rowan, op: "set", aspect, text });
  }
  const rev = async (id) => (await send("GET", `/api/chapters/${id}`)).chapter.revision;
  const seed = (id, revision, suggestions, extra = {}) => post(`/api/chapters/${id}/codex-suggestions`, { revision, suggestions, ...extra });
  const s = (kind, extra) => ({ kind, entry_id: rowan, aspect: "", form: "", after: "", quote: "", ...extra });
  const seeded = await seed(A, await rev(A), [
    s("set", { aspect: "Hair", after: "silver hair", quote: "Rowan's hair turned silver." }),
    s("set", { aspect: "Boots", after: "red boots", quote: "She laced her red boots." }),
    s("retire", { aspect: "Weapon", quote: "She left the wooden sword behind." }),
    s("form", { form: "hawk", after: "feathers", quote: "Feathers sprouted along her arms." }),
    s("conflict", { aspect: "Eyes", after: "blue", quote: "Her eyes were blue." }),
    { kind: "entry", aspect: "", form: "", after: "", quote: "Kestrel the hawk joined her.", entry: { name: "Kestrel", type: "character", aliases: ["the hawk"], notes: "A hunting hawk.", facts: [{ aspect: "Colour", form: "", text: "brown" }] } },
    s("set", { aspect: "Mood", after: "tense", quote: "Rowan was tense." }),
  ]);
  ok(seeded.saved === 7, "seeded one suggestion of each kind: " + JSON.stringify(seeded));
  await seed(root, await rev(root), [s("set", { aspect: "Voice", after: "low and quiet", quote: "Her voice was low and quiet." })]);

  const ctx = await browser.newContext();
  await unfoldEntryFolds(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const inbox = `${BASE}/s/${storyId}/review?tab=codex`;
  // The chapter's codex has the summary box; the cards are in the entry page's review fold.
  const box = () => page.locator("section.codex-review-box[aria-label='Changes waiting']");
  const go = () => box().locator("a.codex-review-go");
  const goText = async () => (await go().innerText()).replace(/\s+/g, " ").trim();
  const reviewCard = (t) => page.locator("article.cr-card", { hasText: t });
  const rowanCount = () => page.locator("li.entry-with-extra", { hasText: "Rowan" }).locator("a.entry-review-count");
  const rowanAtA = () => page.goto(`${BASE}/s/${storyId}/codex/${rowan}?at=${A}#entry-review`);
  const fold = () => page.locator("details#entry-review");
  const card = (quote) => fold().locator("article.inbox-card", { hasText: quote });
  const cards = () => fold().locator("article.inbox-card");
  // Rowan's entry page (the one place the facts are listed), as of a chapter.
  const rowanPage = (at) => page.goto(`${BASE}/s/${storyId}/codex/${rowan}?at=${at}`);
  const rowanFacts = () => page.locator(".entry-editor");
  const factLine = (t) => rowanFacts().locator(".fact-line", { hasText: t });

  // ---- the chapter page banner and the codex page box ----
  await page.goto(`${BASE}/c/${A}`);
  const banner = page.getByText(/Codex: 7 suggestions from this chapter/);
  await banner.waitFor();
  const bannerLink = page.locator("p.notice", { hasText: "Codex:" }).getByRole("link", { name: "Review beside the text" });
  const href = await bannerLink.getAttribute("href");
  ok(href === `/c/${A}/codex-review`, "the banner links to the chapter's review page beside the text: " + href);
  await page.goto(`${BASE}/c/${root}/codex`);
  await page.waitForURL(`${inbox}&chapter=${root}`);
  await go().waitFor();
  ok((await page.locator("article.inbox-card").count()) === 0, "the chapter's codex lists no cards: they are on the review page");
  ok((await goText()).includes("1 change waiting from this chapter") && (await go().getAttribute("href")) === `/c/${root}/codex-review`, "the root's box has a link to review its one change: " + (await goText()));

  // ---- the banner leads to the review page ----
  await page.goto(`${BASE}/c/${A}`);
  await banner.waitFor();
  await bannerLink.click();
  await page.waitForURL(`${BASE}/c/${A}/codex-review`);
  await reviewCard("Rowan · Hair").waitFor();
  ok(true, "the banner opens the review page for this chapter");
  await page.goto(`${inbox}&chapter=${A}`);
  await go().waitFor();
  ok((await goText()).includes("7 changes waiting from this chapter") && (await goText()).includes("Review beside the text") && (await go().getAttribute("href")) === `/c/${A}/codex-review`, "the box counts what waits here (6 for Rowan and the new entry) and leads to the review page: " + (await goText()));
  ok((await page.locator("article.inbox-card").count()) === 0, "…and there are no suggestion cards on the page");
  ok((await box().getByRole("button").count()) === 0 && (await box().locator("li.codex-review-new, a.codex-review-row").count()) === 0, "…and no rows or Add it / Dismiss of its own");
  ok((await box().getByText(/Earlier chapters still have some:/).isVisible()) && (await box().getByRole("link", { name: "“Root” (1)" }).getAttribute("href")) === `/c/${root}/codex-review`, "the earlier chapter that still has a suggestion is linked below, to its review page");
  ok((await rowanCount().innerText()).trim() === "6 changes to review" && (await rowanCount().getAttribute("href")) === `/c/${A}/codex-review?entry=${rowan}`, "Rowan's card says how many wait here and links to them on the review page");

  // the whole story: the chapters that have changes waiting, with counts
  await page.goto(inbox);
  await box().waitFor();
  ok(
    (await box().getByText(/Changes waiting:/).isVisible()) &&
      (await box().getByRole("link", { name: "“Chapter A” (7)" }).getAttribute("href")) === `/c/${A}/codex-review` &&
      (await box().getByRole("link", { name: "“Root” (1)" }).getAttribute("href")) === `/c/${root}/codex-review` &&
      (await go().count()) === 0,
    "the whole story's box links each chapter's review page with its count",
  );
  ok((await page.locator("article.inbox-card").count()) === 0, "…without cards");

  // ---- the entry's page at the chapter: the review fold ----
  await rowanAtA();
  await fold().waitFor();
  ok((await fold().locator("summary").first().innerText()).includes("Review changes from “Chapter A”") && (await fold().locator("summary").first().innerText()).includes("6 waiting"), "the fold is titled with the chapter and says how many wait");
  ok(await fold().evaluate((d) => d.open), "…and is open");
  ok((await cards().count()) === 6 && (await card("Her voice was low and quiet.").count()) === 0, "it holds this chapter's suggestions only, not the root's");
  ok((await fold().getByText("Also waiting for Rowan from earlier chapters:").isVisible()) && (await fold().getByRole("link", { name: "“Root” (1)" }).getAttribute("href")) === `/s/${storyId}/codex/${rowan}?at=${root}#entry-review`, "…with a link to the root's at the root");
  const atBar = page.locator(".codex-at-bar");
  ok((await atBar.getByRole("link", { name: "← Codex" }).getAttribute("href")) === `/s/${storyId}/review?tab=codex&chapter=${A}` && (await atBar.innerText()).includes("Rowan at “Chapter A”"), "the bar at the top leads back to the codex at the chapter and says where the page is");

  // ---- the cards ----
  const hair = card("Rowan's hair turned silver.");
  ok((await hair.locator("del").innerText()).includes("dark brown") && (await hair.locator("ins").innerText()).includes("silver"), "a change shows the old words in del and the new in ins");
  ok((await hair.locator("blockquote.inbox-evidence").isVisible()) && (await hair.locator(".source-badge").innerText()) === "From the text", "…with the quote from the chapter and a 'From the text' label");
  const quoteLink = hair.locator("blockquote.inbox-evidence a", { hasText: "Show in “Chapter A”" });
  ok(((await quoteLink.getAttribute("href")) ?? "").startsWith(`/c/${A}#:~:text=`), "…and a link to the quote in the chapter");
  ok((await hair.locator("strong.inbox-aspect").innerText()) === "Hair" && (await hair.locator(".inbox-head .meta").innerText()).includes("change"), "the aspect is bold and the kind is plain text");
  ok((await card("She laced her red boots.").locator("del").count()) === 0 && (await card("She laced her red boots.").locator("ins").innerText()).includes("red boots"), "a new aspect is all ins");
  ok((await card("wooden sword behind").locator("ins").count()) === 0 && (await card("wooden sword behind").locator("del").innerText()).includes("a wooden sword"), "a removal is all del");
  ok((await card("She laced her red boots.").getByText("new aspect").isVisible()) && (await card("wooden sword behind").getByText("remove").isVisible()), "kind words");
  const conflict = card("Her eyes were blue.");
  ok((await conflict.locator(".source-badge").innerText()) === "Contradicts the codex", "a contradiction is labelled as such");
  ok(await conflict.getByRole("button", { name: "Update codex" }).isVisible() && await conflict.getByRole("button", { name: "Keep the codex" }).isVisible(), "a conflict card offers Update codex / Keep the codex");
  ok((await conflict.getByRole("button", { name: "Edit" }).count()) === 0, "…and no Edit");
  ok((await fold().getByText("Kestrel").count()) === 0, "a suggested new entry is not on Rowan's page");

  // ---- accept a change ----
  await hair.getByRole("button", { name: "Accept" }).click();
  await fold().getByText(/Saved:\s*Rowan, Hair/).waitFor();
  ok((await fold().locator("article.inbox-card").count()) === 5, "an accepted card collapses to one line");
  ok((await fold().locator("p.inbox-done a").count()) === 0, "…without a link");

  // ---- edit, then save ----
  const boots = card("She laced her red boots.");
  await boots.getByRole("button", { name: "Edit" }).click();
  await boots.getByLabel("Fact").fill("scuffed red boots");
  await boots.getByRole("button", { name: "Save" }).click();
  await fold().getByText(/Saved:\s*Rowan, Boots/).waitFor();

  // ---- dismiss, then undo ----
  const mood = card("Rowan was tense.");
  await mood.getByRole("button", { name: "Dismiss" }).click();
  await fold().getByText("Dismissed", { exact: false }).first().waitFor();
  ok((await card("Rowan was tense.").count()) === 0, "a dismissed card collapses");
  await fold().locator(".inbox-done", { hasText: "Dismissed" }).getByRole("button", { name: "Undo" }).click();
  await card("Rowan was tense.").waitFor();
  ok(true, "Undo brings the dismissed card back");

  // ---- a conflict: keep the codex ----
  await conflict.getByRole("button", { name: "Keep the codex" }).click();
  await fold().locator(".inbox-done", { hasText: "Dismissed" }).waitFor();

  // ---- a new entry, from the review page ----
  await page.goto(`${BASE}/c/${A}/codex-review`);
  const kestrelCard = reviewCard("Kestrel");
  await kestrelCard.waitFor();
  ok((await kestrelCard.getByText("A hunting hawk.").isVisible()) && (await kestrelCard.locator(".source-badge").innerText()) === "From the text", "a new entry's card on the review page has its notes and where it comes from");
  await kestrelCard.getByRole("button", { name: "Add it" }).click();
  await page.locator(".cr-done").getByText(/Saved:\s*New character: Kestrel/).waitFor();
  ok((await page.locator("article.cr-card", { hasText: "Kestrel" }).count()) === 0, "Add it collapses the new entry's card to a Saved line");

  // ---- the AI's own idea is left out of "Accept the N from the text" ----
  // …and so is a fact whose quote is real but says nothing about it ("Quote doesn't show this").
  const idea = await seed(A, await rev(A), [s("set", { aspect: "Fear", after: "deep water", quote: "" }), s("set", { aspect: "Scarf", after: "a green scarf", quote: "Kestrel the hawk joined her." })], { source: "expand", entry_id: rowan });
  ok(idea.saved === 2, "seeded a Flesh out idea with no quote, and a fact whose quote doesn't show it");
  await rowanPage(A);
  await fold().waitFor();
  const fear = card("deep water");
  await fear.waitFor();
  ok((await fear.locator(".source-badge").innerText()) === "AI idea · not in the text", "an idea the text doesn't back is labelled as the AI's");
  const scarf = card("a green scarf");
  ok((await scarf.locator(".source-badge").innerText()) === "Quote doesn't show this" && (await scarf.locator(".inbox-unsure").isVisible()), "a quote that doesn't mention the fact is labelled 'Quote doesn't show this', with a note");
  ok((await cards().count()) === 5, "five are open here now: the retire, the form, the mood, the idea and the unsupported quote");
  const all = fold().getByRole("button", { name: /^Accept the \d+ from the text$/ });
  ok((await all.innerText()) === "Accept the 3 from the text", "the button counts the changes the text backs, not the idea or a contradiction");
  await all.click();
  await fold().getByText(/Saved:\s*Rowan, Weapon/).waitFor();
  await fold().getByText(/Saved:\s*Rowan, Mood/).waitFor();
  await fold().getByText(/Saved:\s*Rowan, form/).waitFor();
  ok((await fold().locator("article.inbox-card").count()) === 2 && (await card("deep water").getByRole("button", { name: "Accept" }).isVisible()) && (await scarf.getByRole("button", { name: "Accept" }).isVisible()), "…which takes those three and leaves the AI's idea and the unsupported quote to decide");
  ok((await fold().getByRole("button", { name: /^Accept the/ }).count()) === 0, "…and the button goes");
  await fear.getByRole("button", { name: "Dismiss" }).click();
  await fold().locator(".inbox-done", { hasText: "Dismissed" }).waitFor();
  await scarf.getByRole("button", { name: "Dismiss" }).click();
  await scarf.waitFor({ state: "detached" });

  // ---- the ⋯ menu ----
  await page.reload();
  await fold().waitFor();
  ok((await fold().locator("summary[aria-label='More review actions']").count()) === 0, "with nothing open the ⋯ menu is gone");

  // ---- the root's suggestion is reviewed at the root ----
  await rowanPage(A);
  await fold().getByRole("link", { name: "“Root” (1)" }).click();
  await page.waitForURL(new RegExp(`/codex/${rowan}\\?at=${root}`));
  await card("Her voice was low and quiet.").waitFor();
  ok((await cards().count()) === 1, "the earlier chapter's link opens the page at that chapter, with its suggestion");
  await fold().locator("summary[aria-label='More review actions']").click();
  ok(((await fold().getByRole("link", { name: "Show the AI exchange" }).getAttribute("href")) ?? "").includes(`/ai-log?chapter=${root}`), "the ⋯ menu has the AI exchange for the chapter");
  await card("Her voice was low and quiet.").getByRole("button", { name: "Accept" }).click();
  // (With the last one decided the fold closes, so its "Saved" line is only there, not shown.)
  await fold().getByText(/Saved:\s*Rowan, Voice/).waitFor({ state: "attached" });
  ok(true, "accepted at the root: saved there");

  // ---- what reached the codex ----
  await rowanPage(A);
  await factLine("silver hair").waitFor();
  ok(await factLine("scuffed red boots").isVisible(), "the edited fact was saved");
  ok(await factLine("tense").isVisible(), "the fact accepted with Accept the 3 was saved");
  ok((await factLine("wooden sword").count()) === 0, "the removal took effect");
  ok(await rowanFacts().locator(".facts-form").getByText("Form: hawk").isVisible(), "the form was set");
  ok(await factLine("green").isVisible() && (await factLine("blue").count()) === 0, "Keep the codex left the green eyes");
  ok((await factLine("deep water").count()) === 0, "the dismissed idea wasn't written");
  ok(await factLine("low and quiet").isVisible(), "the root's change took effect (saved at the root)");
  await page.goto(`${BASE}/c/${A}/codex`);
  await page.locator(".entry-card", { hasText: "Kestrel" }).click();
  await page.getByRole("heading", { name: "Kestrel", level: 1 }).waitFor();
  ok(await page.locator(".entry-notes", { hasText: "A hunting hawk." }).isVisible(), "the new entry was created, with its notes");
  await page.goto(`${inbox}&chapter=${A}`);
  ok((await page.locator("nav[aria-label='Story Bible']").getByRole("link", { name: /^Codex/ }).innerText()).trim() === "Codex", "the Codex tab no longer counts anything for the chapter");
  ok((await page.locator("section.codex-review-box").count()) === 0, "…and the box is gone with nothing waiting");
  await rowanPage(root);
  ok((await rowanFacts().locator(".fact-line", { hasText: "silver hair" }).count()) === 0, "changes took effect from chapter A, not from the root");

  // ---- dismissed list, with Reopen ----
  await page.goto(`${inbox}&chapter=${A}`);
  await page.getByRole("button", { name: /^Show dismissed \(3\)$/ }).click();
  const dismissedEyes = page.locator("ul.inbox-dismissed li", { hasText: "Eyes" });
  await dismissedEyes.waitFor();
  ok((await dismissedEyes.getByRole("button", { name: "Reopen" }).count()) === 1, "the dismissed ones are listed behind a button, each with Reopen");
  await dismissedEyes.getByRole("button", { name: "Reopen" }).click();
  await go().waitFor();
  ok((await goText()).includes("1 change waiting from this chapter"), "Reopen puts the suggestion back in the box");
  await go().click();
  await page.waitForURL(`${BASE}/c/${A}/codex-review`);
  const eyes = reviewCard("Rowan · Eyes");
  await eyes.waitFor();
  ok((await eyes.getByText("blue", { exact: true }).isVisible()) && (await eyes.getByRole("button", { name: "Keep green" }).isVisible()), "the reopened conflict is on the review page, with Make it blue / Keep green");
  await eyes.getByRole("button", { name: "Make it blue" }).click();
  await page.locator(".cr-done").getByText(/Saved:\s*Rowan/).waitFor();
  await rowanPage(A);
  await factLine("blue").waitFor();
  ok(true, "Update codex wrote the new eyes");

  // ---- an inbox with nothing in it ----
  const empty = await post("/api/stories", { title: "Quiet Tale", premise: "p", chapter: { title: "Only", body: "Nothing happens.", choices: [] } });
  await page.goto(`${BASE}/s/${empty.story_id}/review?tab=codex`);
  await page.getByText("No entries yet.").waitFor();
  ok(true, "an empty codex says so");
  await page.locator('summary[aria-label="Codex actions"]').click();
  ok(await page.getByRole("button", { name: /^Check every chapter with AI/ }).isVisible(), "…and the ⋯ menu offers the check");
  await page.goto(`${BASE}/c/${empty.chapter_id}`);
  await page.waitForTimeout(500);
  ok((await page.locator("p.notice", { hasText: "Codex:" }).count()) === 0, "no banner when nothing was found");

  // ---- the check buttons queue a review run with a codex task ----
  await send("PUT", "/api/queue/paused", { paused: true });
  await page.goto(`${BASE}/c/${A}/codex?review=1`);
  const started = page.waitForResponse((r) => r.url().endsWith("/api/ai-runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Check this chapter with AI" }).click();
  const run = await send("GET", `/api/ai-runs/${(await (await started).json()).id}`);
  ok(run.mode === "review" && run.options.checks?.join() === "codex" && run.options.recheck === true && run.options.tagScope === "chapter", "Check this chapter makes a review run with checks [codex] and recheck");
  ok(run.tasks.length === 1 && run.tasks[0].kind === "codex" && run.tasks[0].chapterId === A, "…with a codex task for this chapter");
  await page.getByText(/Check the codex for/).first().waitFor();
  ok(true, "the run's progress lists the codex task");
  await page.locator('summary[aria-label="Codex actions"]').click();
  ok(await page.getByRole("button", { name: /^Check this chapter with AI/ }).isDisabled(), "a second check waits for the first");
  await page.goto(inbox);
  const startedAll = page.waitForResponse((r) => r.url().endsWith("/api/ai-runs") && r.request().method() === "POST");
  await page.locator('summary[aria-label="Codex actions"]').click();
  await page.getByRole("button", { name: /^Check every chapter with AI/ }).click();
  const run2 = await send("GET", `/api/ai-runs/${(await (await startedAll).json()).id}`);
  ok(run2.options.tagScope === "story" && run2.tasks.filter((t) => t.kind === "codex").length === 2, "Check every chapter with AI makes a codex task for each chapter of the story");

  // ---- the setting ----
  await send("PUT", "/api/queue/paused", { paused: false });
  await page.goto(`${BASE}/settings#codex`);
  // The tab is picked from the address once the page's script runs, which can be after the page has loaded.
  ok(await page.getByRole("tab", { name: "Writing", selected: true }).waitFor({ timeout: 10000 }).then(() => true, () => false), "#codex opens the Writing tab");
  const setting = page.getByRole("checkbox", { name: /Suggest codex changes after a chapter is saved/ });
  await setting.waitFor();
  ok(!(await setting.isChecked()), "the codex setting shows the saved value (off under the mock AI)");
  await setting.check();
  await page.waitForFunction(async () => (await (await fetch("/api/settings")).json()).settings?.autoCodex === true);
  await page.reload();
  ok(await page.getByRole("checkbox", { name: /Suggest codex changes after a chapter is saved/ }).isChecked(), "…and on after a reload");
  await page.getByRole("checkbox", { name: /Suggest codex changes after a chapter is saved/ }).uncheck();
  await page.waitForFunction(async () => (await (await fetch("/api/settings")).json()).settings?.autoCodex === false);
  ok(true, "the setting saves");
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
} finally {
  await send("PUT", "/api/queue/paused", { paused: false }).catch(() => {});
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
