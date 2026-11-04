import { launch, useMockAi } from "./browser.mjs";

// The suggestions on a chapter's codex (the Story Bible's Codex section narrowed to the chapter): the ones that apply there
// (made at the chapter or one before it on the branch) sit inside the card of the entry they are about, to accept or dismiss
// in place. Seeded through the suggestions route, so no AI is involved.
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
  const cards = () => page.locator(".codex-bible article.inbox-card");
  const newEntries = () => page.locator(".codex-bible li.codex-suggested");
  const rowanCard = () => page.locator("li.entry-with-extra", { hasText: "Rowan" });
  const settle = async (n) => {
    await page.locator("details.codex-group").first().waitFor();
    await page.waitForFunction((count) => document.querySelectorAll(".codex-bible article.inbox-card, .codex-bible li.codex-suggested").length === count, n);
  };

  // ---- where the suggestions apply ----
  await page.goto(at(A));
  await settle(3);
  ok((await cards().count()) === 2 && (await rowanCard().locator("article.inbox-card").count()) === 2, "at Chapter A: Rowan's card holds its own suggestion and the root's");
  ok((await newEntries().count()) === 1 && (await newEntries().getByText("Kestrel", { exact: true }).count()) === 1, "a proposed new entry is a dashed card among them");
  await page.goto(at(A2));
  await settle(3);
  ok((await cards().count()) === 2, "a chapter after it shows them too (they apply there)");
  await page.goto(at(R));
  await settle(1);
  ok((await cards().count()) === 1 && (await newEntries().count()) === 0, "at the root: only the root's suggestion");
  await page.goto(at(B));
  await settle(1);
  ok((await cards().count()) === 1, "on the other branch: the root's only");

  // ---- accept in place: the card shows the new fact, the suggestion stays (collapsed) until the page is left ----
  await page.goto(at(A));
  await settle(3);
  const hair = cards().filter({ hasText: "silver hair" });
  await hair.getByRole("button", { name: "Accept" }).first().click();
  await page.locator(".entry-card", { hasText: "Rowan" }).getByText(/silver hair/).waitFor();
  ok(true, "accepting a suggestion here updates the entry's card at once");
  const atRoot = (await send("GET", `/api/chapters/${R}/codex`)).entries.find((e) => e.name === "Rowan");
  ok(atRoot.description.includes("dark brown hair") && !atRoot.description.includes("silver"), "…from the chapter it was made at, not above it");

  // dismiss one
  const mood = cards().filter({ hasText: "calm" });
  await mood.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: "Undo" }).first().waitFor();
  ok(true, "a suggestion can be dismissed here too (it stays as a line with Undo until the page is left)");

  // after leaving the page, accepted and dismissed ones are gone from the list
  await page.goto(at(A));
  await settle(1);
  ok((await cards().count()) === 0 && (await newEntries().count()) === 1, "back on the page, only what is still open is listed");
  ok((await page.getByText("Dismissed suggestions (1)").count()) === 1, "…and the dismissed one can be found and reopened");

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
