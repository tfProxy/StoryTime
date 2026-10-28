// A "review" AI run (Find tags on the work queue; with checks: ["facts"], the chapters' facts too): the server makes
// one task per chapter in scope that is not checked yet, the worker asks the (fake) AI once per chapter and saves the
// suggestions (or facts), and a second run finds nothing to do.
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

// The fake AI says the tag applies to every chapter, quoting the chapter's first words.
let tagCalls = 0;
let factCalls = 0;
const ai = await startFakeAi({
  port: 3570,
  delay: 5,
  reply: (body) => {
    const sent = JSON.stringify(body);
    if (sent.includes("You list the lasting facts")) {
      factCalls++;
      return JSON.stringify({ facts: [{ entity: "Hero", attribute: "home", value: "the farm", quote: "body of" }] });
    }
    if (!sent.includes("You label a chapter of a story with tags")) return "A reply.";
    tagCalls++;
    const name = /Tag: ([^\n]+)/.exec(body.messages?.at(-1)?.content ?? "")?.[1] ?? "";
    return JSON.stringify({ tags: [{ name, value: null, quote: "body of", reason: "it happens" }] });
  },
});

const sfx = Math.random().toString(36).slice(2, 8);
const itemOf = async (run) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`);
const runOf = async (run) => (await call("GET", `/api/ai-runs/${run}`)).json;
const finish = async (run) => {
  await call("POST", `/api/ai-runs/${run}/queue`);
  return !!(await until(async () => (await itemOf(run))?.state === "done"));
};

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
let tagId = null;
const switchedOff = [];
let story = null;
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    // No automatic codex check: it would add runs and AI calls this file counts.
    autoCodex: false,
  });

  // A two-chapter story with one tag on (the others the library holds are switched off for it).
  tagId = (await call("POST", "/api/tags", { name: `Run tag ${sfx}`, applies: "when it happens", not_applies: "when it does not" })).json.id;
  const s = await call("POST", "/api/stories", { title: "Tags run", premise: "P", chapter: { title: "Root", body: "root body of text", summary: "s", choices: ["Go", "Stay"] } });
  story = s.json.story_id;
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const child = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Child", body: "child body of text", summary: "c" })).json.chapter_id;
  for (const id of (await call("GET", `/api/stories/${story}/tags`)).json.enabled.filter((id) => id !== tagId)) {
    await call("PUT", `/api/stories/${story}/tags`, { tag_id: id, on: false });
    switchedOff.push(id);
  }

  // The posted tasks are ignored: the server makes them.
  let r = await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: {}, tasks: [] });
  ok(r.status === 201, "a tags run for the whole story needs no start chapter and no tasks");
  const first = r.json.id;
  let run = await runOf(first);
  ok(run.tasks.length === 2 && run.tasks.every((t) => t.kind === "tags" && t.status === "todo") && run.tasks[0].chapterId === root && run.tasks[1].chapterId === child, "…the server makes one task per chapter, in story order");
  r = await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: { tagScope: "chapter" } });
  ok(r.status === 400, "a run for one chapter needs the chapter");
  r = await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "fill", options: {} });
  ok(r.status === 400, "other modes still need their tasks");
  const sub = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: child, mode: "review", options: { tagScope: "subtree" } })).json.id;
  const way = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: child, mode: "review", options: { tagScope: "path" } })).json.id;
  const one = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: child, mode: "review", options: { tagScope: "chapter" } })).json.id;
  ok((await runOf(sub)).tasks.length === 1 && (await runOf(way)).tasks.length === 2 && (await runOf(one)).tasks.length === 1, "…the scope picks the chapter, the way to it, or it and what is below it");
  for (const id of [sub, way, one]) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);

  ok(await finish(first), "the worker takes the run to the end");
  run = await runOf(first);
  ok(run.status === "done" && run.tasks.every((t) => t.status === "done"), "…every task is done");
  ok(tagCalls === 2, "…with one AI call per chapter");
  const tags = (await call("GET", `/api/stories/${story}/chapter-tags`)).json;
  ok(tags.chapter_tags.length === 2 && tags.chapter_tags.every((t) => t.status === "suggested" && t.tag_id === tagId), "…and the suggestions are saved for the owner to decide");
  ok((await itemOf(first)).data.total === 2 && (await itemOf(first)).data.done === 2, "…the queue item counts both chapters");

  // A second run finds every chapter checked.
  const again = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: {} })).json.id;
  ok((await runOf(again)).tasks.length === 0, "a second run has no chapter left to check");
  ok(await finish(again) && (await runOf(again)).status === "done" && tagCalls === 2, "…and ends without an AI call");

  // A chapter edited after the run was made is skipped.
  const edited = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: root, mode: "review", options: { tagScope: "chapter", } })).json.id;
  ok((await runOf(edited)).tasks.length === 0, "a checked chapter is left out of a run for it alone");
  await call("DELETE", `/api/ai-runs/${edited}/queue?end=1`);
  const edit = await call("PATCH", `/api/chapters/${child}`, { title: "Child", body: "child body of text, changed", base_revision: 1, codex_changes: [] });
  ok(edit.status === 200, "a chapter can be edited");
  const stale = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: child, mode: "review", options: { tagScope: "chapter" } })).json.id;
  ok((await runOf(stale)).tasks.length === 1, "…and is checked again after the edit");
  await call("PATCH", `/api/chapters/${child}`, { title: "Child", body: "child body of text, changed again", base_revision: 2, codex_changes: [] });
  ok(await finish(stale), "…the run ends");
  const staleRun = await runOf(stale);
  ok(staleRun.tasks[0].status === "skipped" && tagCalls === 2, "…a chapter edited before its turn is skipped without an AI call");

  for (const id of [first, again, stale]) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);

  // Facts are asked for on their own: one task and one AI call per chapter not read yet, and none the second time.
  const tagCallsBefore = tagCalls;
  const facts = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: { checks: ["facts"] } })).json.id;
  run = await runOf(facts);
  ok(run.tasks.length === 2 && run.tasks.every((t) => t.kind === "facts" && t.status === "todo"), "a facts run makes one facts task per chapter");
  ok(await finish(facts), "…the worker takes it to the end");
  run = await runOf(facts);
  ok(run.status === "done" && run.tasks.every((t) => t.status === "done" && t.found === 1), "…every task is done, with the facts it saved");
  ok(factCalls === 2 && tagCalls === tagCallsBefore, "…with one fact AI call per chapter and no tag calls");
  const along = (await call("GET", `/api/chapters/${child}/facts`)).json.path;
  ok(along.length === 2 && along[0].chapterId === root && along[1].chapterId === child && along.every((c) => c.facts.length === 1 && c.facts[0].attribute === "home"), "…and the facts are saved along the path");
  ok((await itemOf(facts)).data.total === 2 && (await itemOf(facts)).data.done === 2, "…the queue item counts both checks");
  const factsAgain = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: { checks: ["facts"] } })).json.id;
  ok((await runOf(factsAgain)).tasks.length === 0, "a second facts run has nothing left to read");
  const both = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: { checks: ["tags", "facts"] } })).json.id;
  ok((await runOf(both)).tasks.every((t) => t.kind === "tags"), "…nor does one for tags and facts (it only has tags tasks left)");
  await call("PATCH", `/api/chapters/${child}`, { title: "Child", body: "child body of text, changed a third time", base_revision: 3, codex_changes: [] });
  ok((await call("GET", `/api/chapters/${child}/facts`)).json.path[1].facts.length === 0, "an edited chapter's old facts no longer count");
  const reread = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: null, mode: "review", options: { checks: ["facts"] } })).json.id;
  ok((await runOf(reread)).tasks.length === 1, "…and it is read again");
  for (const id of [facts, factsAgain, both, reread]) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
} finally {
  await call("PUT", "/api/queue/paused", { paused: false });
  if (tagId) await call("DELETE", `/api/tags/${tagId}`);
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
