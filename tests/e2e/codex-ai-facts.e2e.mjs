import { launch, useMockAi } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

// "Apply the AI's codex changes automatically": facts the AI applied are marked AI on the entry's card, the reading
// page's banner and the entry's page (an amber marker each, linking to its card on the chapter's review page, where it is
// approved or undone); and the setting in Settings.
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
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan's ears changed. Her eyes glowed amber. Her hair was russet." })).chapter_id;
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
      { kind: "set", entry_id: rowan, aspect: "Hair", after: "russet hair", quote: "Her hair was russet" },
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

  // ---- the entry's page marks them, each linking to where it is approved or undone ----
  await page.goto(`${BASE}/s/${sid}/codex/${rowan}?at=${A}`);
  const ed = page.locator(".entry-editor");
  const row = (t) => ed.locator(".entry-facts .fact-row").filter({ has: page.locator(".fact-line", { hasText: t }) });
  const opOf = async (aspect) => (await send("GET", `/api/chapters/${A}/codex`)).entries.find((e) => e.name === "Rowan").facts.find((f) => f.aspect === aspect).op.id;
  await row("tall fox ears").waitFor();
  const earsMark = row("tall fox ears").locator(".ef-marker-ai");
  ok((await earsMark.innerText()).includes("Added by the AI from “Chapter A” · Approve or undo") && (await row("amber eyes").locator(".ef-marker-ai").count()) === 1, "each AI fact has an amber marker");
  ok((await earsMark.getAttribute("href")) === `/c/${A}/codex-review?entry=${rowan}#f-${await opOf("Ears")}`, "…linking to its card on the review page");
  ok((await ed.locator(".ef-form-row .ef-marker-ai").getAttribute("href")) === `/c/${A}/codex-review?entry=${rowan}#f-${await opOf("form")}`, "the AI's form change is marked too");
  ok((await ed.locator(".entry-waiting").innerText()).includes("4 changes waiting from “Chapter A”"), "the changes line counts them");
  ok((await ed.locator(".ai-facts-note, .notice", { hasText: "The AI wrote" }).count()) === 0 && (await ed.locator(".entry-facts").getByRole("button", { name: /^Approve/ }).count()) === 0, "no AI-facts notice and no Approve buttons on the page");
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/codex-ai-facts.png`, fullPage: true }).catch(() => {});

  // Approved or undone on the review page (here, through its routes): the marker goes; an undone fact goes too.
  await post("/api/codex/approve", { ids: [await opOf("Ears")] });
  await post("/api/codex/undo-ai", { ids: [await opOf("Eyes")] });
  await page.reload();
  await row("tall fox ears").waitFor();
  ok((await row("tall fox ears").locator(".ef-marker-ai").count()) === 0 && (await row("amber eyes").count()) === 0, "an approved fact loses its marker, an undone one is gone");
  ok((await ed.locator(".entry-waiting").innerText()).includes("2 changes waiting"), "…and the count goes down");
  await post("/api/codex/approve", { ids: [await opOf("Hair"), await opOf("form")] });
  await page.reload();
  await row("tall fox ears").waitFor();
  ok((await ed.locator(".ef-marker-ai").count()) === 0 && (await ed.locator(".entry-waiting").count()) === 0, "with all approved, no markers and no changes line");
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
