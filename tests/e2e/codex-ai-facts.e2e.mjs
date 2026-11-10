import { launch, useMockAi } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

// "Apply the AI's codex changes automatically": facts the AI applied are marked AI on the entry's card, the reading
// page's banner and the entry's page, where Approve (one, or all) takes the mark off; and the setting in Settings.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE); // no automatic codex check: the reading below is posted by hand
const browser = await launch();
try {
  const story = await post("/api/stories", { title: "AI Facts Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["Go"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${R}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan's ears changed. Her eyes glowed amber." })).chapter_id;
  const rowan = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Rowan", type: "character" })).entry_id;
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: rowan, op: "set", aspect: "Ears", form: "", text: "round human ears" });
  await post("/api/codex/facts", { anchor_chapter_id: R, entry_id: rowan, op: "set", aspect: "form", form: "human", text: "" });

  // The reading the server's codex check would save, with the setting on.
  const settings = (await send("GET", "/api/settings")).settings;
  await send("PUT", "/api/settings", { ...settings, autoCodex: true, autoApplyCodex: true });
  const saved = await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: 1,
    suggestions: [
      { kind: "set", entry_id: rowan, aspect: "Ears", after: "tall fox ears", quote: "Rowan's ears changed" },
      { kind: "set", entry_id: rowan, aspect: "Eyes", after: "amber eyes", quote: "Her eyes glowed amber" },
      { kind: "form", entry_id: rowan, form: "vixen", after: "", quote: "Rowan's ears changed" },
      { kind: "set", entry_id: rowan, aspect: "Hair", after: "russet hair", quote: "Rowan's ears changed" },
    ],
  });
  await send("PUT", "/api/settings", { ...settings, autoCodex: false, autoApplyCodex: true });
  ok(saved.applied === 4, "the reading is applied: " + JSON.stringify(saved));

  const context = await browser.newContext();
  await unfoldEntryFolds(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  // ---- the reading page and the Story Bible say so ----
  await page.goto(`${BASE}/c/${A}`);
  const banner = page.getByText(/Codex: the AI updated 4 facts from this chapter/);
  await banner.waitFor();
  ok(await banner.isVisible(), "the reading page says the AI updated the codex");
  await page.goto(`${BASE}/s/${sid}/review?tab=codex&chapter=${A}`);
  const card = page.locator(".entry-card", { hasText: "Rowan" });
  await card.waitFor();
  ok((await card.innerText()).includes("4 AI facts to check"), "the card counts the AI facts");

  // ---- the entry's page marks them, and Approve takes the mark off ----
  await page.goto(`${BASE}/s/${sid}/codex/${rowan}?at=${A}`);
  const ed = page.locator(".entry-editor");
  const row = (t) => ed.locator(".fact-row").filter({ has: page.locator(".fact-line", { hasText: t }) });
  await row("tall fox ears").waitFor();
  ok((await row("tall fox ears").locator(".ai-badge").count()) === 1 && (await row("amber eyes").locator(".ai-badge").count()) === 1, "each AI fact is marked AI");
  ok((await row("tall fox ears").innerText()).includes("“Rowan's ears changed”"), "…with the quote it came from");
  ok((await ed.locator(".facts-form .ai-badge").count()) === 1, "the AI's form change is marked too");
  const note = ed.locator(".ai-facts-note");
  ok((await note.innerText()).includes("The AI wrote 4 facts from the story"), "the Facts section says how many wait");
  ok((await note.getByRole("link", { name: "“Chapter A”" }).getAttribute("href")) === `/s/${sid}/codex/${rowan}?at=${A}#entry-review`, "…and where to approve or undo them: the review fold at the chapter");
  ok((await ed.locator(".facts").getByRole("button", { name: /^Approve/ }).count()) === 0 && (await ed.locator(".facts-form").getByRole("button", { name: /^Approve/ }).count()) === 0, "the facts list has no Approve buttons of its own");

  // ---- the review fold holds them: Approve or Undo ----
  const fold = ed.locator("details#entry-review");
  const applied = fold.locator(".codex-review-applied");
  ok((await fold.locator("summary").first().innerText()).includes("Review changes from “Chapter A”") && (await fold.locator("summary").first().innerText()).includes("4 waiting"), "the review fold counts the AI facts as waiting");
  ok(await applied.getByRole("heading", { name: "Already applied by the AI" }).isVisible() && (await applied.locator("article.inbox-card").count()) === 4, "…under 'Already applied by the AI', one card each");
  const cardOf = (t) => applied.locator("article.inbox-card", { hasText: t });
  ok((await cardOf("tall fox ears").getByRole("button", { name: "Approve", exact: true }).isVisible()) && (await cardOf("tall fox ears").getByRole("button", { name: "Undo", exact: true }).isVisible()), "each has Approve and Undo");
  ok((await cardOf("tall fox ears").locator("blockquote.inbox-evidence").innerText()).includes("Rowan's ears changed"), "…and the quote it came from");
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/codex-ai-facts.png`, fullPage: true }).catch(() => {});

  // Approve one: the mark goes off its row, the card leaves the fold.
  await cardOf("tall fox ears").getByRole("button", { name: "Approve", exact: true }).click();
  await row("tall fox ears").locator(".ai-badge").waitFor({ state: "detached" });
  ok((await applied.locator("article.inbox-card").count()) === 3 && (await ed.locator(".ai-facts-note").innerText()).includes("The AI wrote 3 facts"), "Approve takes the mark off the fact and the card out of the fold");
  ok(await row("tall fox ears").isVisible(), "…the fact stays");

  // Undo one: the fact goes and its suggestion is dismissed.
  const dismissedBefore = (await send("GET", `/api/stories/${sid}/codex-suggestions?status=dismissed`)).suggestions.length;
  await cardOf("amber eyes").getByRole("button", { name: "Undo", exact: true }).click();
  await row("amber eyes").waitFor({ state: "detached" });
  ok((await applied.locator("article.inbox-card").count()) === 2, "Undo takes the card out of the fold");
  ok((await row("amber eyes").count()) === 0, "…and the fact off the entry");
  const afterUndo = (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Rowan");
  ok(!afterUndo.facts.some((f) => f.aspect === "Eyes") && afterUndo.facts.some((f) => f.aspect === "Ears" && f.text === "tall fox ears"), "…on the server too, and the others stay");
  const dismissed = (await send("GET", `/api/stories/${sid}/codex-suggestions?status=dismissed`)).suggestions;
  ok(dismissed.length === dismissedBefore + 1 && dismissed.some((x) => x.aspect === "Eyes" && x.after === "amber eyes"), "the suggestion behind it is dismissed");
  await page.reload(); // (the fold reads its list again when the page is opened)
  await fold.getByRole("button", { name: /^Show dismissed \(1\)$/ }).click();
  ok(await fold.locator("ul.inbox-dismissed li", { hasText: "Eyes" }).getByRole("button", { name: "Reopen" }).isVisible(), "…and can be reopened from the fold's dismissed list");

  // Approve all.
  await applied.getByRole("button", { name: "Approve all 2" }).click();
  await ed.locator(".ai-badge").first().waitFor({ state: "detached" });
  ok((await ed.locator(".ai-badge").count()) === 0 && (await ed.getByText(/The AI wrote/).count()) === 0, "Approve all approves the rest");
  const entry = (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Rowan");
  ok(entry.facts.every((f) => !f.op.ai_suggestion_id), "…on the server too");

  // ---- the setting ----
  await page.goto(`${BASE}/settings#codex`);
  const box = page.getByRole("checkbox", { name: /Apply the AI's codex changes automatically/ });
  await box.waitFor();
  ok(await box.isDisabled(), "the setting waits for the codex check to be on");
  await page.getByRole("checkbox", { name: /Suggest codex changes after a chapter is saved/ }).check();
  await page.waitForFunction(async () => (await (await fetch("/api/settings")).json()).settings.autoCodex === true);
  ok((await box.isEnabled()) && (await box.isChecked()), "with the check on, it shows the saved value");
  await box.uncheck();
  await page.waitForFunction(async () => (await (await fetch("/api/settings")).json()).settings.autoApplyCodex === false);
  ok(!(await send("GET", "/api/settings")).settings.autoApplyCodex, "turning it off is saved");

  await context.close();
  await send("DELETE", `/api/stories/${sid}`);
} finally {
  await browser.close();
  await ai.restore();
}
if (failed) process.exit(1);
