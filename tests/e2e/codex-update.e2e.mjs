import { launch, useMockAi } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

// "Update from the story" on a codex entry's page: which chapters it says it will read, the run it makes, and what it says
// when there is nothing to read. The queue is paused, so no AI is called (the AI side is in tests/api/update-entry.test.mjs).
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
try {
  // Root -> Growth -> Quiet -> Flight; Quiet doesn't name Mira.
  const story = await post("/api/stories", { title: "Update Tale", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Go on"] } });
  const sid = story.story_id;
  const ids = [story.chapter_id];
  for (const [title, body] of [["Growth", "Mira's ears grew."], ["Quiet", "Nobody spoke."], ["Flight", "Mira ran."]]) {
    const choice = (await send("GET", `/api/chapters/${ids.at(-1)}`)).choices[0];
    ids.push((await post("/api/chapters", { choice_id: choice.id, title, body, choices: title === "Flight" ? [] : ["Go on"] })).chapter_id);
  }
  const [root, , , flight] = ids;
  const mira = (await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).entry_id;
  const zed = (await post("/api/codex", { anchor_chapter_id: flight, op: "create", name: "Zed", type: "character" })).entry_id;
  const entryUrl = (id) => `${BASE}/s/${sid}/codex/${id}?at=${flight}`;

  const context = await browser.newContext();
  await unfoldEntryFolds(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  await send("PUT", "/api/queue/paused", { paused: true });
  const section = page.locator(".entry-section", { has: page.getByRole("heading", { name: "Update from the story", exact: true }) });

  await page.goto(entryUrl(mira));
  await section.waitFor();
  ok((await section.innerText()).includes("2 chapters name Mira since it last changed: “Growth”, “Flight”."), "it says which chapters it will read (not Quiet, which doesn't name her)");
  const queued = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/update-entry`) && r.request().method() === "POST");
  await section.getByRole("button", { name: "Update Mira from the story" }).click();
  const res = await queued;
  const data = await res.json();
  ok(res.status() === 200 && data.tasks === 2 && typeof data.run_id === "string", "the button starts a run of two tasks");
  const run = await send("GET", `/api/ai-runs/${data.run_id}`);
  ok(run.tasks.every((t) => t.kind === "codex" && t.entryId === mira), "…each reading a chapter for Mira");
  await section.getByText("Read “Growth” for Mira").waitFor();
  ok(await section.getByRole("button", { name: "Update Mira from the story" }).count() === 0, "while it runs, its progress shows instead of the button");
  await send("DELETE", `/api/ai-runs/${data.run_id}/queue?end=1`);
  await clearQueue();

  await page.goto(entryUrl(zed));
  await section.waitFor();
  ok((await section.innerText()).includes("No chapter on the way here names Zed since it last changed"), "nothing to read: it says so");
  ok(await section.getByRole("button", { name: /from the story/ }).count() === 0, "…and offers no button");

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(entryUrl(mira));
  await section.waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");
} finally {
  await send("PUT", "/api/queue/paused", { paused: false });
  await clearQueue();
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
