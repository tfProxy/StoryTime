// A review run with checks ["summaries"]: each chapter that has a summary is checked by the (fake) AI, once; a second
// run asks nothing; a chapter without a summary is left out.
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

// The summary of "Root" is fine; the summary of "Child" is not.
let calls = 0;
const ai = await startFakeAi({
  port: 3572,
  delay: 5,
  reply: (body) => {
    if (!JSON.stringify(body).includes("check that the summary of a story chapter matches")) return "A reply.";
    calls++;
    const sent = body.messages?.at(-1)?.content ?? "";
    return /Chapter: "Root"/.test(sent) ? '{"ok":true}' : '{"ok":false,"problem":"Leaves out the storm."}';
  },
});

const itemOf = async (run) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`);
const runOf = async (run) => (await call("GET", `/api/ai-runs/${run}`)).json;
const finish = async (run) => {
  await call("POST", `/api/ai-runs/${run}/queue`);
  return !!(await until(async () => (await itemOf(run))?.state === "done"));
};
const newRun = async (story, start, options) => (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: start, mode: "review", options })).json.id;

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const runs = [];
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    // No automatic codex check: it would add runs and AI calls this file counts.
    autoCodex: false,
  });

  const s = await call("POST", "/api/stories", { title: "Summary run", premise: "P", chapter: { title: "Root", body: "The sun came up.", summary: "The sun rises.", choices: ["Go", "Stay"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const child = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Child", body: "A storm broke over the farm.", summary: "A quiet day." })).json.chapter_id;
  await call("POST", "/api/chapters", { choice_id: choices[1].id, title: "Bare", body: "No summary here." });
  const wrongs = async () => (await call("GET", `/api/stories/${story}/review`)).json.issues.filter((i) => i.kind === "summary-wrong");

  let id = await newRun(story, null, { checks: ["summaries"] });
  runs.push(id);
  let run = await runOf(id);
  ok(run.tasks.length === 2 && run.tasks.every((t) => t.kind === "summary" && t.status === "todo"), "the run has a summary task for each chapter with a summary, and none for the one without");
  ok(run.tasks[0].chapterId === root && run.tasks[0].revision === 1 && run.tasks[1].chapterId === child, "…in story order, with the revision");

  const one = await newRun(story, root, { tagScope: "chapter", checks: ["summaries"] });
  runs.push(one);
  ok((await runOf(one)).tasks.length === 1, "a run for one chapter has one task");
  await call("DELETE", `/api/ai-runs/${one}/queue?end=1`);

  ok(await finish(id), "the worker takes the run to the end");
  run = await runOf(id);
  ok(run.status === "done" && run.tasks.every((t) => t.status === "done"), "…every task is done");
  ok(calls === 2, "…with one AI call for each summary");
  ok(run.tasks[0].found === 0 && run.tasks[1].found === 1, "…the task of the wrong summary counts one");
  const found = await wrongs();
  ok(found.length === 1 && found[0].chapterId === child && found[0].message === "The summary doesn't match the chapter: Leaves out the storm.", "…and it shows on the Review page as an issue on that chapter");

  // A second run has nothing to check.
  id = await newRun(story, null, { checks: ["summaries"] });
  runs.push(id);
  ok((await runOf(id)).tasks.length === 0, "a second run has no tasks");

  // Fixing the summary makes the chapter due for a check again.
  await call("PUT", `/api/chapters/${child}/summary`, { revision: 1, summary: "A storm breaks over the farm.", path_summary: "p" });
  ok((await wrongs()).length === 0, "a fixed summary clears the issue");
  id = await newRun(story, null, { checks: ["summaries"] });
  runs.push(id);
  run = await runOf(id);
  ok(run.tasks.length === 1 && run.tasks[0].chapterId === child, "…and the next run checks that chapter again");

  // A task whose chapter was edited after the run was made is skipped, without a call.
  await call("PATCH", `/api/chapters/${child}`, { base_revision: 1, title: "Child", body: "A storm broke over the farm, again.", summary: "A storm breaks over the farm." });
  const before = calls;
  ok(await finish(id), "a run made before an edit ends");
  run = await runOf(id);
  ok(run.tasks[0].status === "skipped" && calls === before, "…its task is skipped and the AI isn't asked");
} finally {
  for (const id of runs) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  await call("PUT", "/api/queue/paused", { paused: false });
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
