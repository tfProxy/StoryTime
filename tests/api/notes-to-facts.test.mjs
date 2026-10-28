// "Turn notes into facts": POST /api/stories/<id>/notes-to-facts makes a review run (check "notes") with one task for
// each entry that has notes, the (fake) AI reads the notes, and the facts arrive in the codex inbox with source "notes",
// anchored at the chapter the notes were written at, without touching the suggestions made from reading a chapter.
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

// The fake AI answers the notes of Mira and of Kit, and a codex check of a chapter.
const ai = await startFakeAi({
  port: 3577,
  delay: 5,
  reply: (body) => {
    const text = JSON.stringify(body);
    if (text.includes("Split those notes into facts")) {
      if (text.includes("The entry: Mira")) {
        return JSON.stringify({
          facts: [
            { kind: "set", aspect: "Eyes", text: "Amber eyes.", quote: "amber eyes" },
            { kind: "set", aspect: "Personality", text: "Shy.", quote: "is shy" },
            { kind: "form", form: "vixen", text: "", quote: "Currently a vixen" },
            { kind: "set", aspect: "Hair", text: "Red hair.", quote: "this is not in the notes" },
          ],
        });
      }
      return JSON.stringify({ facts: [{ kind: "set", aspect: "Fur", text: "Green fur.", quote: "green fur" }] });
    }
    if (text.includes("You keep the codex of a story up to date")) {
      return JSON.stringify({ changes: [{ kind: "set", entry: "Mira", aspect: "Ears", text: "Tall ears.", quote: "My ears are tall" }] });
    }
    return "A reply.";
  },
});

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const runs = [];
try {
  const put = await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    autoCodex: false,
  });
  ok(put.status === 200 && put.json.settings.autoCodex === false, "automatic codex runs are off");

  // ---- a story: Mira (notes) and Zed (none) at the root, Kit (notes) at the child ----
  const s = await call("POST", "/api/stories", { title: "Notes", premise: "P", chapter: { title: "Root", body: "Mira stood in the Hollow.", summary: "s", choices: ["Go", "Stay"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const body1 = 'Mira gasped. "My ears are tall," she said.';
  const c1 = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Child", body: body1, summary: "s" })).json.chapter_id;
  const other = (await call("POST", "/api/chapters", { choice_id: choices[1].id, title: "Other", body: "Nothing happens.", summary: "s" })).json.chapter_id;
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character", content: "Mira has amber eyes and is shy. Currently a vixen." })).json.entry_id;
  const zed = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Zed", type: "character", content: "" })).json.entry_id;
  const kit = (await call("POST", "/api/codex", { anchor_chapter_id: c1, op: "create", name: "Kit", type: "character", content: "Kit has green fur." })).json.entry_id;
  const notesRoute = (body) => call("POST", `/api/stories/${story}/notes-to-facts`, body);
  const inbox = async (query = "") => (await call("GET", `/api/stories/${story}/codex-suggestions${query}`)).json;
  const itemOf = async (run) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`);
  const finish = async (run) => {
    runs.push(run);
    const done = await until(async () => (await itemOf(run))?.state === "done");
    await call("DELETE", `/api/queue/items/run:${run}`);
    return done;
  };

  // ---- the route ----
  ok((await notesRoute({})).status === 400 && (await notesRoute({ chapter_id: "nope" })).status === 404, "a missing chapter id is refused (400), an unknown chapter is refused (404)");
  ok((await call("POST", "/api/stories/nope/notes-to-facts", { chapter_id: root })).status === 404, "an unknown story is refused");
  let r = await notesRoute({ chapter_id: root });
  ok(r.status === 200 && r.json.tasks === 1 && !!r.json.run_id, "at the root only Mira has notes (Zed has none, Kit is not there yet): " + JSON.stringify(r.json));
  ok(!!(await finish(r.json.run_id)), "the run finishes");
  r = await notesRoute({ chapter_id: root, entry_ids: [zed] });
  ok(r.status === 200 && r.json.tasks === 0 && r.json.run_id === null, "an entry with no notes gives no run: " + JSON.stringify(r.json));
  ok((await notesRoute({ chapter_id: other })).json.tasks === 1, "a sibling branch sees Mira's notes but not Kit's");
  // (that run is left to finish below)
  const leftover = (await call("GET", `/api/stories/${story}/ai-runs`)).json.runs;
  for (const run of leftover) {
    if (run.status !== "done" && run.status !== "stopped") await finish(run.id);
  }

  // A suggestion from reading the child chapter, which the notes runs must leave alone.
  r = await call("POST", `/api/chapters/${c1}/codex-suggestions`, { revision: 1, suggestions: [{ kind: "set", entry_id: mira, aspect: "Ears", form: "", after: "Tall ears.", quote: "My ears are tall" }] });
  ok(r.status === 200 && r.json.saved === 1, "a chapter suggestion is saved");

  r = await notesRoute({ chapter_id: c1 });
  ok(r.status === 200 && r.json.tasks === 2 && !!r.json.run_id, "at the child Mira and Kit have notes: " + JSON.stringify(r.json));
  const runId = r.json.run_id;
  const run = (await call("GET", `/api/ai-runs/${runId}`)).json;
  const tMira = run.tasks.find((t) => t.entryId === mira);
  const tKit = run.tasks.find((t) => t.entryId === kit);
  ok(run.mode === "review" && run.start_chapter_id === c1 && run.options.checks.join() === "notes", "the run is a review run with the notes check");
  ok(tMira.kind === "notes" && tMira.chapterId === root && tMira.revision === 1 && tMira.label === "Mira" && tMira.status !== undefined, "Mira's task is anchored at the chapter her notes were written at");
  ok(tKit.kind === "notes" && tKit.chapterId === c1 && tKit.label === "Kit", "Kit's task is anchored at the child");
  ok(!!(await finish(runId)), "the worker takes the run to the end");
  const after = (await call("GET", `/api/ai-runs/${runId}`)).json;
  ok(after.status === "done" && after.tasks.every((t) => t.status === "done") && after.tasks.find((t) => t.entryId === mira).found === 3 && after.tasks.find((t) => t.entryId === kit).found === 1, "…Mira's task found three (the quote not in the notes was dropped), Kit's one: " + JSON.stringify(after.tasks.map((t) => t.found)));
  const asked = ai.requests.filter((q) => JSON.stringify(q.body).includes("Split those notes into facts"));
  ok(asked.some((q) => JSON.stringify(q.body).includes("amber eyes and is shy")), "…the AI was given Mira's notes");

  // ---- the inbox ----
  const open = (await inbox("?status=open")).suggestions;
  const fromNotes = open.filter((x) => x.source === "notes");
  ok(fromNotes.length === 4 && open.filter((x) => x.source === "chapter").length === 1, "the inbox has four notes suggestions beside the chapter one: " + JSON.stringify(open.map((x) => [x.source, x.aspect])));
  const eyes = fromNotes.find((x) => x.aspect === "Eyes");
  ok(eyes.chapter_id === root && eyes.entry_id === mira && eyes.after === "Amber eyes." && eyes.quote === "amber eyes", "Mira's suggestion is at the root, with a quote from the notes");
  ok(fromNotes.find((x) => x.kind === "form").form === "vixen" && fromNotes.find((x) => x.aspect === "Fur").chapter_id === c1, "a form item and Kit's fur arrive too");
  ok(open.find((x) => x.source === "chapter").aspect === "Ears" && (await inbox(`?chapter=${root}`)).suggestions.every((x) => x.source === "notes"), "the chapter suggestion is still there, and the filters keep working");

  // ---- running again replaces only the open notes suggestions of the same entry ----
  r = await notesRoute({ chapter_id: c1, entry_ids: [mira] });
  ok(r.json.tasks === 1 && (await finish(r.json.run_id)), "a run for one entry");
  const again = (await inbox("?status=open")).suggestions;
  ok(again.length === 5 && again.filter((x) => x.source === "notes").length === 4, "…it replaced Mira's notes suggestions and left Kit's and the chapter's: " + again.length);

  // ---- accept: the fact is saved at the anchor chapter ----
  const fur = again.find((x) => x.aspect === "Fur");
  const eyes2 = again.find((x) => x.aspect === "Eyes");
  r = await call("POST", `/api/codex-suggestions/${eyes2.id}/accept`);
  ok(r.status === 200 && r.json.entry_id === mira, "accepting a notes suggestion works");
  const miraAt = async (chapter) => (await call("GET", `/api/chapters/${chapter}/codex`)).json.entries.find((e) => e.name === "Mira");
  ok((await miraAt(root)).facts.some((f) => f.aspect === "Eyes" && f.text === "Amber eyes." && f.quote === "amber eyes"), "…the fact is at the chapter the notes were written at, with the quote");
  ok((await miraAt(c1)).facts.some((f) => f.aspect === "Eyes") && (await miraAt(other)).facts.some((f) => f.aspect === "Eyes"), "…and so below it, on both branches");
  ok((await miraAt(root)).content.includes("amber eyes") && !(await miraAt(root)).description.includes("amber eyes and is shy"), "…the notes are untouched and never part of the description");

  // ---- a dismissed notes suggestion stays out of the next reading ----
  r = await call("POST", `/api/codex-suggestions/${fur.id}/dismiss`);
  ok(r.status === 200, "a notes suggestion can be dismissed");
  r = await notesRoute({ chapter_id: c1, entry_ids: [kit] });
  ok(r.json.tasks === 1 && (await finish(r.json.run_id)), "Kit's notes are read again");
  ok(!(await inbox("?status=open")).suggestions.some((x) => x.aspect === "Fur"), "…the dismissed fact does not come back");

  // ---- an edited chapter: the notes task is skipped, nothing saved ----
  const edit = await call("PATCH", `/api/chapters/${c1}`, { title: "Child", body: body1 + " More.", base_revision: 1, codex_changes: [] });
  ok(edit.status === 200, "the child chapter is edited");
  r = await notesRoute({ chapter_id: c1, entry_ids: [kit] });
  ok(r.json.tasks === 1 && r.json.run_id, "a new run uses the new revision");
  ok(!!(await finish(r.json.run_id)) && (await call("GET", `/api/ai-runs/${r.json.run_id}`)).json.tasks[0].revision === 2, "…and the task has revision 2");
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
