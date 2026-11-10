import { launch, useMockAi } from "./browser.mjs";

// The suggestions on a chapter's codex (the Story Bible's Codex section narrowed to the chapter): the "To review" box lists
// the ones made at the chapter, a row per entry that leads to the entry's page at the chapter, where they are accepted or
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
  const box = () => page.locator("section.codex-review-box[aria-label='To review']");
  const rows = () => box().locator("a.codex-review-row");
  const newEntries = () => box().locator("li.codex-review-new");
  const rowanCard = () => page.locator("li.entry-with-extra", { hasText: "Rowan" });
  const settle = async () => {
    await page.locator("details.codex-group").first().waitFor();
    await page.locator("section.codex-review-box").first().waitFor();
  };
  const earlierLinks = async () => (await box().locator("p.meta a").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const fold = () => page.locator("details#entry-review");
  const entryPage = (id) => page.goto(`${BASE}/s/${sid}/codex/${rowan}?at=${id}`);

  // ---- where the suggestions are shown: at the chapter they were made, the earlier ones linked ----
  await page.goto(at(A));
  await settle();
  ok((await page.locator("article.inbox-card").count()) === 0, "no suggestion cards on the chapter's codex");
  ok((await rows().count()) === 1 && (await rows().first().locator(".codex-review-count").innerText()).trim() === "1", "at Chapter A: one row for Rowan, with her one suggestion made here");
  ok((await rowanCard().locator(".entry-review-count").innerText()).trim() === "1 to review", "…and her card says 1 to review");
  ok((await newEntries().count()) === 1 && (await newEntries().getByText("Kestrel", { exact: true }).count()) === 1 && (await newEntries().innerText()).includes("New character:"), "a proposed new entry is a row with Add it / Dismiss");
  ok((await earlierLinks()).join("|") === "“Root” (1)", "the root's suggestion is linked as one from an earlier chapter: " + (await earlierLinks()).join("|"));
  await page.goto(at(A2));
  await settle();
  ok((await rows().count()) === 0 && (await box().getByText("nothing waiting").isVisible()), "Chapter A2, after it: nothing made here");
  ok([...(await earlierLinks())].sort().join("|") === "“Chapter A” (2)|“Root” (1)", "…and the earlier chapters' suggestions are linked with their counts: " + (await earlierLinks()).join("|"));
  await page.goto(at(R));
  await settle();
  ok((await rows().count()) === 1 && (await newEntries().count()) === 0 && (await earlierLinks()).length === 0, "at the root: only the root's suggestion");
  await page.goto(at(B));
  await settle();
  ok((await rows().count()) === 0 && (await earlierLinks()).join("|") === "“Root” (1)", "on the other branch: only the root's, as an earlier chapter's");

  // ---- accept on the entry's page, then see it on the chapter's codex ----
  await page.goto(at(A));
  await settle();
  await rows().first().click();
  await page.waitForURL(new RegExp(`/codex/${rowan}\\?at=${A}`));
  const hair = fold().locator("article.inbox-card", { hasText: "silver hair" });
  await hair.waitFor();
  ok((await fold().locator("article.inbox-card").count()) === 1, "the row opens her page at this chapter, with the suggestion made here (not the root's)");
  await hair.getByRole("button", { name: "Accept" }).click();
  await fold().getByText(/Saved:\s*Rowan, Hair/).waitFor({ state: "attached" });
  await page.goto(at(A));
  await page.locator(".entry-card", { hasText: "Rowan" }).getByText(/silver hair/).waitFor();
  ok((await rows().count()) === 0 && (await newEntries().count()) === 1, "accepted: the entry's card shows the new fact and the row is gone");
  const atRoot = (await send("GET", `/api/chapters/${R}/codex`)).entries.find((e) => e.name === "Rowan");
  ok(atRoot.description.includes("dark brown hair") && !atRoot.description.includes("silver"), "…from the chapter it was made at, not above it");

  // dismiss one (the root's, reached from the earlier-chapters link)
  await entryPage(A);
  await fold().getByRole("link", { name: "“Root” (1)" }).click();
  await page.waitForURL(new RegExp(`/codex/${rowan}\\?at=${R}`));
  const mood = fold().locator("article.inbox-card", { hasText: "calm" });
  await mood.getByRole("button", { name: "Dismiss" }).click();
  await fold().locator("button", { hasText: "Undo" }).waitFor({ state: "attached" }); // (the fold closes with nothing left open)
  ok(true, "a suggestion can be dismissed (it stays as a line with Undo until the page is left)");

  // after leaving the page, accepted and dismissed ones are gone from the list
  await page.goto(at(A));
  await settle();
  ok((await rows().count()) === 0 && (await newEntries().count()) === 1 && (await earlierLinks()).length === 0, "back on the chapter's codex, only what is still open is listed");
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
