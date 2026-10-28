// The codex inbox: suggestions saved for a chapter, listed with before/current, accepted (with edits), dismissed and
// reopened; and a review run with checks ["codex"] that makes them through the (fake) AI.
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

// The fake AI answers a codex check with one change to Mira's ears.
const ai = await startFakeAi({
  port: 3576,
  delay: 5,
  reply: (body) => {
    if (!JSON.stringify(body).includes("You keep the codex of a story up to date")) return "A reply.";
    return JSON.stringify({ changes: [{ kind: "set", entry: "Mira", aspect: "Ears", text: "Tall russet fox ears.", quote: "My ears are tall and russet now" }] });
  },
});

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const runs = [];
try {
  // No automatic codex runs while this test makes chapters; the run below is made by hand.
  const put = await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    autoCodex: false,
  });
  ok(put.json.settings.autoCodex === false, "autoCodex can be turned off");
  ok(JSON.stringify((await call("GET", "/api/settings")).json.settings.autoCodex) === "false", "…and it is kept");

  // ---- a story with Mira in its first chapter ----
  const s = await call("POST", "/api/stories", { title: "Inbox", premise: "P", chapter: { title: "Root", body: "Mira stood in the Hollow.", summary: "s", choices: ["Go", "Stay"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const body1 = 'Mira gasped. "My ears are tall and russet now," she said. Her tail was gone. Brindle the old fox watched. "Her hair is red," said Tomas.';
  const c1 = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Change", body: body1, summary: "s" })).json.chapter_id;
  const other = (await call("POST", "/api/chapters", { choice_id: choices[1].id, title: "Other", body: "Nothing happens.", summary: "s" })).json.chapter_id;
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).json.entry_id;
  const fact = (aspect, text, form = "") => call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: mira, op: "set", aspect, form, text });
  await fact("Ears", "Human ears.");
  await fact("Hair", "Black hair.");
  await fact("Tail", "A small bare tail.");
  await fact("form", "", "human");
  const miraAt = async (chapter) => (await call("GET", `/api/chapters/${chapter}/codex`)).json.entries.find((e) => e.name === "Mira");
  const factOf = async (chapter, aspect) => (await miraAt(chapter)).facts.find((f) => f.aspect === aspect);

  const suggestions = [
    { kind: "set", entry_id: mira, aspect: "Ears", form: "", after: "Tall russet fox ears.", quote: "My ears are tall and russet now" },
    { kind: "set", entry_id: mira, aspect: "Eyes", form: "", after: "Amber eyes.", quote: "Mira gasped" },
    { kind: "form", entry_id: mira, form: "vixen", after: "change begun", quote: "Mira gasped" },
    { kind: "retire", entry_id: mira, aspect: "Tail", form: "", after: "", quote: "Her tail was gone" },
    { kind: "entry", entry: { name: "Brindle", type: "character", aliases: ["the old fox"], notes: "An old fox.", facts: [{ aspect: "Age", form: "", text: "Old." }] }, quote: "Brindle the old fox watched" },
    { kind: "conflict", entry_id: mira, aspect: "Hair", form: "", after: "Red hair.", quote: "Her hair is red" },
  ];
  const post = (chapter, revision, list) => call("POST", `/api/chapters/${chapter}/codex-suggestions`, { revision, suggestions: list });
  const inbox = async (query = "") => (await call("GET", `/api/stories/${story}/codex-suggestions${query}`)).json;
  const find = (list, kind, aspect = "") => list.suggestions.find((x) => x.kind === kind && x.aspect === aspect);

  let r = await post(c1, 1, suggestions);
  ok(r.status === 200 && r.json.saved === 6, "six suggestions are saved: " + JSON.stringify(r.json));
  ok((await post(c1, 2, suggestions)).status === 409, "a wrong revision is refused");
  ok((await post("nope", 1, suggestions)).status === 404, "an unknown chapter is refused");
  ok((await post(c1, 1, [{ kind: "set", aspect: "Ears", after: "x", quote: "q" }])).status === 400, "a suggestion with no entry is refused");

  let list = await inbox("?status=open");
  ok(list.suggestions.length === 6 && list.counts.total === 6 && list.counts.byChapter[c1] === 6, "the inbox lists them, with the counts");
  const ears = find(list, "set", "Ears");
  ok(ears.before === "Human ears." && ears.current === "Human ears." && ears.after === "Tall russet fox ears." && ears.entry_name === "Mira" && ears.chapter_title === "Change" && ears.status === "open", "a set carries before, current, after, the entry and the chapter");
  ok(find(list, "set", "Eyes").before === "", "a new aspect has no before");
  ok(find(list, "form").before === "human" && find(list, "form").form === "vixen" && find(list, "form").after === "change begun", "a form carries the old form and the new one");
  ok(find(list, "retire", "Tail").before === "A small bare tail." && find(list, "retire", "Tail").after === "", "a retire carries the fact it ends");
  const proposed = list.suggestions.find((x) => x.kind === "entry");
  ok(proposed.entry_id === null && proposed.entry_name === "Brindle" && proposed.entry.facts.length === 1 && proposed.entry.aliases[0] === "the old fox", "an entry suggestion carries the proposal");
  ok(find(list, "conflict", "Hair").before === "Black hair.", "a conflict carries the fact it clashes with");
  ok((await inbox(`?chapter=${other}`)).suggestions.length === 0 && (await inbox("?status=accepted")).suggestions.length === 0, "the filters narrow the list");
  ok((await call("GET", `/api/stories/${story}/codex-suggestions?status=weird`)).status === 400 && (await call("GET", "/api/stories/nope/codex-suggestions")).status === 404, "a bad status and an unknown story are refused");

  // ---- accept ----
  r = await call("POST", `/api/codex-suggestions/${ears.id}/accept`);
  ok(r.status === 200 && r.json.entry_id === mira, "accepting a set answers with the entry: " + JSON.stringify(r.json));
  ok((await factOf(c1, "Ears")).text === "Tall russet fox ears." && (await factOf(c1, "Ears")).quote === "My ears are tall and russet now", "…the fact is there at that chapter, with the quote");
  ok((await factOf(root, "Ears")).text === "Human ears." && (await factOf(other, "Ears")).text === "Human ears.", "…and not at the chapters before or beside it");
  ok((await call("POST", `/api/codex-suggestions/${ears.id}/accept`)).status === 409, "a suggestion is accepted once");
  const done = (await inbox("?status=accepted")).suggestions[0];
  ok(done.status === "accepted" && done.current === "Tall russet fox ears." && done.before === "Human ears.", "an accepted one shows what the codex says now");

  r = await call("POST", `/api/codex-suggestions/${find(list, "set", "Eyes").id}/accept`, { text: "Amber eyes with slit pupils." });
  ok(r.status === 200 && (await factOf(c1, "Eyes")).text === "Amber eyes with slit pupils.", "accepting with an edited text saves the edit");

  r = await call("POST", `/api/codex-suggestions/${find(list, "form").id}/accept`, { form: "kit", text: "just begun" });
  const m = await miraAt(c1);
  ok(r.status === 200 && m.form.name === "kit" && m.form.note === "just begun", "accepting a form sets the entry's form (with edits)");

  r = await call("POST", `/api/codex-suggestions/${find(list, "retire", "Tail").id}/accept`);
  ok(r.status === 200 && !(await factOf(c1, "Tail")) && !!(await factOf(root, "Tail")), "accepting a retire ends the fact from that chapter on");

  r = await call("POST", `/api/codex-suggestions/${proposed.id}/accept`);
  const brindle = (await call("GET", `/api/chapters/${c1}/codex`)).json.entries.find((e) => e.name === "Brindle");
  ok(r.status === 200 && brindle && brindle.entry_id === r.json.entry_id && brindle.aliases[0] === "the old fox" && brindle.content === "An old fox." && brindle.facts[0].aspect === "Age" && brindle.facts[0].text === "Old.", "accepting an entry creates it with its facts");
  ok(!(await call("GET", `/api/chapters/${root}/codex`)).json.entries.some((e) => e.name === "Brindle"), "…at that chapter, not before");

  // ---- dismiss, and a second reading does not bring it back ----
  const conflict = find(list, "conflict", "Hair");
  r = await call("POST", `/api/codex-suggestions/${conflict.id}/dismiss`);
  ok(r.status === 200 && (await inbox("?status=dismissed")).suggestions.length === 1, "a suggestion can be dismissed");
  ok((await call("POST", `/api/codex-suggestions/${conflict.id}/dismiss`)).status === 409 && (await call("POST", `/api/codex-suggestions/${ears.id}/reopen`)).status === 409, "…only an open one, and only a dismissed one can be reopened");
  ok((await call("POST", `/api/codex-suggestions/${conflict.id}/accept`)).status === 409, "a dismissed suggestion can't be accepted");
  r = await post(c1, 1, suggestions);
  ok(r.json.saved === 2, "reading the chapter again leaves out what is already so, gone, existing or dismissed (Eyes and the form differ from the edits): " + JSON.stringify(r.json));
  list = await inbox("?status=open");
  ok(list.suggestions.length === 2 && list.suggestions.some((x) => x.aspect === "Eyes") && list.suggestions.some((x) => x.kind === "form") && list.counts.total === 2, "…so two are open");
  ok((await inbox("?status=dismissed")).suggestions.length === 1 && (await inbox("?status=accepted")).suggestions.length === 5, "…the dismissed one and the five accepted are kept");

  r = await call("POST", `/api/codex-suggestions/${conflict.id}/reopen`);
  list = await inbox("?status=open");
  ok(r.status === 200 && list.suggestions.length === 3 && list.suggestions.some((x) => x.id === conflict.id), "a dismissed suggestion can be reopened");

  // ---- an accepted fact that moved on: current differs from after ----
  const eyes = list.suggestions.find((x) => x.aspect === "Eyes");
  ok(eyes.current === "Amber eyes with slit pupils." && eyes.before === "Amber eyes with slit pupils.", "a suggestion shows the fact as it is now (before is read when it is saved)");

  // ---- an edited chapter: its open suggestions are stale ----
  const edit = await call("PATCH", `/api/chapters/${c1}`, { title: "Change", body: body1 + " More.", base_revision: 1, codex_changes: [] });
  ok(edit.status === 200, "the chapter is edited");
  list = await inbox("?status=open");
  ok(list.suggestions.length === 0 && list.counts.total === 0, "its open suggestions are no longer listed or counted");
  ok((await inbox("?status=accepted")).suggestions.length === 5, "…the accepted ones stay");
  ok((await call("POST", `/api/codex-suggestions/${conflict.id}/accept`)).status === 409, "…and a stale one can't be accepted");
  ok((await post(c1, 1, suggestions)).status === 409, "…nor saved for the old revision");

  // ---- a retire whose fact has gone meanwhile ----
  const s2 = await call("POST", "/api/stories", { title: "Inbox 2", premise: "P", chapter: { title: "Root", body: "Rex.", summary: "s", choices: ["Go"] } });
  const root2 = s2.json.chapter_id;
  const kid = (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${root2}`)).json.choices[0].id, title: "Kid", body: "Rex lost his collar.", summary: "s" })).json.chapter_id;
  const rex = (await call("POST", "/api/codex", { anchor_chapter_id: root2, op: "create", name: "Rex", type: "character" })).json.entry_id;
  const collar = (await call("POST", "/api/codex/facts", { anchor_chapter_id: root2, entry_id: rex, op: "set", aspect: "Collar", text: "Red collar." })).json.fact_id;
  r = await post(kid, 1, [{ kind: "retire", entry_id: rex, aspect: "Collar", form: "", after: "", quote: "Rex lost his collar" }]);
  ok(r.json.saved === 1, "a retire of a live fact is saved");
  await call("POST", "/api/codex/facts", { anchor_chapter_id: kid, entry_id: rex, fact_id: collar, op: "retire", aspect: "Collar" });
  const gone = (await call("GET", `/api/stories/${s2.json.story_id}/codex-suggestions?status=open`)).json.suggestions[0];
  r = await call("POST", `/api/codex-suggestions/${gone.id}/accept`);
  ok(r.status === 409 && /already gone/.test(r.json.error), "accepting a retire of a fact that is gone says so: " + JSON.stringify(r.json));
  r = await post(kid, 1, [{ kind: "retire", entry_id: rex, aspect: "Collar", form: "", after: "", quote: "Rex lost his collar" }]);
  ok(r.json.saved === 0, "a retire of a fact that is gone is not saved");

  // ---- the review run ----
  const s3 = await call("POST", "/api/stories", { title: "Inbox run", premise: "P", chapter: { title: "Root", body: "Mira waited.", summary: "s", choices: ["Go"] } });
  const story3 = s3.json.story_id;
  const root3 = s3.json.chapter_id;
  const mira3 = (await call("POST", "/api/codex", { anchor_chapter_id: root3, op: "create", name: "Mira", type: "character" })).json.entry_id;
  await call("POST", "/api/codex/facts", { anchor_chapter_id: root3, entry_id: mira3, op: "set", aspect: "Ears", text: "Human ears." });
  const kid3 = (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${root3}`)).json.choices[0].id, title: "Child", body: 'Mira touched her head. "My ears are tall and russet now," she said.', summary: "s" })).json.chapter_id;
  const itemOf = async (run) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`);
  const newRun = async (options, start = kid3, scope = "chapter") => {
    const id = (await call("POST", "/api/ai-runs", { story_id: story3, start_chapter_id: start, mode: "review", options: { tagScope: scope, ...options } })).json.id;
    runs.push(id);
    return id;
  };

  let id = await newRun({ checks: ["codex"] });
  let run = (await call("GET", `/api/ai-runs/${id}`)).json;
  ok(run.tasks.length === 1 && run.tasks[0].kind === "codex" && run.tasks[0].chapterId === kid3 && run.tasks[0].revision === 1 && run.tasks[0].label === "Child" && run.tasks[0].status === "todo", "a codex run has a task for the chapter");
  await call("POST", `/api/ai-runs/${id}/queue`);
  ok(!!(await until(async () => (await itemOf(id))?.state === "done")), "the worker takes the run to the end");
  run = (await call("GET", `/api/ai-runs/${id}`)).json;
  ok(run.status === "done" && run.tasks[0].status === "done" && run.tasks[0].found === 1, "…the task found one suggestion");
  const asked = ai.requests.filter((q) => JSON.stringify(q.body).includes("You keep the codex of a story up to date"));
  ok(asked.length === 1 && JSON.stringify(asked[0].body).includes("Human ears.") && JSON.stringify(asked[0].body).includes("My ears are tall and russet now"), "…the AI was asked once, with the chapter and what the codex says of Mira");
  const made = (await call("GET", `/api/stories/${story3}/codex-suggestions?status=open`)).json;
  ok(made.suggestions.length === 1 && made.suggestions[0].kind === "set" && made.suggestions[0].entry_id === mira3 && made.suggestions[0].before === "Human ears." && made.suggestions[0].chapter_id === kid3, "…and it is in the inbox, against Mira's ears");
  await call("DELETE", `/api/queue/items/run:${id}`);

  id = await newRun({ checks: ["codex"] });
  ok((await call("GET", `/api/ai-runs/${id}`)).json.tasks.length === 0, "a chapter already read has no task in the next run");
  id = await newRun({ checks: ["codex"], recheck: true });
  ok((await call("GET", `/api/ai-runs/${id}`)).json.tasks.length === 1, "…unless the run asks to read it again");
  id = await newRun({ checks: ["tags", "codex"], recheck: true }, null, "story");
  ok((await call("GET", `/api/ai-runs/${id}`)).json.tasks.filter((t) => t.kind === "codex").length === 2, "a whole-story run has a task for each chapter");
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
