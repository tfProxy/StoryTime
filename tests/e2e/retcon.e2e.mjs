import { launch, useMockAi } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

// Retcons in the Story Bible: a codex fact's "Retcon…" opens the start form (what it reads, where it stops), Start makes
// the codex change and a run; the run's proposals (posted here as the run would, so no AI is needed; the AI side is in
// tests/api/retcons.test.mjs) show as diffs to Accept or Skip; then Undo. Also the chapter menu's "Retcon from here…".
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);
const clearQueue = async () => {
  for (const item of (await send("GET", "/api/queue")).items ?? []) await fetch(`${BASE}/api/queue/items/${item.key}`, { method: "DELETE" });
};

const ai = await useMockAi(BASE);
const browser = await launch();
const runs = [];
try {
  const story = await post("/api/stories", { title: "Retcon Tale", premise: "p", chapter: { title: "Root", body: "Mira had gray eyes.", choices: ["Go on"] } });
  const sid = story.story_id;
  const root = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${root}`)).choices[0];
  const next = (await post("/api/chapters", { choice_id: choice.id, title: "Rain", body: "Her gray eyes caught the rain. Oda smiled at Mira.", choices: [] })).chapter_id;
  const mira = (await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).entry_id;
  const eyes = (await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: mira, op: "set", aspect: "Eyes", text: "Gray." })).fact_id;

  const context = await browser.newContext();
  await unfoldEntryFolds(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  await send("PUT", "/api/queue/paused", { paused: true });

  // ---- the fact's Retcon… opens the form ----
  await page.goto(`${BASE}/s/${sid}/codex/${mira}?at=${next}`);
  await page.getByRole("link", { name: "Retcon Eyes" }).click();
  const form = page.getByRole("region", { name: "Start a retcon" });
  await form.waitFor();
  ok((await form.getByRole("heading").innerText()) === "Retcon Mira: Eyes", "the form names the entry and the fact");
  await form.getByText("The AI reads 2 chapters").waitFor();
  ok((await form.innerText()).includes("from “Root” on: “Root”, “Rain”."), "it says what it will read, from where it was set");
  ok(await form.getByRole("button", { name: "Start the retcon" }).isDisabled(), "Start waits for a new text");
  await form.getByLabel("Change it to").fill("Blue.");
  const started = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/retcons`) && r.request().method() === "POST");
  await form.getByRole("button", { name: "Start the retcon" }).click();
  const data = await (await started).json();
  runs.push(data.run_id);
  ok(data.reads === 2 && !!data.run_id, "Start makes a run of two chapters");
  const card = page.getByRole("article", { name: "Retcon Mira: Eyes" });
  await card.waitFor();
  ok(await page.getByRole("region", { name: "Start a retcon" }).count() === 0, "the list shows instead of the form");

  // ---- the run's proposals (as the run would post them) ----
  await send("DELETE", `/api/ai-runs/${data.run_id}/queue?end=1`);
  await clearQueue();
  await post(`/api/retcons/${data.id}/proposals`, { chapter_id: next, revision: 1, edits: [{ old: "Her gray eyes caught the rain.", new: "Her blue eyes caught the rain." }], note: "" });
  await post(`/api/retcons/${data.id}/proposals`, { chapter_id: root, revision: 1, edits: [{ old: "Mira had gray eyes.", new: "Mira had blue eyes." }], note: "" });
  await page.reload();
  await card.waitFor();
  const rain = card.locator(".retcon-change", { has: page.getByRole("link", { name: "Rain" }) });
  ok((await rain.locator("del").innerText()).includes("gray") && (await rain.locator("ins").innerText()).includes("blue"), "the change shows as a diff");
  await rain.getByRole("button", { name: "Reword" }).click();
  await rain.getByLabel("New text").fill("Her sky-blue eyes caught the rain.");
  await rain.getByRole("button", { name: "Accept" }).click();
  await rain.getByText("Changed").waitFor();
  ok((await send("GET", `/api/chapters/${next}`)).chapter.body === "Her sky-blue eyes caught the rain. Oda smiled at Mira.","Accept saves the reworded passage in the chapter");
  const rootCard = card.locator(".retcon-change", { has: page.getByRole("link", { name: "Root" }) });
  await rootCard.getByRole("button", { name: "Skip" }).click();
  await rootCard.getByText("Left as it was").waitFor();
  ok((await send("GET", `/api/chapters/${root}`)).chapter.body === "Mira had gray eyes.", "Skip leaves the chapter alone");

  // ---- undo ----
  page.once("dialog", (d) => void d.accept());
  await card.getByRole("button", { name: "Undo this retcon" }).click();
  await card.getByText("Undone. 1 chapter put back.").waitFor();
  ok((await send("GET", `/api/chapters/${next}`)).chapter.body === "Her gray eyes caught the rain. Oda smiled at Mira.", "Undo puts the chapter back");
  const fact = (await send("GET", `/api/chapters/${next}/codex`)).entries.find((e) => e.entry_id === mira).facts.find((f) => f.fact_id === eyes);
  ok(fact.text === "Gray.", "…and the codex fact");

  // ---- the chapter menu's Retcon from here… ----
  await page.goto(`${BASE}/c/${next}`);
  await page.getByLabel("More chapter actions", { exact: true }).first().click();
  await page.getByRole("link", { name: "Retcon from here…" }).click();
  const words = page.getByRole("region", { name: "Start a retcon" });
  await words.waitFor();
  ok((await words.getByRole("heading").innerText()) === "Retcon from “Rain”", "it opens the retcon in words for that chapter");
  await words.getByLabel("What is different now").fill("Oda never smiles.");
  await words.getByText("The AI reads 1 chapter").waitFor();
  ok(!(await words.getByRole("button", { name: "Start the retcon" }).isDisabled()), "with a change written, it can start");

  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  await words.waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");
} finally {
  for (const id of runs) await send("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  await send("PUT", "/api/queue/paused", { paused: false });
  await clearQueue();
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
