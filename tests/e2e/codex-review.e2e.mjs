import { launch, useMockAi } from "./browser.mjs";

// The review page beside a chapter's text (/c/<id>/codex-review): each quoted sentence is a highlight (button.cr-mark) and
// the change it backs is a card in the margin of its paragraph (under it on a phone); tapping one selects the other.
// Covers the highlights, both directions of selecting, Accept / Edit / Dismiss / Undo, a conflict, a new entry, a fact the
// AI applied (Approve, Undo), changes whose sentence isn't in this chapter, the ?entry= filter, #s-<id> on load, "Accept
// the N the text shows", and a phone screen. Seeded through the suggestions route, so no AI is involved.
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
let sid;
const settingsBefore = (await send("GET", "/api/settings")).settings;
try {
  // ---- a story with two entries and a chapter of five paragraphs ----
  const paragraphs = [
    "Rowan's hair turned silver as the sun rose. She laced her red boots and stood.",
    "Her eyes were blue as the sea. The wind carried a scent of smoke.",
    "Kestrel the hawk joined her on the ridge.",
    "Rowan was tense. Mira tipped her hat to the stranger.",
    "Rowan's ears changed. Mira wore a grey cloak.",
  ];
  const story = await post("/api/stories", { title: "Review Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there. Her voice was low and quiet.", choices: ["Go to A"] } });
  sid = story.story_id;
  const root = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${root}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: paragraphs.join("\n\n"), choices: [] })).chapter_id;
  const mkEntry = async (name) => (await post("/api/codex", { anchor_chapter_id: root, op: "create", name, type: "character", aliases: [], content: `About ${name}.`, always_include: false })).entry_id;
  const rowan = await mkEntry("Rowan");
  const mira = await mkEntry("Mira");
  for (const [aspect, text] of [["Hair", "dark brown hair"], ["Eyes", "green"], ["Mood", "calm"]]) await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: rowan, op: "set", aspect, text });
  const rev = async (id) => (await send("GET", `/api/chapters/${id}`)).chapter.revision;
  const s = (entry_id, kind, extra) => ({ kind, entry_id, aspect: "", form: "", after: "", quote: "", ...extra });

  // Two facts the AI applied on its own (the setting is on only while this reading is saved).
  const base = settingsBefore ?? {};
  await send("PUT", "/api/settings", { ...base, autoCodex: true, autoApplyCodex: true });
  const applied = await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: await rev(A),
    suggestions: [
      s(rowan, "set", { aspect: "Ears", after: "tall fox ears", quote: "Rowan's ears changed" }),
      s(mira, "set", { aspect: "Cloak", after: "a grey cloak", quote: "Mira wore a grey cloak" }),
    ],
  });
  await send("PUT", "/api/settings", { ...base, autoCodex: false, autoApplyCodex: false });
  ok(applied.applied === 2, "two facts were applied by the AI: " + JSON.stringify(applied));
  // The changes that wait for the owner: seven from the text, and one Flesh out one whose sentence is from the root.
  const waiting = await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: await rev(A),
    suggestions: [
      s(rowan, "set", { aspect: "Hair", after: "silver hair", quote: "Rowan's hair turned silver" }),
      s(rowan, "set", { aspect: "Boots", after: "red boots", quote: "She laced her red boots" }),
      s(rowan, "conflict", { aspect: "Eyes", after: "blue", quote: "Her eyes were blue as the sea" }),
      s(rowan, "set", { aspect: "Scarf", after: "a green scarf", quote: "The wind carried a scent of smoke" }),
      { kind: "entry", aspect: "", form: "", after: "", quote: "Kestrel the hawk joined her", entry: { name: "Kestrel", type: "character", aliases: ["the hawk"], notes: "A hunting hawk.", facts: [] } },
      s(rowan, "set", { aspect: "Mood", after: "tense", quote: "Rowan was tense" }),
      s(mira, "set", { aspect: "Hat", after: "a feathered hat", quote: "Mira tipped her hat" }),
    ],
  });
  ok(waiting.saved === 7, "seven changes wait: " + JSON.stringify(waiting));
  const expand = await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: await rev(A),
    source: "expand",
    entry_id: rowan,
    suggestions: [s(rowan, "set", { aspect: "Voice", after: "low and quiet", quote: "Her voice was low and quiet" }), s(rowan, "set", { aspect: "Fear", after: "deep water", quote: "" })],
  });
  ok(expand.saved === 2, "a Flesh out reading was saved: one with a sentence from the root, one with none: " + JSON.stringify(expand));

  const open = (await send("GET", `/api/stories/${sid}/codex-suggestions?status=open`)).suggestions ?? [];
  const idOf = (aspect) => open.find((x) => x.aspect === aspect || (aspect === "Kestrel" && x.kind === "entry"))?.id;
  ok(open.length >= 9 && ["Hair", "Boots", "Eyes", "Scarf", "Kestrel", "Mood", "Hat", "Voice"].every((a) => idOf(a)), "all the suggestions are there after the later readings: " + open.map((x) => x.aspect || x.kind).join(","));

  const url = (extra = "") => `${BASE}/c/${A}/codex-review${extra}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  const cardOf = (t) => page.locator("article.cr-card", { hasText: t });
  const markOf = (text) => page.locator("button.cr-mark", { hasText: text });
  const done = (t) => page.locator(".cr-card.cr-done", { hasText: t });
  const bar = page.locator(".cr-bar");
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // ---- the page: bar, highlights, margin ----
  await page.goto(url());
  await cardOf("Rowan · Hair").waitFor();
  ok((await bar.getByRole("link", { name: "← “Chapter A”" }).getAttribute("href")) === `/c/${A}`, "the bar links back to the chapter");
  ok((await bar.getByRole("heading", { level: 1 }).innerText()) === "Codex changes from “Chapter A”", "the heading names the chapter");
  ok((await bar.getByText("8 waiting · 2 applied by the AI to approve").isVisible()), "the bar counts what waits: 8 changes, and apart the 2 applied facts, not the idea with no sentence");
  ok((await bar.getByRole("link", { name: "Done" }).getAttribute("href")) === `/c/${A}`, "Done leads back to the chapter");
  ok((await page.locator(".cr-row").count()) === 5 && (await page.locator(".cr-para").count()) === 5, "the text is in one row per paragraph");
  const rowOf = (i) => page.locator(".cr-row").nth(i);
  // A highlight takes the sentence's closing punctuation with it; compare the words.
  const markTexts = async (i) => (await rowOf(i).locator("button.cr-mark").allInnerTexts()).map((t) => t.trim().replace(/[.,!?;:…”"’)]+$/, ""));
  ok((await markTexts(0)).join("|") === "Rowan's hair turned silver|She laced her red boots", "paragraph 1 highlights the two quoted sentences, and only them: " + (await markTexts(0)).join("|"));
  ok((await markTexts(1)).join("|") === "Her eyes were blue as the sea|The wind carried a scent of smoke", "paragraph 2: " + (await markTexts(1)).join("|"));
  ok((await markTexts(2)).join("|") === "Kestrel the hawk joined her" && (await markTexts(3)).join("|") === "Rowan was tense|Mira tipped her hat" && (await markTexts(4)).join("|") === "Rowan's ears changed|Mira wore a grey cloak", "paragraphs 3 to 5 highlight their sentences");
  ok((await page.locator("button.cr-mark").count()) === 9, "nine highlights: every change with a sentence in this chapter");
  ok((await rowOf(0).locator(".cr-margin article.cr-card").count()) === 2 && (await rowOf(2).locator(".cr-margin article.cr-card").count()) === 1, "each paragraph's margin holds the cards its highlights back");
  const paraText = await rowOf(0).locator(".cr-para").innerText();
  ok(paraText.startsWith("Rowan's hair turned silver as the sun rose.") && paraText.includes("and stood."), "the highlights leave the rest of the paragraph's words as they were");
  ok((await page.locator(".cr-selected").count()) === 0, "nothing is selected to begin with");
  const geo = await rowOf(0).evaluate((r) => {
    const p = r.querySelector(".cr-para").getBoundingClientRect();
    const m = r.querySelector(".cr-margin").getBoundingClientRect();
    return { paraRight: p.right, marginLeft: m.left, paraTop: p.top, marginTop: m.top };
  });
  ok(geo.marginLeft >= geo.paraRight - 1 && Math.abs(geo.marginTop - geo.paraTop) < 40, "on a wide screen the margin is beside its paragraph, level with it");
  ok(await sideways(), "no sideways scroll at 1280px");

  // ---- what each card says ----
  const hair = cardOf("Rowan · Hair");
  ok((await hair.locator("del").innerText()).includes("dark brown") && (await hair.locator("ins").innerText()).includes("silver") && (await hair.locator(".source-badge").innerText()) === "From the text", "a change card shows the old words in del and the new in ins, with where it comes from");
  const eyes = cardOf("Rowan · Eyes");
  ok((await eyes.locator(".source-badge").innerText()) === "Contradicts the codex" && (await eyes.getByRole("button", { name: "Make it blue" }).isVisible()) && (await eyes.getByRole("button", { name: "Keep green" }).isVisible()) && (await eyes.getByRole("button", { name: "Edit" }).count()) === 0, "a conflict card says what the codex has and offers Make it blue / Keep green, no Edit");
  const scarf = cardOf("Rowan · Scarf");
  ok((await scarf.locator(".source-badge").innerText()) === "Quote doesn't show this" && (await scarf.locator(".inbox-unsure").isVisible()), "a quote that doesn't mention the fact is labelled 'Quote doesn't show this', with a note");
  const kestrel = cardOf("New character: Kestrel");
  ok((await kestrel.getByText("A hunting hawk.").isVisible()) && (await kestrel.getByRole("button", { name: "Add it" }).isVisible()) && (await kestrel.getByRole("button", { name: "Dismiss" }).isVisible()), "a new entry's card has its notes, Add it and Dismiss");
  const ears = cardOf("Rowan · Ears");
  ok((await ears.locator(".source-badge").innerText()) === "Already applied by the AI" && (await ears.getByRole("button", { name: "Approve" }).isVisible()) && (await ears.getByRole("button", { name: "Undo" }).isVisible()), "an AI-applied fact is marked as applied and offers Approve / Undo");

  // ---- changes whose sentence isn't in this chapter ----
  const unplaced = page.locator("section[aria-label='Not quoted from this chapter']");
  ok((await unplaced.getByRole("heading", { name: "Not quoted from this chapter" }).isVisible()) && (await unplaced.locator("article.cr-card").count()) === 1, "one change is listed as not quoted from this chapter");
  const voice = unplaced.locator("article.cr-card", { hasText: "Rowan · Voice" });
  ok((await voice.locator(".source-badge").innerText()) === "From the story" && (await voice.getByRole("button", { name: "Accept" }).isVisible()), "…the Flesh out one whose sentence is from an earlier chapter, with Accept");
  ok((await page.locator("button.cr-mark[data-for='s-" + idOf("Voice") + "']").count()) === 0 && (await page.locator(".cr-margin article.cr-card").count()) === 9, "…it has no highlight here, and the other nine are in the margins");
  const notice = page.locator("p.notice", { hasText: "AI idea" });
  ok((await notice.innerText()).includes("1 AI idea with no sentence in the story wait on Rowan's page") && (await notice.getByRole("link", { name: "Rowan's page" }).getAttribute("href")) === `/s/${sid}/codex/${rowan}?at=${A}`, "an AI idea with no sentence is not a card: a notice points to the entry's page");
  ok((await page.getByText("deep water").count()) === 0, "…and its text isn't on this page");

  // ---- selecting: a highlight selects its card, a card its highlight ----
  const moodId = idOf("Mood");
  await markOf("Rowan was tense").click();
  ok((await markOf("Rowan was tense").getAttribute("class")).includes("cr-selected") && (await cardOf("Rowan · Mood").getAttribute("class")).includes("cr-selected") && (await page.locator(".cr-selected").count()) === 2, "tapping a highlight selects it and its card, and nothing else");
  ok((await markOf("Rowan was tense").getAttribute("data-for")) === `s-${moodId}` && (await cardOf("Rowan · Mood").getAttribute("id")) === `s-${moodId}`, "…they are tied by the change's id");
  ok(await cardOf("Rowan · Mood").isVisible() && (await cardOf("Rowan · Mood").boundingBox()).y >= 0, "the selected card is on screen");
  await cardOf("Rowan · Hair").locator(".cr-card-title").click();
  ok((await markOf("Rowan's hair turned silver").getAttribute("class")).includes("cr-selected") && (await markOf("Rowan was tense").getAttribute("class")).includes("cr-selected") === false && (await page.locator(".cr-selected").count()) === 2, "tapping a card's title selects its highlight instead");
  await markOf("Mira wore a grey cloak").click();
  ok((await cardOf("Mira · Cloak").getAttribute("class")).includes("cr-selected") && (await cardOf("Mira · Cloak").getAttribute("id")).startsWith("f-"), "an applied fact's highlight selects its card too");

  // ---- a link to one change selects it on load ----
  await page.goto("about:blank"); // (a change of the address's hash alone wouldn't load the page again)
  await page.goto(url(`#s-${idOf("Hat")}`));
  await cardOf("Mira · Hat").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".cr-selected").length === 2);
  ok((await cardOf("Mira · Hat").getAttribute("class")).includes("cr-selected") && (await markOf("Mira tipped her hat").getAttribute("class")).includes("cr-selected"), "#s-<id> in the address selects that change and its highlight on load");

  // ---- one entry's changes, and the Show select ----
  const options = (await bar.locator("select option").allInnerTexts()).map((t) => t.trim());
  ok(options[0] === "Everyone" && options.slice(1).sort().join("|") === "Mira|Rowan", "the Show select lists everyone and each entry with changes: " + options.join("|"));
  await bar.locator("select").selectOption({ label: "Mira" });
  await page.waitForURL(url(`?entry=${mira}`));
  await cardOf("Mira · Hat").waitFor();
  ok((await bar.getByRole("heading", { level: 1 }).innerText()) === "Codex changes from “Chapter A” for Mira", "choosing an entry shows only its changes, and the heading says whose");
  ok((await page.locator("article.cr-card").count()) === 2 && (await cardOf("Mira · Cloak").count()) === 1 && (await page.locator("button.cr-mark").count()) === 2, "…its change and its applied fact, with their two highlights");
  ok((await bar.getByText("1 waiting · 1 applied by the AI to approve").isVisible()) && (await page.locator("section[aria-label='Not quoted from this chapter']").count()) === 0, "…and counts only those: " + (await bar.locator(".meta").first().innerText()));
  await page.goto(url(`?entry=${rowan}`));
  await cardOf("Rowan · Hair").waitFor();
  ok((await page.locator("article.cr-card").count()) === 7 && (await cardOf("New character").count()) === 0 && (await cardOf("Rowan · Voice").count()) === 1, "Rowan's: her six changes and one applied fact (the new entry isn't hers), the not-quoted one included");
  await bar.locator("select").selectOption({ label: "Everyone" });
  await page.waitForURL(url());
  await cardOf("Mira · Hat").waitFor();
  ok((await page.locator("article.cr-card").count()) === 10, "Everyone shows them all again");

  // ---- a phone: the card comes right after its paragraph, nothing scrolls sideways ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url());
  await cardOf("Rowan · Hair").waitFor();
  ok(await sideways(), "no sideways scroll at 390px");
  const flow = await page.evaluate(() =>
    [...document.querySelectorAll(".cr-row.cr-has")].map((r) => {
      const p = r.querySelector(".cr-para").getBoundingClientRect();
      const m = r.querySelector(".cr-margin").getBoundingClientRect();
      const cardsRight = Math.max(...[...r.querySelectorAll(".cr-card")].map((c) => c.getBoundingClientRect().right));
      return { gap: m.top - p.bottom, below: m.top >= p.bottom - 1, cardsRight, left: m.left };
    }),
  );
  ok(flow.length === 5 && flow.every((f) => f.below && f.gap < 40), "on a phone each paragraph's cards sit right under it: " + JSON.stringify(flow.map((f) => Math.round(f.gap))));
  ok(flow.every((f) => f.cardsRight <= 390 && f.left >= 0), "…and inside the screen");
  await markOf("Kestrel the hawk joined her").click();
  ok((await kestrel.getAttribute("class")).includes("cr-selected"), "tapping a highlight selects its card on a phone too");
  ok(await sideways(), "…still without sideways scroll");
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---- Accept ----
  await page.goto(url());
  await cardOf("Rowan · Hair").waitFor();
  await cardOf("Rowan · Hair").getByRole("button", { name: "Accept" }).click();
  await done("Rowan · Hair").waitFor();
  ok((await done("Rowan · Hair").innerText()).includes("Saved: Rowan · Hair") && (await page.locator("article.cr-card", { hasText: "Rowan · Hair" }).count()) === 0, "Accept collapses the card to 'Saved: …'");
  ok((await markOf("Rowan's hair turned silver").count()) === 1 && (await page.locator("button.cr-mark").count()) === 9, "…and the highlight stays");
  const rowanFacts = async () => (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Rowan").facts;
  ok((await rowanFacts()).some((f) => f.aspect === "Hair" && f.text === "silver hair"), "…the codex has the new hair at this chapter");
  ok((await bar.getByText("7 waiting · 2 applied by the AI to approve").isVisible()), "…and the bar counts one fewer: " + (await bar.locator(".meta").first().innerText()));

  // ---- Edit, then Save ----
  const boots = cardOf("Rowan · Boots");
  await boots.getByRole("button", { name: "Edit" }).click();
  await boots.getByLabel("Fact").fill("scuffed red boots");
  await boots.getByRole("button", { name: "Save" }).click();
  await done("Rowan · Boots").waitFor();
  ok((await rowanFacts()).some((f) => f.aspect === "Boots" && f.text === "scuffed red boots"), "Edit then Save writes the edited fact");

  // ---- Dismiss, then Undo ----
  await cardOf("Rowan · Mood").getByRole("button", { name: "Dismiss" }).click();
  await done("Dismissed: Rowan · Mood").waitFor();
  ok((await cardOf("Rowan · Mood").count()) === 0, "Dismiss collapses the card to 'Dismissed: …'");
  await done("Dismissed: Rowan · Mood").getByRole("button", { name: "Undo" }).click();
  await cardOf("Rowan · Mood").waitFor();
  ok((await cardOf("Rowan · Mood").getByRole("button", { name: "Accept" }).isVisible()), "Undo brings the card back");

  // ---- a conflict ----
  await eyes.getByRole("button", { name: "Keep green" }).click();
  await done("Dismissed: Rowan · Eyes").waitFor();
  ok((await rowanFacts()).find((f) => f.aspect === "Eyes").text === "green", "Keep green leaves the codex as it was");
  await done("Dismissed: Rowan · Eyes").getByRole("button", { name: "Undo" }).click();
  await eyes.getByRole("button", { name: "Make it blue" }).click();
  await done("Saved: Rowan · Eyes").waitFor();
  ok((await rowanFacts()).find((f) => f.aspect === "Eyes").text === "blue", "Undo, then Make it blue, changes the codex to blue");

  // ---- a new entry ----
  await kestrel.getByRole("button", { name: "Add it" }).click();
  await done("Saved: New character: Kestrel").waitFor();
  const names = (await send("GET", `/api/chapters/${A}/codex`)).entries.map((e) => e.name);
  ok(names.includes("Kestrel"), "Add it creates the new entry");

  // ---- facts the AI applied: Approve, Undo ----
  await ears.getByRole("button", { name: "Approve" }).click();
  await done("Approved: Rowan · Ears").waitFor();
  const earsFact = (await rowanFacts()).find((f) => f.aspect === "Ears");
  ok(earsFact?.text === "tall fox ears" && !earsFact.op.ai_suggestion_id, "Approve keeps the fact and takes the AI mark off");
  await cardOf("Mira · Cloak").getByRole("button", { name: "Undo" }).click();
  await done("Undone: Mira · Cloak").waitFor();
  const miraFacts = (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Mira").facts;
  ok(!miraFacts.some((f) => f.aspect === "Cloak"), "Undo takes the AI's fact out of the codex");

  // ---- Accept the N the text shows ----
  const all = bar.getByRole("button", { name: /^Accept the \d+ the text shows$/ });
  ok((await all.innerText()) === "Accept the 3 the text shows", "the bulk button counts the open changes the text backs (Mood, Hat, Voice), not the unsure one, the conflict or a new entry: " + (await all.innerText()));
  await all.click();
  await done("Saved: Rowan · Mood").waitFor();
  await done("Saved: Mira · Hat").waitFor();
  await done("Saved: Rowan · Voice").waitFor();
  ok((await scarf.getByRole("button", { name: "Accept" }).isVisible()) && (await scarf.locator(".source-badge").innerText()) === "Quote doesn't show this", "it left the 'Quote doesn't show this' one for the owner to read");
  ok((await all.count()) === 0, "…and the button goes");
  ok((await bar.getByText("1 waiting").isVisible()), "…leaving one waiting");
  ok((await rowanFacts()).every((f) => f.aspect !== "Scarf") && (await rowanFacts()).some((f) => f.aspect === "Voice" && f.text === "low and quiet"), "the codex has the three, and not the scarf");

  // ---- what is left is gone after a reload, and nothing waits once the last is decided ----
  await scarf.getByRole("button", { name: "Dismiss" }).click();
  await done("Dismissed: Rowan · Scarf").waitFor();
  await page.reload();
  await bar.getByText("nothing waiting").waitFor();
  ok((await page.locator("article.cr-card").count()) === 0, "with everything decided and the page opened again, no cards wait");
  await ctx.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  if (sid) await send("DELETE", `/api/stories/${sid}`).catch(() => {});
  await send("PUT", "/api/settings", settingsBefore ?? {}).catch(() => {});
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
