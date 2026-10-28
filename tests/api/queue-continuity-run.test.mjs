// A review run with checks ["facts", "continuity"]: the facts of each chapter are read, then the clashes between
// chapters are judged by the (fake) AI, once each; a second run asks nothing, and a change-event tag excuses a change.
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

// Each chapter states its eye colour in its own words; the judge calls the clash a contradiction.
let factCalls = 0;
let judgeCalls = 0;
let verdict = "contradiction";
const ai = await startFakeAi({
  port: 3571,
  delay: 5,
  reply: (body) => {
    const sent = body.messages?.at(-1)?.content ?? "";
    if (JSON.stringify(body).includes("You list the lasting facts")) {
      factCalls++;
      const colour = /Chapter to read: "([^"]+)"/.exec(sent)?.[1] === "Root" ? "green" : "blue";
      return JSON.stringify({ facts: [{ entity: "Mira", attribute: "eye colour", value: colour, quote: `Mira has ${colour} eyes.` }] });
    }
    if (JSON.stringify(body).includes("continuity mistakes")) {
      judgeCalls++;
      return JSON.stringify({ verdict });
    }
    return "A reply.";
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
let tagId = null;
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    // No automatic codex check: it would add runs and AI calls this file counts.
    autoCodex: false,
  });

  const s = await call("POST", "/api/stories", { title: "Continuity run", premise: "P", chapter: { title: "Root", body: "Mira has green eyes. The rest of the root.", summary: "s", choices: ["Go", "Stay"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const child = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Child", body: "Mira has blue eyes. The rest of the child.", summary: "c" })).json.chapter_id;
  const verdicts = async () => (await call("GET", `/api/stories/${story}/continuity`)).json.verdicts;
  const issues = async () => (await call("GET", `/api/stories/${story}/review`)).json.issues.filter((i) => i.kind === "continuity");

  // The tasks: facts for each chapter, then one continuity task naming the chapters at the ends.
  let id = await newRun(story, null, { checks: ["facts", "continuity"] });
  runs.push(id);
  let run = await runOf(id);
  ok(run.tasks.length === 3 && run.tasks[0].kind === "facts" && run.tasks[1].kind === "facts" && run.tasks[2].kind === "continuity", "the run has the facts tasks, then one continuity task");
  ok(JSON.stringify(run.tasks[2].chapterIds) === JSON.stringify([child]), "…which names only the chapter with no child in the scope");
  const rootOnly = await newRun(story, root, { tagScope: "chapter", checks: ["continuity"] });
  runs.push(rootOnly);
  ok(JSON.stringify((await runOf(rootOnly)).tasks[0].chapterIds) === JSON.stringify([root]), "a run for one chapter checks that chapter");
  await call("DELETE", `/api/ai-runs/${rootOnly}/queue?end=1`);

  ok(await finish(id), "the worker takes the run to the end");
  run = await runOf(id);
  ok(run.status === "done" && run.tasks.every((t) => t.status === "done"), "…every task is done");
  ok(factCalls === 2 && judgeCalls === 1, "…with one fact call per chapter and one judge call for the clash");
  ok(run.tasks[2].found === 1, "…the continuity task counts one contradiction");
  let list = await verdicts();
  ok(list.length === 1 && list[0].verdict === "contradiction" && list[0].before.chapterId === root && list[0].after.chapterId === child, "…the verdict is stored with the chapters in order");
  ok(list[0].before.revision === 1 && list[0].after.revision === 1 && list[0].before.quote === "Mira has green eyes.", "…with their revisions and quotes");
  const found = await issues();
  ok(found.length === 1 && found[0].chapterId === child && found[0].continuity.before.value === "green", "…and it shows on the Review page as an issue on the later chapter");

  // A second run reads nothing and asks nothing.
  id = await newRun(story, null, { checks: ["facts", "continuity"] });
  runs.push(id);
  run = await runOf(id);
  ok(run.tasks.length === 1 && run.tasks[0].kind === "continuity", "a second run has only the continuity task");
  ok(await finish(id), "…it ends");
  ok(factCalls === 2 && judgeCalls === 1 && (await verdicts()).length === 1, "…without any AI call");

  // A fine verdict is remembered too: no issue, and not asked again.
  await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  const db = new Database(process.env.TEST_DB);
  db.prepare("UPDATE continuity_verdicts SET verdict = 'fine' WHERE story_id = ?").run(story);
  db.close();
  ok((await issues()).length === 0, "a clash judged fine is no issue");
  id = await newRun(story, null, { checks: ["continuity"] });
  runs.push(id);
  ok(await finish(id) && judgeCalls === 1, "…and is not asked about again");

  // Editing a chapter elsewhere keeps the clash's quotes, but its verdict was about the old text: it is asked again.
  const edited = await call("PATCH", `/api/chapters/${child}`, { base_revision: 1, title: "Child", body: "Mira has blue eyes. The rest of the child, edited." });
  ok(edited.status === 200, "the later chapter is edited, keeping the clashing sentence");
  await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  id = await newRun(story, null, { checks: ["facts", "continuity"] });
  runs.push(id);
  ok(await finish(id) && factCalls === 3 && judgeCalls === 2, "…so the next run reads it again and asks about the clash again");
  list = await verdicts();
  ok(list.length === 1 && list[0].after.revision === 2, "…and the verdict now names the new revision");

  // An approved change-event tag on the later chapter excuses the change: no clash, no question.
  const other = (await call("POST", "/api/stories", { title: "Continuity tf", premise: "P", chapter: { title: "Root", body: "Mira has green eyes. The rest of the root.", summary: "s", choices: ["Go"] } })).json;
  const oc = (await call("GET", `/api/chapters/${other.chapter_id}`)).json.choices;
  const oChild = (await call("POST", "/api/chapters", { choice_id: oc[0].id, title: "Child", body: "Mira has blue eyes. The rest of the child.", summary: "c" })).json.chapter_id;
  tagId = (await call("POST", "/api/tags", { name: "TF", applies: "a transformation", not_applies: "none" })).json.id;
  await call("PUT", `/api/stories/${other.story_id}/tags`, { tag_id: tagId, on: true });
  const added = await call("POST", `/api/chapters/${oChild}/tags`, { tag_id: tagId, value: null });
  ok(added.status < 300, "a chapter can be tagged tf by hand");
  id = await newRun(other.story_id, null, { checks: ["facts", "continuity"] });
  runs.push(id);
  const before = judgeCalls;
  ok(await finish(id) && judgeCalls === before, "a change on a chapter tagged tf is not asked about");

  // Judge replies that are not a contradiction store a verdict and make no issue.
  verdict = "change";
  const third = (await call("POST", "/api/stories", { title: "Continuity change", premise: "P", chapter: { title: "Root", body: "Mira has green eyes. The rest of the root.", summary: "s", choices: ["Go"] } })).json;
  const tc = (await call("GET", `/api/chapters/${third.chapter_id}`)).json.choices;
  await call("POST", "/api/chapters", { choice_id: tc[0].id, title: "Child", body: "Mira has blue eyes. The rest of the child.", summary: "c" });
  id = await newRun(third.story_id, null, { checks: ["facts", "continuity"] });
  runs.push(id);
  ok(await finish(id), "a run whose judge says change ends");
  const stored = (await call("GET", `/api/stories/${third.story_id}/continuity`)).json.verdicts;
  ok(stored.length === 1 && stored[0].verdict === "change" && (await runOf(id)).tasks.at(-1).found === 0, "…it stores the verdict and finds no contradiction");
} finally {
  for (const id of runs) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  await call("PUT", "/api/queue/paused", { paused: false });
  if (tagId) await call("DELETE", `/api/tags/${tagId}`);
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
