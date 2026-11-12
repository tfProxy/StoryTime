// The writing desk's Post and Update: with rewrite_summary the server queues an automatic review run that writes the
// summary afresh (the fake AI), unless the owner made it theirs (PATCH /summary, "yours · not rewritten"); "Let the AI
// rewrite it" hands it back. Also "Remove the AI mark" (POST /owned).
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

let calls = 0;
const ai = await startFakeAi({
  port: 3573,
  delay: 5,
  reply: (body) => {
    if (!JSON.stringify(body).includes("running summary")) return "A reply.";
    calls++;
    return `SUMMARY: Rewritten ${calls}.\nSTORY SO FAR: So far ${calls}.`;
  },
});

const chapter = async (id) => (await call("GET", `/api/chapters/${id}`)).json.chapter;
/** The automatic review runs queued for the chapter (their queue items). */
const runsFor = async (id) => {
  const items = (await call("GET", "/api/queue")).json.items.filter((i) => i.type === "run");
  const runs = [];
  for (const i of items) {
    const run = (await call("GET", `/api/ai-runs/${i.key.slice(4)}`)).json;
    if (run?.start_chapter_id === id) runs.push(run);
  }
  return runs;
};
const settingsBefore = (await call("GET", "/api/settings")).json.settings;
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    autoCodex: false,
    autoReview: false,
  });

  const s = await call("POST", "/api/stories", { title: "Desk summary", premise: "P", chapter: { title: "Root", body: "The sun came up.", summary: "The sun rises.", path_summary: "Sun.", choices: ["Go", "Stay"] } });
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;

  // An edit from the Edit page (no rewrite_summary) with the settings off queues nothing.
  await call("PATCH", `/api/chapters/${root}`, { base_revision: 1, title: "Root", body: "The sun came up slowly.", summary: "The sun rises.", path_summary: "Sun." });
  await sleep(300);
  ok((await runsFor(root)).length === 0, "an edit without rewrite_summary queues no run when the automatic checks are off");

  // An Update from the desk: the summary is rewritten in the background.
  const up = await call("PATCH", `/api/chapters/${root}`, { base_revision: 2, title: "Root", body: "The sun came up at last.", summary: "The sun rises.", path_summary: "Sun.", rewrite_summary: true });
  ok(up.status === 200, "an Update with rewrite_summary is accepted");
  const rewritten = await until(async () => (await chapter(root)).summary.startsWith("Rewritten") && (await chapter(root)));
  ok(!!rewritten && rewritten.path_summary.startsWith("So far"), "…and the summary and story-so-far are written afresh by the queue");
  ok(calls === 1, "…with one AI call");

  // The owner's own summary is left alone.
  const own = await call("PATCH", `/api/chapters/${root}/summary`, { summary: "My own words.", mine: true });
  ok(own.status === 200 && own.json.mine === true && (await chapter(root)).summary === "My own words.", "the owner's summary is saved as theirs");
  const runsBefore = (await runsFor(root)).length;
  await call("PATCH", `/api/chapters/${root}`, { base_revision: 3, title: "Root", body: "The sun came up, finally.", summary: "My own words.", path_summary: "So far 1.", rewrite_summary: true });
  await sleep(600);
  ok((await chapter(root)).summary === "My own words." && calls === 1 && (await runsFor(root)).length === runsBefore, "an Update leaves the owner's summary alone and asks no AI");
  const refused = await call("PUT", `/api/chapters/${root}/summary`, { revision: 4, summary: "AI", path_summary: "AI", ai: true });
  ok(refused.status === 409, "the AI's rewrite is refused while the summary is the owner's");

  // "Let the AI rewrite it": the next Update rewrites it.
  const back = await call("PATCH", `/api/chapters/${root}/summary`, { mine: false });
  ok(back.json.mine === false && (await chapter(root)).summary === "My own words.", "Let the AI rewrite it keeps the text until the next Update");
  await call("PATCH", `/api/chapters/${root}`, { base_revision: 4, title: "Root", body: "The sun rose.", summary: "My own words.", path_summary: "So far 1.", rewrite_summary: true });
  ok(!!(await until(async () => (await chapter(root)).summary.startsWith("Rewritten 2"))), "…which writes it afresh again");

  // A new chapter posted from the desk: with no summary one is written; with the owner's, it is theirs.
  const a = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "A", body: "Text.", rewrite_summary: true })).json.chapter_id;
  ok(!!(await until(async () => (await chapter(a)).summary?.startsWith("Rewritten"))), "a chapter posted with rewrite_summary gets its summary from the queue");
  const before = calls;
  const b = (await call("POST", "/api/chapters", { choice_id: choices[1].id, title: "B", body: "Text.", summary: "Mine.", summary_mine: true, rewrite_summary: true })).json.chapter_id;
  await sleep(600);
  ok((await chapter(b)).summary === "Mine." && calls === before, "one posted with the owner's summary keeps it");
  const refusedB = await call("PUT", `/api/chapters/${b}/summary`, { revision: 1, summary: "AI", path_summary: "AI", ai: true });
  ok(refusedB.status === 409, "…which is theirs");

  // Remove the AI mark
  const db = new Database(process.env.TEST_DB);
  db.prepare(`UPDATE chapters SET ai_run_id = 'x' WHERE id = ?`).run(a);
  db.close();
  const owned = await call("POST", `/api/chapters/${a}/owned`);
  ok(owned.status === 200 && owned.json.marked === 1, "Remove the AI mark drops the mark");
  ok((await call("POST", `/api/chapters/${a}/owned`)).json.marked === 0, "…once");
  ok((await call("POST", "/api/chapters/nope/owned")).status === 404, "…and a missing chapter is a 404");
} finally {
  await call("PUT", "/api/queue/paused", { paused: false });
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
