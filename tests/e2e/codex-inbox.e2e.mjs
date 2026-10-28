import { launch, useMockAi } from "./browser.mjs";

// The codex inbox: suggestions the codex check left, shown in the Story Bible's codex tab, with the banner on the
// chapter page, the count on the codex page, the setting, and the buttons that queue a check. Suggestions are seeded
// through the worker's route, so no AI is involved.
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
  const story = await post("/api/stories", { title: "Inbox Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there. Her eyes were green.", choices: ["Go to A"] } });
  storyId = story.story_id;
  const root = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${root}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan's hair turned silver. Her eyes were blue. Kestrel the hawk joined her.", choices: [] })).chapter_id;
  const rowan = (await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Rowan", type: "character", aliases: [], content: "A young traveller.", always_include: false })).entry_id;
  for (const [aspect, text] of [["Hair", "dark brown hair"], ["Eyes", "green"], ["Weapon", "a wooden sword"], ["Mood", "calm"]]) {
    await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: rowan, op: "set", aspect, text });
  }
  const rev = async (id) => (await send("GET", `/api/chapters/${id}`)).chapter.revision;
  const seed = (id, revision, suggestions) => post(`/api/chapters/${id}/codex-suggestions`, { revision, suggestions });
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
  await seed(root, await rev(root), [s("set", { aspect: "Voice", after: "low and quiet", quote: "Rowan stood there." })]);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const inbox = `${BASE}/s/${storyId}/review?tab=codex`;
  const card = (quote) => page.locator("article.inbox-card", { hasText: quote });
  const rowanFacts = () => page.locator("article", { hasText: "Rowan" }).first();
  const factLine = (t) => rowanFacts().locator(".fact-line", { hasText: t });

  // ---- the chapter page banner and the codex page count ----
  await page.goto(`${BASE}/c/${A}`);
  const banner = page.getByText(/Codex: 7 suggestions from this chapter/);
  await banner.waitFor();
  const href = await page.locator("p.notice", { hasText: "Codex:" }).getByRole("link", { name: "Review" }).getAttribute("href");
  ok(href === `/s/${storyId}/review?tab=codex&chapter=${A}`, "the banner links to the Story Bible codex tab for this chapter: " + href);
  await page.goto(`${BASE}/c/${A}/codex`);
  const line = page.getByText(/Codex inbox: 8 suggestions waiting on this branch/);
  ok(await line.isVisible(), "the codex page counts the branch's suggestions (8)");
  ok((await line.locator("a", { hasText: "Review" }).getAttribute("href")) === `/s/${storyId}/review?tab=codex`, "…and links to the inbox");
  await page.goto(`${BASE}/c/${root}/codex`);
  ok(await page.getByText(/Codex inbox: 1 suggestion waiting on this branch/).isVisible(), "the root's branch has 1");

  // ---- the banner leads to the filtered inbox ----
  await page.goto(`${BASE}/c/${A}`);
  await banner.waitFor();
  await page.locator("p.notice", { hasText: "Codex:" }).getByRole("link", { name: "Review" }).click();
  await page.waitForURL(new RegExp(`tab=codex&chapter=${A}`));
  await card("Rowan's hair turned silver.").waitFor();
  ok((await page.locator("article.inbox-card").count()) === 7, "filtered to the chapter: its 7 cards");
  ok((await card("Rowan stood there.").count()) === 0, "…and not the root's");
  await page.getByRole("link", { name: "Show all chapters" }).click();
  await card("Rowan stood there.").waitFor();
  ok((await page.locator("article.inbox-card").count()) === 8, "Show all chapters lists all 8");
  ok((await page.locator("h3.inbox-chapter").allInnerTexts()).join("|") === "Root|Chapter A", "grouped by chapter, in story order");

  // ---- the cards ----
  const hair = card("Rowan's hair turned silver.");
  ok((await hair.locator("del").innerText()).includes("dark brown") && (await hair.locator("ins").innerText()).includes("silver"), "a change shows the old words in del and the new in ins");
  ok(await hair.locator(".inbox-quote").isVisible(), "…with the quote from the chapter");
  ok((await card("She laced her red boots.").locator("del").count()) === 0 && (await card("She laced her red boots.").locator("ins").innerText()).includes("red boots"), "a new aspect is all ins");
  ok((await card("wooden sword behind").locator("ins").count()) === 0 && (await card("wooden sword behind").locator("del").innerText()).includes("a wooden sword"), "a removal is all del");
  ok(await card("She laced her red boots.").getByText("New aspect").isVisible() && await card("wooden sword behind").getByText("Remove").isVisible(), "kind labels");
  const conflict = card("Her eyes were blue.");
  ok(await conflict.getByRole("button", { name: "Update codex" }).isVisible() && await conflict.getByRole("button", { name: "Keep the codex" }).isVisible(), "a conflict card offers Update codex / Keep the codex");
  ok((await conflict.getByRole("button", { name: "Edit" }).count()) === 0, "…and no Edit");
  const kestrel = card("Kestrel the hawk joined her.");
  ok(await kestrel.getByText("also called the hawk").isVisible() && await kestrel.getByText("A hunting hawk.").isVisible() && await kestrel.getByText("brown").isVisible(), "a new entry card shows aliases, notes and facts");

  // ---- accept a change ----
  await hair.getByRole("button", { name: "Accept" }).click();
  await page.getByText(/Saved to Rowan at “Chapter A”/).waitFor();
  ok((await page.locator("article.inbox-card").count()) === 7, "an accepted card collapses to one line");

  // ---- edit, then save ----
  const boots = card("She laced her red boots.");
  await boots.getByRole("button", { name: "Edit" }).click();
  await boots.getByLabel("Fact").fill("scuffed red boots");
  await boots.getByRole("button", { name: "Save" }).click();
  await page.getByText(/Saved to Rowan at “Chapter A”/).nth(1).waitFor();

  // ---- dismiss, then undo ----
  const mood = card("Rowan was tense.");
  await mood.getByRole("button", { name: "Dismiss" }).click();
  await page.getByText("Dismissed", { exact: false }).first().waitFor();
  ok((await card("Rowan was tense.").count()) === 0, "a dismissed card collapses");
  await page.locator(".inbox-done", { hasText: "Dismissed" }).getByRole("button", { name: "Undo" }).click();
  await card("Rowan was tense.").waitFor();
  ok(true, "Undo brings the dismissed card back");

  // ---- a conflict: keep the codex ----
  await conflict.getByRole("button", { name: "Keep the codex" }).click();
  await page.locator(".inbox-done", { hasText: "Dismissed" }).waitFor();

  // ---- a new entry ----
  await kestrel.getByRole("button", { name: "Accept" }).click();
  await page.getByText(/Saved to Kestrel at “Chapter A”/).waitFor();

  // ---- accept all for an entry (leaves out conflicts and new entries) ----
  const all = page.getByRole("button", { name: "Accept all for Rowan" });
  ok(await all.isVisible(), "an entry with several open changes offers Accept all");
  await all.click();
  await page.waitForFunction(() => document.querySelectorAll("article.inbox-card").length === 1);
  ok(await page.locator("article.inbox-card", { hasText: "Rowan stood there." }).isVisible(), "…only the other chapter's card is still open");

  // ---- what reached the codex ----
  await page.goto(`${BASE}/c/${A}/codex`);
  await factLine("silver hair").waitFor();
  ok(await factLine("scuffed red boots").isVisible(), "the edited fact was saved");
  ok(await factLine("tense").isVisible(), "the fact accepted with Accept all was saved");
  ok((await factLine("wooden sword").count()) === 0, "the removal took effect");
  ok(await rowanFacts().getByText("Form: hawk").isVisible(), "the form was set");
  ok(await factLine("green").isVisible() && (await factLine("blue").count()) === 0, "Keep the codex left the green eyes");
  ok(await page.locator("article", { hasText: "Kestrel" }).first().getByText("A hunting hawk.").isVisible(), "the new entry was created");
  ok(await page.getByText(/Codex inbox: 1 suggestion waiting/).isVisible(), "the codex page now counts 1");
  await page.goto(`${BASE}/c/${root}/codex`);
  ok((await rowanFacts().locator(".fact-line", { hasText: "silver hair" }).count()) === 0, "changes took effect from chapter A, not from the root");

  // ---- dismissed list, with Reopen ----
  await page.goto(inbox);
  await page.getByRole("button", { name: "Dismissed (1)" }).click();
  await page.getByText(/Her eyes were blue|“blue”/).first().waitFor();
  await page.getByRole("button", { name: "Reopen" }).click();
  await card("Her eyes were blue.").waitFor();
  ok(true, "Reopen on the Dismissed list puts the card back");
  await card("Her eyes were blue.").getByRole("button", { name: "Update codex" }).click();
  await page.getByText(/Saved to Rowan at “Chapter A”/).waitFor();
  await page.goto(`${BASE}/c/${A}/codex`);
  await factLine("blue").waitFor();
  ok(true, "Update codex wrote the new eyes");

  // ---- an inbox with nothing in it ----
  const empty = await post("/api/stories", { title: "Quiet Tale", premise: "p", chapter: { title: "Only", body: "Nothing happens.", choices: [] } });
  await page.goto(`${BASE}/s/${empty.story_id}/review?tab=codex`);
  await page.getByText("No codex suggestions waiting.").waitFor();
  ok(true, "an empty inbox says so");
  ok(await page.getByRole("button", { name: "Check every chapter", exact: true }).isVisible(), "…and offers the check below");
  await page.goto(`${BASE}/c/${empty.chapter_id}`);
  await page.waitForTimeout(500);
  ok((await page.locator("p.notice", { hasText: "Codex:" }).count()) === 0, "no banner when nothing was found");

  // ---- the check buttons queue a review run with a codex task ----
  await send("PUT", "/api/queue/paused", { paused: true });
  await page.goto(`${BASE}/c/${A}/codex?review=1`);
  const started = page.waitForResponse((r) => r.url().endsWith("/api/ai-runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Check this chapter" }).click();
  const run = await send("GET", `/api/ai-runs/${(await (await started).json()).id}`);
  ok(run.mode === "review" && run.options.checks?.join() === "codex" && run.options.recheck === true && run.options.tagScope === "chapter", "Check this chapter makes a review run with checks [codex] and recheck");
  ok(run.tasks.length === 1 && run.tasks[0].kind === "codex" && run.tasks[0].chapterId === A, "…with a codex task for this chapter");
  await page.getByText(/Check the codex for/).first().waitFor();
  ok(true, "the run's progress lists the codex task");
  ok(await page.getByRole("button", { name: "Check every chapter on this branch" }).isDisabled(), "a second check waits for the first");
  await page.reload();
  const startedAll = page.waitForResponse((r) => r.url().endsWith("/api/ai-runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Check every chapter on this branch" }).click();
  const run2 = await send("GET", `/api/ai-runs/${(await (await startedAll).json()).id}`);
  ok(run2.options.tagScope === "path" && run2.tasks.filter((t) => t.kind === "codex").length === 2, "Check every chapter on this branch makes a codex task for each chapter on the path");
  ok(await page.getByRole("link", { name: "Open the codex inbox" }).isVisible(), "the codex page links to the inbox");

  // ---- the setting ----
  await send("PUT", "/api/queue/paused", { paused: false });
  await page.goto(`${BASE}/settings#tags`);
  const box = page.getByRole("checkbox", { name: /Suggest codex changes after a chapter is saved/ });
  await box.waitFor();
  ok(!(await box.isChecked()), "the codex setting shows the saved value (off under the mock AI)");
  await box.check();
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
