// "Flesh out": POST /api/stories/<id>/flesh-out makes a review run (check "expand") with one task for the entry, the (fake)
// AI proposes new facts, and they arrive in the codex inbox with source "expand", anchored at the chapter the codex was
// read at, replacing only that entry's earlier ones and leaving the suggestions from reading a chapter alone.
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
  port: 3578,
  delay: 5,
  reply: (body) => {
    const text = JSON.stringify(body);
    if (text.includes("wants one entry to be fuller")) {
      if (text.includes("Stay close to the story")) {
        return JSON.stringify({ facts: [{ aspect: "Wariness", text: "Distrusts the river.", quote: "I don't trust the river" }, { aspect: "Pride", text: "Proud.", quote: "not in the chapters" }] });
      }
      return JSON.stringify({
        facts: [
          { aspect: "Voice", text: "Low and dry." },
          { aspect: "Ears", text: "Floppy." }, // Mira has Ears already
          { aspect: "Family", text: "An older brother in the city." },
        ],
      });
    }
    return "A reply.";
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

  const s = await call("POST", "/api/stories", { title: "Flesh", premise: "A girl turns into a fox.", chapter: { title: "Root", body: "Mira stood in the Hollow.", summary: "Mira arrives.", choices: ["Go"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const choice = (await call("GET", `/api/chapters/${root}`)).json.choices[0];
  const body1 = 'Mira crouched on the rail. "I don\'t trust the river," she said.';
  const c1 = (await call("POST", "/api/chapters", { choice_id: choice.id, title: "Ferry", body: body1, summary: "Mira meets the river." })).json.chapter_id;
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character", content: "SECRET NOTES" })).json.entry_id;
  await call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: mira, op: "set", aspect: "Ears", text: "Tall ears." });
  const zed = (await call("POST", "/api/codex", { anchor_chapter_id: c1, op: "create", name: "Zed", type: "character" })).json.entry_id;
  const route = (body) => call("POST", `/api/stories/${story}/flesh-out`, body);
  const inbox = async (query = "") => (await call("GET", `/api/stories/${story}/codex-suggestions${query}`)).json;
  const finish = async (run) => {
    runs.push(run);
    const done = await until(async () => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`)?.state === "done");
    await call("DELETE", `/api/queue/items/run:${run}`);
    return done;
  };
  const askedBefore = () => ai.requests.length;

  // ---- the route ----
  ok((await route({})).status === 400 && (await route({ chapter_id: root })).status === 400, "chapter and entry are required");
  ok((await route({ chapter_id: root, entry_id: mira, mode: "wild" })).status === 400, "a bad mode is refused");
  ok((await call("POST", "/api/stories/nope/flesh-out", { chapter_id: root, entry_id: mira })).status === 404 && (await route({ chapter_id: "nope", entry_id: mira })).status === 404, "an unknown story or chapter is refused");
  let r = await route({ chapter_id: root, entry_id: zed });
  ok(r.status === 200 && r.json.run_id === null && r.json.tasks === 0, "an entry that isn't there yet gives no run: " + JSON.stringify(r.json));

  // ---- inventing (the default) ----
  const before = askedBefore();
  r = await route({ chapter_id: c1, entry_id: mira, hint: "her family" });
  ok(r.status === 200 && r.json.tasks === 1 && !!r.json.run_id, "a run for one entry");
  const run = (await call("GET", `/api/ai-runs/${r.json.run_id}`)).json;
  const t = run.tasks[0];
  ok(run.mode === "review" && run.options.checks.join() === "expand" && t.kind === "expand" && t.entryId === mira && t.chapterId === c1 && t.mode === "invent" && t.hint === "her family" && t.label === "Mira", "the task: the entry, the chapter it is read at, invent mode and the hint");
  ok(!!(await finish(r.json.run_id)), "the worker takes the run to the end");
  const done = (await call("GET", `/api/ai-runs/${r.json.run_id}`)).json;
  ok(done.status === "done" && done.tasks[0].found === 2, "two facts were left (the aspect she already has was dropped): " + JSON.stringify(done.tasks.map((x) => x.found)));
  const sent = JSON.stringify(ai.requests.slice(before).map((q) => q.body));
  ok(sent.includes("Mira [character]") && sent.includes("Tall ears.") && sent.includes("A girl turns into a fox.") && sent.includes("her family") && sent.includes("Mira meets the river."), "the AI was given the entry, its facts, the premise, the hint and the story's summaries");
  ok(!sent.includes("SECRET NOTES"), "…and not the entry's notes");
  let open = (await inbox("?status=open")).suggestions.filter((x) => x.source === "expand");
  ok(open.length === 2 && open.every((x) => x.chapter_id === c1 && x.entry_id === mira && x.kind === "set" && x.quote === ""), "two 'expand' suggestions at the chapter, without quotes: " + JSON.stringify(open.map((x) => x.aspect)));

  // a suggestion from reading the chapter must survive a re-run, and a re-run replaces only the entry's own
  await call("POST", `/api/chapters/${c1}/codex-suggestions`, { revision: 1, suggestions: [{ kind: "set", entry_id: mira, aspect: "Eyes", form: "", after: "Amber.", quote: "x" }] });
  r = await route({ chapter_id: c1, entry_id: mira });
  ok(r.json.tasks === 1 && (await finish(r.json.run_id)), "run again");
  const all = (await inbox("?status=open")).suggestions;
  ok(all.filter((x) => x.source === "expand").length === 2 && all.filter((x) => x.source === "chapter").length === 1, "the earlier ones were replaced, not added to, and the chapter's stays");

  // ---- accept: the fact lands in the codex at the chapter, as an ordinary fact ----
  const voice = open.find((x) => x.aspect === "Voice");
  const fresh = (await inbox("?status=open")).suggestions.find((x) => x.source === "expand" && x.aspect === "Voice");
  r = await call("POST", `/api/codex-suggestions/${fresh.id}/accept`, {});
  ok(r.status === 200, "a suggestion is accepted");
  const at = async (id) => (await call("GET", `/api/chapters/${id}/codex`)).json.entries.find((e) => e.name === "Mira");
  ok((await at(c1)).description.includes("Voice: Low and dry.") && !(await at(root)).description.includes("Voice"), "it takes effect from the chapter it was read at");
  void voice;

  // ---- staying close: only facts whose quote is in the chapters ----
  r = await route({ chapter_id: c1, entry_id: mira, mode: "close" });
  ok(r.json.tasks === 1 && (await finish(r.json.run_id)), "a 'stay close' run");
  open = (await inbox("?status=open")).suggestions.filter((x) => x.source === "expand");
  ok(open.length === 1 && open[0].aspect === "Wariness" && open[0].quote === "I don't trust the river", "only the fact with a quote from the chapters is kept, with the quote: " + JSON.stringify(open.map((x) => x.aspect)));

  // ---- a linked shared entry: the facts become this story's own ----
  const shared = (await call("POST", "/api/shared", { name: "Oda", type: "character" })).json.id;
  const oda = (await call("POST", "/api/codex/link", { anchor_chapter_id: root, shared_entry_id: shared })).json.entry_id;
  r = await route({ chapter_id: c1, entry_id: oda });
  ok(r.json.tasks === 1 && (await finish(r.json.run_id)), "a run for a shared entry");
  const odaCard = (await inbox("?status=open")).suggestions.find((x) => x.entry_id === oda && x.aspect === "Voice");
  r = await call("POST", `/api/codex-suggestions/${odaCard.id}/accept`, {});
  ok(r.status === 200 && (await call("GET", `/api/chapters/${c1}/codex`)).json.entries.find((e) => e.name === "Oda").description.includes("Voice: Low and dry."), "accepted, it shows in the story");
  ok((await call("GET", `/api/shared/${shared}`)).json.entry.facts.length === 0, "…and the shared entry is untouched");

  // ---- an edited chapter: a new run reads the new revision ----
  ok((await call("PATCH", `/api/chapters/${c1}`, { title: "Ferry", body: body1 + " More.", base_revision: 1, codex_changes: [] })).status === 200, "the chapter is edited");
  r = await route({ chapter_id: c1, entry_id: mira });
  ok(r.json.tasks === 1 && (await call("GET", `/api/ai-runs/${r.json.run_id}`)).json.tasks[0].revision === 2 && (await finish(r.json.run_id)), "a new run uses revision 2");
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
