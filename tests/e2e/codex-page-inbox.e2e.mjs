import { launch, useMockAi } from "./browser.mjs";

// The codex inbox on a chapter's codex page: the suggestions that apply there (made at the chapter or one before it on the
// branch) are shown as cards, to accept or dismiss in place. Seeded through the suggestions route, so no AI is involved.
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
  const section = page.locator(".codex-inbox");
  const cards = () => section.locator("article.inbox-card");

  // ---- where the suggestions apply ----
  await page.goto(`${BASE}/c/${A}/codex`);
  await section.getByRole("heading", { name: "Waiting in the codex inbox" }).waitFor();
  ok((await cards().count()) === 3, "at Chapter A: its two suggestions and the root's one: " + (await cards().count()));
  ok((await section.getByText("New entry").count()) >= 1 && (await section.getByText("Kestrel").count()) >= 1, "a proposed new entry is among them");
  await page.goto(`${BASE}/c/${A2}/codex`);
  await section.getByRole("heading", { name: "Waiting in the codex inbox" }).waitFor();
  ok((await cards().count()) === 3, "a chapter after it shows them too (they apply there): " + (await cards().count()));
  await page.goto(`${BASE}/c/${R}/codex`);
  await section.getByRole("heading", { name: "Waiting in the codex inbox" }).waitFor();
  ok((await cards().count()) === 1, "at the root: only the root's suggestion: " + (await cards().count()));
  await page.goto(`${BASE}/c/${B}/codex`);
  await page.getByRole("heading", { name: "Codex", level: 1 }).waitFor();
  await page.waitForTimeout(500);
  ok((await page.locator(".codex-inbox").count()) === 1 && (await cards().count()) === 1, "on the other branch: the root's only: " + (await cards().count()));

  // ---- accept in place: the entry list changes, the card stays (collapsed) until the page is left ----
  await page.goto(`${BASE}/c/${A}/codex`);
  await section.getByRole("heading", { name: "Waiting in the codex inbox" }).waitFor();
  const hair = section.locator("article.inbox-card", { hasText: "silver hair" });
  await hair.getByRole("button", { name: "Accept" }).first().click();
  await page.locator(".entry-card", { hasText: "Rowan" }).getByText(/silver hair/).waitFor();
  ok(true, "accepting a suggestion here updates the codex list at once");
  const atRoot = (await send("GET", `/api/chapters/${R}/codex`)).entries.find((e) => e.name === "Rowan");
  ok(atRoot.description.includes("dark brown hair") && !atRoot.description.includes("silver"), "…from the chapter it was made at, not above it");

  // dismiss one
  const mood = section.locator("article.inbox-card", { hasText: "calm" });
  await mood.getByRole("button", { name: "Dismiss" }).click();
  await section.getByRole("button", { name: "Undo" }).first().waitFor();
  ok(true, "a suggestion can be dismissed here too (it stays as a line with Undo until the page is left)");

  // after leaving the page, accepted and dismissed ones are gone from the list
  await page.goto(`${BASE}/c/${A}/codex`);
  await section.getByRole("heading", { name: "Waiting in the codex inbox" }).waitFor();
  ok((await cards().count()) === 1, "back on the page, only what is still open is listed: " + (await cards().count()));

  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await section.getByRole("heading", { name: "Waiting in the codex inbox" }).waitFor();
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
