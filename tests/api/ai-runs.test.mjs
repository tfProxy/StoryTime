// AI runs: creating, claiming (one tab at a time), saving with versions, reviewing a level's plans, the "Written by AI"
// mark and marking it reviewed, and the context and subtree a run reads.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// A story: root with two choices; "Left" is written (with one choice), "Right" is open.
let r = await call("POST", "/api/stories", { title: "Runs tale", premise: "A premise", style: "Plain", chapter: { title: "Root", body: "root body", summary: "root sum", choices: ["Go left", "Go right"] } });
const { story_id: story, chapter_id: root } = r.json;
const [left, right] = (await call("GET", `/api/chapters/${root}`)).json.choices;
const leftCh = (await call("POST", "/api/chapters", { choice_id: left.id, title: "Left", body: "left body", choices: ["On"] })).json.chapter_id;
const other = (await call("POST", "/api/stories", { title: "Other", chapter: { title: "Other root", body: "x" } })).json;

const write = (id, extra = {}) => ({
  kind: "write", id, slot: { kind: "choice", choiceId: right.id }, label: "Go right", direction: "", depth: 1,
  choices: { given: [], suggest: 3 }, expand: false, status: "todo", ...extra,
});
const plan = (id, extra = {}) => ({ kind: "plan", id, chapterId: root, depth: 0, labels: ["Go right"], add: 0, status: "todo", ...extra });
const newRun = (extra = {}) => ({ story_id: story, start_chapter_id: root, mode: "fill", options: { endChoices: 3 }, tasks: [plan("t1"), write("t2", { plannedBy: "t1" })], ...extra });

// ---- creating and reading ----
r = await call("POST", "/api/ai-runs", newRun());
ok(r.status === 201 && typeof r.json.id === "string", "a run is created");
const run = r.json.id;
let got = (await call("GET", `/api/ai-runs/${run}`)).json;
ok(got.status === "ready" && got.version === 1 && got.mode === "fill" && got.story_id === story && got.start_chapter_id === root, "it starts ready, at version 1");
ok(got.tasks.length === 2 && got.tasks[1].plannedBy === "t1" && got.options.endChoices === 3 && got.leased === false && !("lease_token" in got), "…with its tasks and options, and no lease token in the answer");
ok((await call("GET", "/api/ai-runs/nope")).status === 404, "an unknown run is 404");
ok((await call("POST", "/api/ai-runs", newRun({ story_id: "nope" }))).status === 404, "a run for an unknown story is 404");
ok((await call("POST", "/api/ai-runs", newRun({ story_id: other.story_id }))).status === 404, "…and a start chapter from another story is 404");
ok((await call("POST", "/api/ai-runs", newRun({ mode: "bogus" }))).status === 400, "an unknown mode is 400");
ok((await call("POST", "/api/ai-runs", newRun({ start_chapter_id: null }))).status === 400, "a run with no start chapter is 400 unless it is for pictures");
ok((await call("POST", "/api/ai-runs", newRun({ start_chapter_id: null, mode: "pictures", tasks: [] }))).status === 201, "…a pictures run may be for the whole story");
ok((await call("POST", "/api/ai-runs", newRun({ tasks: [write("t1"), write("t1")] }))).status === 400, "two tasks with one id are 400");
ok((await call("POST", "/api/ai-runs", newRun({ tasks: [{ ...write("t1"), status: "weird" }] }))).status === 400, "a bad task status is 400");
const many = Array.from({ length: 201 }, (_, i) => write(`w${i}`));
ok((await call("POST", "/api/ai-runs", newRun({ tasks: many }))).status === 400, "more than 200 chapters is 400");
const plans = Array.from({ length: 300 }, (_, i) => plan(`p${i}`));
ok((await call("POST", "/api/ai-runs", newRun({ tasks: plans }))).status === 201, "…but plan tasks don't count as chapters");

// ---- listing ----
r = await call("GET", `/api/stories/${story}/ai-runs`);
const mine = r.json.runs.find((x) => x.id === run);
ok(r.status === 200 && mine && !("tasks" in mine) && mine.counts.todo === 2 && mine.counts.total === 2, "a story's runs list task counts, not tasks");
ok((await call("GET", `/api/stories/${story}/ai-runs?start=${leftCh}`)).json.runs.length === 0, "…narrowed by start chapter");
ok((await call("GET", `/api/stories/${story}/ai-runs?mode=pictures`)).json.runs.every((x) => x.mode === "pictures"), "…and by mode");
ok((await call("GET", `/api/stories/${story}/ai-runs?mode=bogus`)).status === 400 && (await call("GET", "/api/stories/nope/ai-runs")).status === 404, "a bad mode is 400 and an unknown story 404");

// ---- claiming, versions, the lease ----
const A = "token-aaaaaaaa", Bt = "token-bbbbbbbb";
r = await call("POST", `/api/ai-runs/${run}/claim`, { token: A });
ok(r.status === 200 && r.json.version === 1, "a tab claims the run");
ok((await call("POST", `/api/ai-runs/${run}/claim`, { token: Bt })).status === 409, "a second tab can't claim it while it is held");
ok((await call("POST", `/api/ai-runs/${run}/claim`, { token: A })).status === 200, "the holder can claim again");
ok((await call("GET", `/api/ai-runs/${run}`)).json.leased === true, "the run says it is held");
ok((await call("POST", `/api/ai-runs/${run}/claim`, { token: "x" })).status === 400, "a short token is 400");
const tasks1 = got.tasks.map((t) => (t.id === "t1" ? { ...t, status: "done", steps: [{ label: "Go right", direction: "Rain falls." }] } : t));
r = await call("PATCH", `/api/ai-runs/${run}`, { token: Bt, version: 1, tasks: tasks1 });
ok(r.status === 409, "a tab without the lease can't save");
r = await call("PATCH", `/api/ai-runs/${run}`, { token: A, version: 7, tasks: tasks1 });
ok(r.status === 409, "a stale version can't be saved");
r = await call("PATCH", `/api/ai-runs/${run}`, { token: A, version: 1, tasks: tasks1, status: "running" });
ok(r.status === 200 && r.json.version === 2 && r.json.status === "running" && r.json.tasks[0].status === "done" && r.json.tasks[0].steps[0].direction === "Rain falls.", "the holder saves tasks and status, which bumps the version");
ok((await call("PATCH", `/api/ai-runs/${run}`, { token: A, version: 2, status: "bogus" })).status === 400, "a bad status is 400");
ok((await call("PATCH", `/api/ai-runs/${run}`, { token: A, version: 2, tasks: [{ ...tasks1[0], kind: "nonsense" }] })).status === 400, "a bad task is 400");
r = await call("PATCH", `/api/ai-runs/${run}`, { token: A, version: 2, status: "paused", error: "stopped for the test" });
ok(r.status === 200 && r.json.leased === false && r.json.error === "stopped for the test" && r.json.finished_at === null, "pausing releases the lease");
ok((await call("POST", `/api/ai-runs/${run}/claim`, { token: Bt })).status === 200, "…so another tab can take it");
r = await call("PATCH", `/api/ai-runs/${run}`, { token: Bt, version: 3, status: "done" });
ok(r.status === 200 && typeof r.json.finished_at === "number" && r.json.leased === false, "done sets when it finished and releases the lease");

// ---- the lists the queue reads ----
const live = (await call("POST", "/api/ai-runs", newRun())).json.id;
await call("POST", `/api/ai-runs/${live}/claim`, { token: A });
await call("PATCH", `/api/ai-runs/${live}`, { token: A, version: 1, status: "queued" });
r = await call("GET", "/api/ai-runs?unfinished=1");
const unf = r.json.runs.find((x) => x.id === live);
ok(r.status === 200 && unf && unf.story_title === "Runs tale" && unf.start_title === "Root" && unf.counts.total === 2 && !("tasks" in unf), "unfinished lists a queued run with its story and start chapter titles and counts");
ok(unf.chapters.total === 1 && unf.chapters.done === 0, "…and how many chapters it writes (write tasks), and how many are done");
ok(!r.json.runs.some((x) => x.id === run), "…and leaves out a finished one");
ok(unf.leased === true, "…and says whether another tab holds it");
r = await call("GET", "/api/ai-runs?finished=1&limit=1");
ok(r.status === 200 && r.json.runs.length === 1 && r.json.runs[0].id === run && r.json.runs[0].story_title === "Runs tale", "finished lists a done run");
const stopped = (await call("POST", "/api/ai-runs", newRun())).json.id;
await call("POST", `/api/ai-runs/${stopped}/claim`, { token: A });
await call("PATCH", `/api/ai-runs/${stopped}`, { token: A, version: 1, status: "stopped" });
const walked = [];
for (let before = ""; ; ) {
  const page = (await call("GET", `/api/ai-runs?finished=1&limit=1${before}`)).json;
  walked.push(...page.runs.map((x) => x.id));
  if (page.next === null) break;
  before = `&before=${page.next}`;
}
ok(walked.includes(run) && walked.includes(stopped) && new Set(walked).size === walked.length, "finished runs (done and stopped) can be paged through");
ok((await call("GET", "/api/ai-runs?finished=1&limit=0")).status === 400 && (await call("GET", "/api/ai-runs")).status === 400, "a bad limit, or no list asked for, is 400");

// ---- reviewing a level's plans ----
const rv = (await call("POST", "/api/ai-runs", newRun({ tasks: [plan("p1", { status: "done" }), write("w1", { plannedBy: "p1", direction: "first" }), write("w2", { depth: 2, label: "Deeper" })] }))).json.id;
ok((await call("POST", `/api/ai-runs/${rv}/review`, { version: 1, tasks: [] })).status === 409, "a run not waiting for review can't be reviewed");
await call("POST", `/api/ai-runs/${rv}/claim`, { token: A });
await call("PATCH", `/api/ai-runs/${rv}`, { token: A, version: 1, status: "review", review_depth: 1 });
let rr = (await call("GET", `/api/ai-runs/${rv}`)).json;
ok(rr.status === "review" && rr.review_depth === 1 && rr.leased === false, "a run waiting for review has released its lease");
ok((await call("POST", `/api/ai-runs/${rv}/review`, { version: 1, tasks: [] })).status === 409, "a stale version can't review");
ok((await call("POST", `/api/ai-runs/${rv}/review`, { version: 2, tasks: [{ id: "w2", direction: "no" }] })).status === 400, "only chapters at the level being checked can be edited");
ok((await call("POST", `/api/ai-runs/${rv}/review`, { version: 2, tasks: [{ id: "p1", direction: "no" }] })).status === 400, "…and only chapters, not plan tasks");
r = await call("POST", `/api/ai-runs/${rv}/review`, { version: 2, tasks: [{ id: "w1", label: "Go right, quickly", direction: "Edited by the owner" }] });
ok(r.status === 200 && r.json.status === "queued" && r.json.review_depth === null, "reviewing puts the run back in the queue");
ok(r.json.tasks[1].direction === "Edited by the owner" && r.json.tasks[1].label === "Go right, quickly" && r.json.tasks[2].direction === "", "…with the owner's edits, and other tasks unchanged");
ok(r.json.options.reviewedDepths?.join() === "1", "…and the level noted as checked");
await call("POST", `/api/ai-runs/${rv}/claim`, { token: A });
await call("PATCH", `/api/ai-runs/${rv}`, { token: A, version: 3, status: "review", review_depth: 1 });
r = await call("POST", `/api/ai-runs/${rv}/review`, { version: 4, tasks: [{ id: "w1", remove: true }] });
ok(r.status === 200 && r.json.tasks[1].status === "skipped", "removing a chapter marks it skipped");

// ---- the AI mark ----
const aiCh = (await call("POST", "/api/chapters", { choice_id: right.id, title: "Right", body: "right body", ai_run_id: run, choices: ["Further"] }));
ok(aiCh.status === 201, "a chapter is posted by a run");
const rightCh = aiCh.json.chapter_id;
const markOf = async (id, fromTree = true) => {
  const tree = (await call("GET", `/api/chapters/${root}/subtree?depth=3`)).json;
  const find = (n) => (n.id === id ? n : n.choices.map((c) => c.child && find(c.child)).find(Boolean));
  return fromTree ? find(tree)?.ai : (await call("GET", `/api/chapters/${root}`)).json.choices.find((c) => c.child_chapter_id === id)?.child_ai;
};
ok((await markOf(rightCh)) === "unreviewed" && (await markOf(rightCh, false)) === "unreviewed", "it is unreviewed, in the subtree and in its parent's choices (child_ai)");
ok((await markOf(leftCh)) === null && (await markOf(leftCh, false)) === null && (await markOf(root)) === null, "a chapter the author wrote has no mark");
ok((await call("GET", `/api/chapters/${rightCh}`)).json.chapter.ai_run_id === run, "the chapter says which run wrote it");
ok((await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${rightCh}`)).json.choices[0].id, title: "X", body: "x", ai_run_id: "nope" })).status === 400, "an unknown ai_run_id is 400");
const otherRun = (await call("POST", "/api/ai-runs", { story_id: other.story_id, start_chapter_id: other.chapter_id, mode: "fill", options: {}, tasks: [] })).json.id;
ok((await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${rightCh}`)).json.choices[0].id, title: "X", body: "x", ai_run_id: otherRun })).status === 400, "…and so is a run of another story");
ok((await call("GET", `/api/chapters/${rightCh}`)).json.choices[0].child_chapter_id === null, "…and the refused chapter was not posted");

const further = (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${rightCh}`)).json.choices[0].id, title: "Further", body: "further", ai_run_id: run })).json.chapter_id;
const second = (await call("POST", "/api/chapters", { parent_chapter_id: leftCh, new_choice_label: "AI branch", title: "Second run", body: "s", ai_run_id: live })).json.chapter_id;
r = await call("POST", `/api/chapters/${rightCh}/reviewed`);
ok(r.status === 200 && r.json.marked === 1 && (await markOf(rightCh)) === "reviewed" && (await markOf(further)) === "unreviewed", "Mark reviewed marks one chapter");
ok((await call("POST", `/api/chapters/${rightCh}/reviewed`)).json.marked === 0, "…and marking it again changes nothing");
ok((await call("POST", `/api/chapters/${leftCh}/reviewed`)).json.marked === 0 && (await markOf(leftCh)) === null, "a chapter the author wrote isn't marked");
ok((await call("POST", "/api/chapters/nope/reviewed")).status === 404, "an unknown chapter is 404");
r = await call("POST", `/api/chapters/${further}/reviewed?path=1`);
ok(r.status === 200 && r.json.marked === 1 && (await markOf(further)) === "reviewed", "with path=1 it marks the AI chapters on the way (the earlier ones were done already)");
const deep = (await call("POST", "/api/chapters", { parent_chapter_id: further, new_choice_label: "More", title: "Deep", body: "d", ai_run_id: run })).json.chapter_id;
const mid = (await call("POST", "/api/chapters", { parent_chapter_id: second, new_choice_label: "More", title: "Below second", body: "b", ai_run_id: live })).json.chapter_id;
r = await call("POST", `/api/chapters/${mid}/reviewed?path=1`);
ok(r.json.marked === 2 && (await markOf(second)) === "reviewed" && (await markOf(mid)) === "reviewed" && (await markOf(deep)) === "unreviewed", "path=1 reaches every AI chapter on the way down to this one, and nothing else");
r = await call("POST", `/api/ai-runs/${run}/reviewed`);
ok(r.status === 200 && r.json.marked === 1 && (await markOf(deep)) === "reviewed", "a run's chapters are marked reviewed together (only those not marked yet)");
ok((await call("POST", "/api/ai-runs/nope/reviewed")).status === 404, "an unknown run is 404");

// ---- context and subtree ----
r = await call("GET", `/api/chapters/${rightCh}/context`);
ok(r.status === 200 && r.json.story.title === "Runs tale" && r.json.story.premise === "A premise" && r.json.story.style === "Plain" && r.json.story.id === story, "context has the story's header");
ok(r.json.path.map((c) => c.title).join() === "Root,Right" && r.json.path[0].body === "root body" && r.json.path[0].summary === "root sum" && "path_summary" in r.json.path[1] && r.json.path[1].revision === 1, "…the path from the start with bodies and summaries");
ok(Array.isArray(r.json.codex) && r.json.choices.length === 1 && r.json.choices[0].label === "Further", "…the codex and the chapter's choices");
ok((await call("GET", "/api/chapters/nope/context")).status === 404, "context of an unknown chapter is 404");

r = await call("GET", `/api/chapters/${root}/subtree`);
ok(r.status === 200 && r.json.id === root && r.json.depth === 0 && r.json.choices.length === 2, "subtree defaults to one level, from the chapter");
const lc = r.json.choices.find((c) => c.label === "Go left").child;
ok(lc && lc.depth === 1 && lc.choices.find((c) => c.label === "On")?.child === null && lc.choices.find((c) => c.label === "AI branch")?.child?.choices.length === 0, "…children at the limit list their choices, and their own children would be stubs");
const rc = r.json.choices.find((c) => c.label === "Go right").child;
ok(rc && rc.choices[0].child?.depth === 2 && rc.choices[0].child.choices.length === 0, "…a choice written below the limit shows as a stub, not as unwritten");
ok(r.json.choices.find((c) => c.label === "Go right").child?.id === rightCh, "…and a written choice shows its child");
r = await call("GET", `/api/chapters/${root}/subtree?depth=0`);
ok(r.json.choices.every((c) => c.child === null || c.child.choices.length === 0), "depth=0 is the chapter and stubs");
r = await call("GET", `/api/chapters/${rightCh}/subtree?depth=2`);
ok(r.json.id === rightCh && r.json.depth === 0 && r.json.choices[0].child?.depth === 1 && r.json.choices[0].child.choices[0].child?.depth === 2, "depths count from the chapter asked for, not from the story's start");
ok((await call("GET", `/api/chapters/${root}/subtree?depth=9`)).status === 400 && (await call("GET", `/api/chapters/${root}/subtree?depth=x`)).status === 400, "a bad depth is 400");
ok((await call("GET", "/api/chapters/nope/subtree")).status === 404, "an unknown chapter is 404");
const tree = (await call("GET", `/api/chapters/${root}/subtree?depth=8`)).json;
ok(tree.choices.length === 2, "the whole story can be read with depth 8");
