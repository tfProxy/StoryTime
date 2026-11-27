// Posting a chapter approves the AI's codex facts along the way: when the owner writes on from a chapter, the facts the AI
// applied on its own (autoApplyCodex) at the chapters from the story's first to that chapter lose their AI mark, as
// Approve does. Facts on other branches, and the AI's facts when the chapter is posted by an AI run, are left alone.
import Database from "better-sqlite3";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
try {
  // No AI is set up, so saving chapters queues no automatic codex check: the readings below are posted by hand.
  await call("PUT", "/api/settings", { ...(settingsBefore ?? {}), connections: [], defaults: { main: null, cheap: null }, autoReview: false, autoCodex: true, autoApplyCodex: true });

  // Root -> A ("On", "Later", "Also"); Root -> D ("Other"); A -> B ("Later").
  const s = await call("POST", "/api/stories", { title: "Post approves", premise: "P", chapter: { title: "Root", body: "Mira spoke in a low rasp.", summary: "s", choices: ["Go", "Other"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const choiceOf = async (chapter, label) => (await call("GET", `/api/chapters/${chapter}`)).json.choices.find((c) => c.label === label).id;
  const A = (await call("POST", "/api/chapters", { choice_id: await choiceOf(root, "Go"), title: "A", body: "Her eyes were amber.", summary: "s", choices: ["On", "Later", "Also"] })).json.chapter_id;
  const D = (await call("POST", "/api/chapters", { choice_id: await choiceOf(root, "Other"), title: "D", body: "Her hair was red.", summary: "s" })).json.chapter_id;
  const Bch = (await call("POST", "/api/chapters", { choice_id: await choiceOf(A, "Later"), title: "B", body: "She smelled of pine.", summary: "s" })).json.chapter_id;

  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).json.entry_id;
  const read = (chapter, aspect, after, quote) => call("POST", `/api/chapters/${chapter}/codex-suggestions`, { revision: 1, suggestions: [{ kind: "set", entry_id: mira, aspect, after, quote }] });
  const marks = async () => (await call("GET", `/api/stories/${story}/codex-suggestions?status=open`)).json.counts.aiByChapter ?? {};
  const factAt = async (chapter, aspect) => (await call("GET", `/api/chapters/${chapter}/codex`)).json.entries.find((e) => e.name === "Mira").facts.find((f) => f.aspect === aspect);

  const rs = [await read(root, "Voice", "A low rasp.", "low rasp"), await read(A, "Eyes", "Amber eyes.", "Her eyes were amber"), await read(D, "Hair", "Red hair.", "Her hair was red"), await read(Bch, "Scent", "Smells of pine.", "smelled of pine")];
  ok(rs.every((r) => r.status === 200 && r.json.applied === 1), "the AI applies a fact at each of four chapters: " + JSON.stringify(rs.map((r) => r.json)));
  let m = await marks();
  ok(m[root] === 1 && m[A] === 1 && m[D] === 1 && m[Bch] === 1, "each waits for approval: " + JSON.stringify(m));

  // A chapter an AI run writes is not the owner going on: nothing is approved.
  const run = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: root, mode: "fill", options: { endChoices: 3 }, tasks: [] })).json.id;
  const viaRun = await call("POST", "/api/chapters", { choice_id: await choiceOf(A, "Also"), title: "Written by the AI", body: "Run text.", summary: "s", ai_run_id: run });
  ok(viaRun.status === 201, "a chapter is posted by an AI run");
  m = await marks();
  ok(m[root] === 1 && m[A] === 1 && m[D] === 1 && m[Bch] === 1 && !!(await factAt(A, "Eyes")).op.ai_suggestion_id, "…and no AI fact is approved by it");

  // The owner posts a chapter after A: the facts at the story's first chapter and at A are approved; the other branches' are not.
  const posted = await call("POST", "/api/chapters", { choice_id: await choiceOf(A, "On"), title: "C", body: "Mira walked on.", summary: "s", choices: ["Next"] });
  ok(posted.status === 201, "the owner posts a chapter after A");
  m = await marks();
  ok(m[root] === undefined && m[A] === undefined, "the AI facts at Root and A are approved: " + JSON.stringify(m));
  ok(m[D] === 1 && m[Bch] === 1, "…while those on the other branches (D, and B beside the new chapter) still wait");
  const c = posted.json.chapter_id;
  const voice = await factAt(c, "Voice");
  ok(voice.text === "A low rasp." && !voice.op.ai_suggestion_id && !(await factAt(c, "Eyes")).op.ai_suggestion_id, "the facts are still there, no longer the AI's");
  ok(!!(await factAt(Bch, "Scent")).op.ai_suggestion_id, "a fact on the other branch is still the AI's");

  // The new chapter's own facts count from the next chapter on.
  ok((await read(c, "Gait", "Walked on briskly.", "Mira walked on")).json.applied === 1 && (await marks())[c] === 1, "the AI applies a fact at the new chapter");
  await call("POST", "/api/chapters", { choice_id: await choiceOf(c, "Next"), title: "C2", body: "More.", summary: "s" });
  m = await marks();
  ok(m[c] === undefined && m[D] === 1 && m[Bch] === 1, "…and the next chapter approves it too: " + JSON.stringify(m));
} finally {
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
