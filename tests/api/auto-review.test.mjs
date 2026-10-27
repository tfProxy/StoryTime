// "Check new and edited chapters automatically" (the autoReview setting): with it on, saving a chapter queues a review
// run for that chapter on the server (facts, summary, ...); off, or for a chapter an AI run wrote, nothing is queued.
import Database from "better-sqlite3";
import { startFakeAi } from "../fakeAi.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(50);
  }
};

let factCalls = 0;
let summaryCalls = 0;
const ai = await startFakeAi({
  port: 3574,
  delay: 5,
  reply: (body) => {
    const sent = JSON.stringify(body);
    if (sent.includes("You list the lasting facts")) {
      factCalls++;
      return JSON.stringify({ facts: [] });
    }
    if (sent.includes("check that the summary of a story chapter matches")) {
      summaryCalls++;
      return '{"ok":true}';
    }
    return "A reply.";
  },
});

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const setAuto = (on) => call("PUT", "/api/settings", { ...(settingsBefore ?? {}), connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }], defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } }, autoReview: on });
let story = null;
try {
  ok((await setAuto(false)).json.settings.autoReview === false, "automatic review is off unless turned on");
  const s = await call("POST", "/api/stories", { title: "Auto review", premise: "P", chapter: { title: "Root", body: "root body", summary: "s", choices: ["Go", "Stay", "Write"] } });
  story = s.json.story_id;
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const runsOf = async () => (await call("GET", `/api/stories/${story}/ai-runs?mode=review`)).json.runs.filter((r) => r.options.checks?.includes("facts") && r.options.tagScope === "chapter");
  const forChapter = async (id) => (await runsOf()).filter((r) => r.start_chapter_id === id);
  const itemOf = async (run) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`);

  // Off: nothing.
  const off = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Off", body: "off body", summary: "o" })).json.chapter_id;
  await sleep(300);
  ok((await forChapter(off)).length === 0, "off: saving a chapter queues no run");

  // On: a new chapter gets a run, which the worker takes to the end.
  await setAuto(true);
  await call("PUT", "/api/queue/paused", { paused: true });
  const created = (await call("POST", "/api/chapters", { choice_id: choices[1].id, title: "On", body: "on body", summary: "o" })).json.chapter_id;
  const first = await until(async () => (await forChapter(created))[0]);
  ok(!!first, "on: saving a new chapter queues a review run for it");
  ok(first.options.checks.join() === "tags,facts,continuity,summaries" && first.mode === "review", "…with all four checks");
  ok(!!(await until(() => itemOf(first.id))), "…which is in the work queue");
  await call("PUT", "/api/queue/paused", { paused: false });
  ok(!!(await until(async () => (await itemOf(first.id))?.state === "done")), "…and the worker finishes it");
  ok(factCalls === 1 && summaryCalls === 1, "…with the fact and summary AI calls");
  await call("DELETE", `/api/queue/items/run:${first.id}`);

  // An edit makes a fresh run; a run still waiting for the old revision is ended.
  await call("PUT", "/api/queue/paused", { paused: true });
  let edit = await call("PATCH", `/api/chapters/${created}`, { title: "On", body: "on body, changed", base_revision: 1, codex_changes: [] });
  ok(edit.status === 200, "a chapter can still be edited");
  const second = await until(async () => (await forChapter(created)).find((r) => r.id !== first.id && r.status !== "stopped" && r.status !== "done"));
  ok(!!second, "an edit queues a fresh run");
  edit = await call("PATCH", `/api/chapters/${created}`, { title: "On", body: "on body, changed twice", base_revision: 2, codex_changes: [] });
  const third = await until(async () => (await forChapter(created)).find((r) => r.id !== first.id && r.id !== second.id && r.status !== "stopped" && r.status !== "done"));
  ok(!!third, "a second edit queues another run…");
  const left = (await forChapter(created)).filter((r) => r.status !== "stopped" && r.status !== "done");
  ok(left.length === 1 && left[0].id === third.id, "…and ends the one still waiting, so runs do not stack");

  // Not for a chapter an AI run wrote.
  const aiRun = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: { checks: ["summaries"] } })).json.id;
  const written = (await call("POST", "/api/chapters", { choice_id: choices[2].id, title: "By AI", body: "ai body", summary: "a", ai_run_id: aiRun }));
  if (written.status === 201) {
    await sleep(300);
    ok((await forChapter(written.json.chapter_id)).length === 0, "a chapter an AI run wrote queues no run");
    await call("PATCH", `/api/chapters/${written.json.chapter_id}`, { title: "By AI", body: "ai body, edited", base_revision: 1, codex_changes: [] });
    await sleep(300);
    ok((await forChapter(written.json.chapter_id)).length === 0, "…nor does editing it while its run is going");
    await call("DELETE", `/api/ai-runs/${aiRun}/queue?end=1`);
    await call("PATCH", `/api/chapters/${written.json.chapter_id}`, { title: "By AI", body: "ai body, edited again", base_revision: 2, codex_changes: [] });
    ok(!!(await until(async () => (await forChapter(written.json.chapter_id)).length > 0)), "once the run has ended, editing it by hand queues a run");
  } else ok(false, `could not post the AI-run chapter (${written.status})`);
  await call("DELETE", `/api/ai-runs/${aiRun}/queue?end=1`);

  // Off again: nothing new.
  await setAuto(false);
  const before = (await runsOf()).length;
  await call("PATCH", `/api/chapters/${off}`, { title: "Off", body: "off body, changed", base_revision: 1, codex_changes: [] });
  await sleep(300);
  ok((await runsOf()).length === before, "off again: an edit queues no run");

  for (const r of await runsOf()) await call("DELETE", `/api/ai-runs/${r.id}/queue?end=1`);
} finally {
  await call("PUT", "/api/queue/paused", { paused: false });
  if (story) await call("DELETE", `/api/stories/${story}`);
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
