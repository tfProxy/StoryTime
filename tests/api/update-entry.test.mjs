// "Update from the story": POST /api/stories/<id>/update-entry makes a review run (check "update") with one codex task for
// each chapter on the way to the chapter that names the entry since its last change; the (fake) AI reads each for that
// entry alone, and its suggestions arrive in the inbox at their chapters, without other entries' and without marking the
// chapters as read for the codex.
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

const ai = await startFakeAi({
  port: 3579,
  delay: 5,
  reply: (body) => {
    const text = JSON.stringify(body);
    if (!text.includes("Propose only the changes this chapter makes to Mira")) return JSON.stringify({ changes: [] });
    if (text.includes('Chapter to read: \\"Growth\\"')) {
      return JSON.stringify({
        changes: [
          { kind: "set", entry: "Mira", aspect: "Ears", text: "Tall pointed fox ears.", quote: "ears grew tall and pointed" },
          { kind: "set", entry: "Oda", aspect: "Mood", text: "Amused.", quote: "Oda laughed" }, // another entry: dropped
          { kind: "entry", name: "The Well", type: "place", quote: "by the well", facts: [] }, // a new entry: dropped
        ],
      });
    }
    if (text.includes('Chapter to read: \\"Flight\\"')) return JSON.stringify({ changes: [{ kind: "set", entry: "Mira", aspect: "Mood", text: "Afraid.", quote: "her ears flat" }] });
    return JSON.stringify({ changes: [] });
  },
});

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const runs = [];
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    autoCodex: false,
  });

  // Root -> Growth -> Quiet -> Flight. Mira is created at the root; Quiet doesn't name her.
  const s = await call("POST", "/api/stories", { title: "Update", premise: "p", chapter: { title: "Root", body: "Mira stood in the Hollow.", choices: ["Go"] } });
  const story = s.json.story_id;
  const ids = [s.json.chapter_id];
  for (const [title, body] of [["Growth", "By the well, Mira's ears grew tall and pointed. Oda laughed."], ["Quiet", "Nobody spoke."], ["Flight", "Mira ran, her ears flat."]]) {
    const choice = (await call("GET", `/api/chapters/${ids.at(-1)}`)).json.choices[0];
    ids.push((await call("POST", "/api/chapters", { choice_id: choice.id, title, body, choices: title === "Flight" ? [] : ["Go"] })).json.chapter_id);
  }
  const [root, growth, quiet, flight] = ids;
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).json.entry_id;
  await call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: mira, op: "set", aspect: "Ears", text: "Round human ears." });
  const oda = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Oda", type: "character" })).json.entry_id;
  await call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: oda, op: "set", aspect: "Look", text: "ODA SECRET LOOK" });
  const zed = (await call("POST", "/api/codex", { anchor_chapter_id: flight, op: "create", name: "Zed", type: "character" })).json.entry_id;

  const route = (body) => call("POST", `/api/stories/${story}/update-entry`, body);
  const inbox = async () => (await call("GET", `/api/stories/${story}/codex-suggestions?status=open`)).json.suggestions;
  const finish = async (run) => {
    runs.push(run);
    const done = await until(async () => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`)?.state === "done");
    await call("DELETE", `/api/queue/items/run:${run}`);
    return done;
  };

  // ---- the route ----
  ok((await route({})).status === 400 && (await route({ chapter_id: flight })).status === 400, "chapter and entry are required");
  ok((await call("POST", "/api/stories/nope/update-entry", { chapter_id: flight, entry_id: mira })).status === 404, "an unknown story is refused");
  let r = await route({ chapter_id: flight, entry_id: zed });
  ok(r.status === 409 && r.json.error.includes("No chapter names Zed since it last changed"), "nothing to read since the last change: " + JSON.stringify(r.json));
  ok((await route({ chapter_id: root, entry_id: zed })).status === 404, "an entry not in the codex at that chapter is refused");

  // ---- a run: the chapters that name her since her last change, read for her alone ----
  const before = ai.requests.length;
  r = await route({ chapter_id: flight, entry_id: mira });
  ok(r.status === 200 && r.json.tasks === 2 && !!r.json.run_id, "a run of two tasks (Quiet doesn't name her): " + JSON.stringify(r.json));
  const run = (await call("GET", `/api/ai-runs/${r.json.run_id}`)).json;
  ok(run.options.checks.join() === "update" && run.tasks.map((t) => t.chapterId).join() === [growth, flight].join() && run.tasks.every((t) => t.kind === "codex" && t.entryId === mira && t.entryName === "Mira"), "codex tasks for Growth and Flight, each for Mira");
  ok(!!(await finish(r.json.run_id)), "the worker takes the run to the end");
  const done = (await call("GET", `/api/ai-runs/${r.json.run_id}`)).json;
  ok(done.tasks.map((t) => t.found).join() === "1,1", "one suggestion from each chapter: " + JSON.stringify(done.tasks.map((t) => t.found)));
  const sent = JSON.stringify(ai.requests.slice(before).map((q) => q.body));
  ok(sent.includes("Mira [character]") && sent.includes("Round human ears.") && !sent.includes("ODA SECRET LOOK"), "the AI was shown Mira and her facts, not the other entries'");
  let open = await inbox();
  ok(open.length === 2 && open.every((x) => x.entry_id === mira && x.source === "chapter"), "only Mira's suggestions are kept (no Oda, no new entry): " + JSON.stringify(open.map((x) => [x.entry_name, x.aspect])));
  ok(open.find((x) => x.aspect === "Ears")?.chapter_id === growth && open.find((x) => x.aspect === "Mood")?.chapter_id === flight, "…each at the chapter it was read from");
  const db = new Database(process.env.TEST_DB, { readonly: true });
  ok(db.prepare(`SELECT COUNT(*) AS n FROM codex_checks WHERE chapter_id IN (?, ?)`).get(growth, flight).n === 0, "the chapters aren't marked as read for the codex (only Mira was looked at)");
  db.close();

  // ---- a re-run replaces only Mira's open suggestions from reading the chapter ----
  await call("POST", `/api/chapters/${growth}/codex-suggestions`, { revision: 1, suggestions: [{ kind: "set", entry_id: oda, aspect: "Mood", form: "", after: "Amused.", quote: "Oda laughed" }] });
  r = await route({ chapter_id: flight, entry_id: mira });
  ok(r.json.tasks === 2 && (await finish(r.json.run_id)), "run again");
  open = await inbox();
  ok(open.filter((x) => x.entry_id === mira).length === 2 && open.filter((x) => x.entry_id === oda).length === 1, "Mira's were replaced, not added to, and Oda's from the full check stays");

  // ---- accepting a change at Flight starts again from there ----
  const mood = open.find((x) => x.entry_id === mira && x.aspect === "Mood");
  ok((await call("POST", `/api/codex-suggestions/${mood.id}/accept`, {})).status === 200, "a suggestion is accepted");
  r = await route({ chapter_id: flight, entry_id: mira });
  ok(r.status === 409, "with a change at the last chapter, nothing is left to read");
  void quiet;
} finally {
  for (const id of runs) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  await call("PUT", "/api/queue/paused", { paused: false });
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else {
    await call("PUT", "/api/settings", settingsBefore);
  }
}
