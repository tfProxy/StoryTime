import { launch, useMockAi } from "./browser.mjs";

// The suggestions on a chapter's codex (the Story Bible's Codex section narrowed to the chapter): the "Changes waiting" box
// counts the ones made at the chapter and links to the review page beside the chapter's text, where they are accepted or
// dismissed; earlier chapters on the branch that still have some are linked. Seeded through the suggestions route, so no
// AI is involved.
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
  // Root -> A (-> A2) and Root -> B
  const story = await post("/api/stories", { title: "Page Inbox", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["To A", "To B"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const choices = (await send("GET", `/api/chapters/${R}`)).choices;
  const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "Chapter A", body: "Her hair turned silver. Kestrel the hawk joined her.", choices: ["Onward"] })).chapter_id;
  const A2 = (await post("/api/chapters", { choice_id: (await send("GET", `/api/chapters/${A}`)).choices[0].id, title: "Chapter A2", body: "Quiet.", choices: [] })).chapter_id;
  const B = (await post("/api/chapters", { choice_id: choices[1].id, title: "Chapter B", body: "Elsewhere.", choices: [] })).chapter_id;
  const rowan = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Rowan", type: "character", content: "" })).entry_id;
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: rowan, op: "set", aspect: "Hair", text: "dark brown hair" });
  const rev = async (id) => (await send("GET", `/api/chapters/${id}`)).chapter.revision;
  const seed = async (id, list) => post(`/api/chapters/${id}/codex-suggestions`, { revision: await rev(id), suggestions: list });
  const s = (extra) => ({ kind: "set", entry_id: rowan, aspect: "", form: "", after: "", quote: "", ...extra });
  await seed(R, [s({ aspect: "Mood", after: "calm", quote: "Rowan stood there." })]);
  await seed(A, [
    s({ aspect: "Hair", after: "silver hair", quote: "Her hair turned silver." }),
    { kind: "entry", entry_id: undefined, aspect: "", form: "", after: "", quote: "Kestrel the hawk joined her.", entry: { name: "Kestrel", type: "character", aliases: ["the hawk"], notes: "A hunting hawk.", facts: [] } },
  ]);

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const at = (id) => `${BASE}/s/${sid}/review?tab=codex&chapter=${id}`;
  const box = () => page.locator("section.codex-review-box[aria-label='Changes waiting']");
  const go = () => box().locator("a.codex-review-go");
  const goText = async () => (await go().innerText()).replace(/\s+/g, " ").trim();
  const rowanCard = () => page.locator("li.entry-with-extra", { hasText: "Rowan" });
  const crCard = (t) => page.locator("article.cr-card", { hasText: t });
  const settle = async () => {
    await page.locator("details.codex-group").first().waitFor();
    await page.locator("section.codex-review-box").first().waitFor();
  };
  const earlierLinks = async () => (await box().locator("p.meta a").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const entryPage = (id) => page.goto(`${BASE}/s/${sid}/codex/${rowan}?at=${id}`);

  // ---- where the suggestions are shown: at the chapter they were made, the earlier ones linked ----
  await page.goto(at(A));
  await settle();
  ok((await page.locator("article.inbox-card").count()) === 0, "no suggestion cards on the chapter's codex");
  ok((await go().count()) === 1 && (await goText()).includes("2 changes waiting from this chapter") && (await goText()).includes("Review beside the text"), "at Chapter A: a link to review the 2 changes made here: " + (await goText()));
  ok((await go().getAttribute("href")) === `/c/${A}/codex-review`, "…to the chapter's review page");
  const rowanCount = rowanCard().locator("a.entry-review-count");
  ok((await rowanCount.innerText()).trim() === "1 change to review" && (await rowanCount.getAttribute("href")) === `/c/${A}/codex-review?entry=${rowan}`, "…and her card says 1 change to review, linking to the review page for her");
  ok((await box().getByRole("button").count()) === 0 && (await page.locator("li.codex-review-new, a.codex-review-row").count()) === 0, "the box has no Add it / Dismiss or per-entry rows any more");
  ok((await earlierLinks()).join("|") === "“Root” (1)" && (await box().locator("p.meta a").getAttribute("href")) === `/c/${R}/codex-review`, "the root's suggestion is linked as one from an earlier chapter, to its review page: " + (await earlierLinks()).join("|"));
  await page.goto(at(A2));
  await settle();
  ok((await go().count()) === 0, "Chapter A2, after it: nothing made here");
  ok([...(await earlierLinks())].sort().join("|") === "“Chapter A” (2)|“Root” (1)", "…and the earlier chapters' suggestions are linked with their counts: " + (await earlierLinks()).join("|"));
  await page.goto(at(R));
  await settle();
  ok((await go().count()) === 1 && (await goText()).includes("1 change waiting from this chapter") && (await earlierLinks()).length === 0, "at the root: only the root's suggestion");
  await page.goto(at(B));
  await settle();
  ok((await go().count()) === 0 && (await earlierLinks()).join("|") === "“Root” (1)", "on the other branch: only the root's, as an earlier chapter's");

  // ---- accept on the review page, then see it on the chapter's codex ----
  await page.goto(at(A));
  await settle();
  await go().click();
  await page.waitForURL(`${BASE}/c/${A}/codex-review`);
  const hair = crCard("silver hair");
  await hair.waitFor();
  ok((await page.locator("article.cr-card").count()) === 2 && (await crCard("calm").count()) === 0, "the link opens the review page with the changes made here (not the root's)");
  await hair.getByRole("button", { name: "Accept" }).click();
  await page.locator(".cr-done").getByText(/Saved:\s*Rowan/).waitFor();
  await page.goto(at(A));
  await page.locator(".entry-card", { hasText: "Rowan" }).getByText(/silver hair/).waitFor();
  ok((await goText()).includes("1 change waiting") && (await rowanCard().locator("a.entry-review-count").count()) === 0, "accepted: the entry's card shows the new fact and one change (the new entry) still waits");
  const atRoot = (await send("GET", `/api/chapters/${R}/codex`)).entries.find((e) => e.name === "Rowan");
  ok(atRoot.description.includes("dark brown hair") && !atRoot.description.includes("silver"), "…from the chapter it was made at, not above it");

  // dismiss one (the root's, reached from the entry page's link to the earlier chapter)
  await entryPage(A);
  const earlier = page.locator(".entry-waiting");
  await earlier.waitFor();
  ok((await earlier.innerText()).includes("Changes waiting from earlier chapters"), "the entry's page at Chapter A, with nothing left there, links the earlier chapter's");
  await earlier.getByRole("link", { name: "“Root” (1)" }).click();
  await page.waitForURL(new RegExp(`/c/${R}/codex-review\\?entry=${rowan}`));
  const mood = page.locator("article.cr-card", { hasText: "calm" });
  await mood.getByRole("button", { name: "Dismiss" }).click();
  await page.locator(".cr-done", { hasText: "Dismissed" }).waitFor();
  ok(true, "…to the root's review page, where it can be dismissed");

  // after leaving the page, accepted and dismissed ones are gone from the list
  await page.goto(at(A));
  await settle();
  ok((await goText()).includes("1 change waiting") && (await earlierLinks()).length === 0, "back on the chapter's codex, only what is still open is counted");
  await page.getByRole("button", { name: "Show dismissed (1)" }).click();
  ok((await page.locator("ul.inbox-dismissed li", { hasText: "calm" }).getByRole("button", { name: "Reopen" }).count()) === 1, "…and the dismissed one can be found and reopened");

  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await settle(1);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone screen");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
