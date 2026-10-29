// The runner of AI runs, against a fake server (an in-memory story and run) and a fake AI that records every request.
import { claim, finish, retryTask, runNextStep, skipTask, type RunEvent } from "../../src/lib/aiRuns/runner.ts";
import { planArc, planFill, planTree, type PlanNode } from "../../src/lib/aiRuns/plan.ts";
import type { AiRun, RunOptions, RunTask, WriteTask } from "../../src/lib/aiRuns/types.ts";
import { SYSTEM_CHAPTER, SYSTEM_PLAN_STEPS } from "../../src/lib/ai/prompts.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

type Ch = { id: string; revision: number; depth: number; title: string; body: string; summary: string | null; path_summary: string | null; parent_choice_id: string | null; ai_run_id: string | null };
type Choice = { id: string; parent: string; label: string };

/** A fake StoryTime server holding one story and one run, speaking the routes the runner uses. */
function makeServer(opts: { options: RunOptions; open: string[]; written?: string[]; tree?: boolean; tasks?: (rootId: string) => RunTask[] }) {
  const chapters = new Map<string, Ch>();
  const choices: Choice[] = [];
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const addCh = (title: string, depth: number, parent_choice_id: string | null, ai_run_id: string | null = null): Ch => {
    const c: Ch = { id: id("ch"), revision: 1, depth, title, body: `${title} body`, summary: null, path_summary: null, parent_choice_id, ai_run_id };
    chapters.set(c.id, c);
    return c;
  };
  const addChoice = (parent: string, label: string) => { const c = { id: id("cx"), parent, label }; choices.push(c); return c; };
  const root = addCh("Root", 0, null);
  root.summary = "root sum"; root.path_summary = "root path";
  const open = opts.open.map((label) => addChoice(root.id, label));
  const pre: Record<string, string> = {};
  for (const label of opts.written ?? []) {
    const c = addChoice(root.id, label);
    pre[label] = addCh(`Already ${label}`, 1, c.id).id;
  }
  const childOf = (choiceId: string) => [...chapters.values()].find((c) => c.parent_choice_id === choiceId);
  const pathOf = (chId: string): Ch[] => {
    const out: Ch[] = [];
    for (let c: Ch | undefined = chapters.get(chId); c; ) {
      out.unshift(c);
      const ch = c.parent_choice_id ? choices.find((x) => x.id === c!.parent_choice_id) : undefined;
      c = ch ? chapters.get(ch.parent) : undefined;
    }
    return out;
  };
  const images = new Set<string>();
  /** Chapters moved to the trash while the run waited. */
  const trashed = new Set<string>();
  const pictureDrafts: { chapterId: string; prompt: string; negative: string; scene: string; moment: string }[] = [];
  const log = { posts: [] as { body: any }[], summaries: [] as { id: string; summary: string }[], choiceAdds: [] as string[], patches: 0 };
  const tree = (c: Ch): PlanNode => ({ id: c.id, depth: c.depth, choices: choices.filter((x) => x.parent === c.id).map((x) => ({ id: x.id, label: x.label, child: childOf(x.id) ? tree(childOf(x.id)!) : null })) });

  const state = {
    run: null as AiRun | null,
    token: null as string | null,
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    let m: RegExpMatchArray | null;
    if ((m = url.match(/^\/api\/chapters\/([^/]+)\/context$/))) {
      const path = pathOf(m[1]);
      if (!path.length) return reply(404, { error: "Not found" });
      return reply(200, {
        story: { id: "s1", title: "Tale", premise: "A premise", style: "" },
        path: path.map(({ id, revision, depth, title, body, summary, path_summary }) => ({ id, revision, depth, title, body, summary, path_summary })),
        codex: [],
        choices: choices.filter((c) => c.parent === m![1]).map((c) => ({ id: c.id, label: c.label, child_chapter_id: childOf(c.id)?.id ?? null })),
        trashed: trashed.has(m[1]),
      });
    }
    if (url === "/api/chapters" && method === "POST") {
      log.posts.push({ body });
      let choiceId = body.choice_id as string | undefined;
      if (!choiceId) choiceId = addChoice(body.parent_chapter_id, body.new_choice_label).id;
      if (childOf(choiceId)) return reply(409, { error: "A chapter is already written for that choice" });
      const parent = chapters.get(choices.find((c) => c.id === choiceId)!.parent)!;
      const c = addCh(body.title, parent.depth + 1, choiceId, body.ai_run_id ?? null);
      c.body = body.body; c.summary = body.summary ?? null; c.path_summary = body.path_summary ?? null;
      const ids = (body.choices as string[]).map((l) => addChoice(c.id, l).id);
      return reply(201, { story_id: "s1", chapter_id: c.id, choice_ids: ids });
    }
    if ((m = url.match(/^\/api\/chapters\/([^/]+)\/choices$/)) && method === "POST") {
      log.choiceAdds.push(body.label);
      addChoice(m[1], body.label);
      return reply(201, { ok: true });
    }
    if ((m = url.match(/^\/api\/chapters\/([^/]+)\/summary$/)) && method === "PUT") {
      const c = chapters.get(m[1])!;
      c.summary = body.summary; c.path_summary = body.path_summary;
      log.summaries.push({ id: c.id, summary: body.summary });
      return reply(200, { ok: true });
    }
    if ((m = url.match(/^\/api\/ai-runs\/([^/]+)\/claim$/))) {
      if (state.token && state.token !== body.token) return reply(409, { error: "This run is going in another tab or browser." });
      state.token = body.token;
      return reply(200, { version: state.run!.version });
    }
    if ((m = url.match(/^\/api\/ai-runs\/([^/]+)$/))) {
      if (method === "GET") return reply(200, JSON.parse(JSON.stringify(state.run)));
      if (state.token !== body.token) return reply(409, { error: "This run is going in another tab or browser." });
      if (body.version !== state.run!.version) return reply(409, { error: "This run changed elsewhere; reload it." });
      const { token, version, ...change } = body;
      void token; void version;
      state.run = { ...state.run!, ...JSON.parse(JSON.stringify(change)), version: state.run!.version + 1 };
      if (["review", "paused", "done", "stopped"].includes(state.run!.status)) state.token = null;
      return reply(200, JSON.parse(JSON.stringify(state.run)));
    }
    if (url === "/api/stories/s1") return reply(200, { id: "s1", title: "Tale", premise: "A premise", art_style: "", draw_preset: null, style_ref: null });
    if ((m = url.match(/^\/api\/chapters\/([^/]+)\/picture-preset$/))) return reply(200, { draw_preset: null });
    if ((m = url.match(/^\/api\/chapters\/([^/]+)\/picture-fixed$/))) return reply(200, { fixed: "" });
    if ((m = url.match(/^\/api\/chapters\/([^/]+)\/picture-draft$/)) && method === "PUT") {
      pictureDrafts.push({ chapterId: m[1], ...body });
      return reply(200, { ok: true });
    }
    if ((m = url.match(/^\/api\/chapters\/([^/]+)\/images\/(header|footer)$/)) && method === "HEAD") return new Response(null, { status: images.has(`${m[1]}:${m[2]}`) ? 200 : 404 });
    return reply(404, { error: `unexpected ${method} ${url}` });
  };

  const runId = "run1";
  state.run = {
    id: runId, story_id: "s1", start_chapter_id: root.id, mode: opts.tasks ? "arc" : opts.tree ? "tree" : "fill", options: opts.options, tasks: opts.tasks ? opts.tasks(root.id) : opts.tree ? planTree(tree(root), opts.options) : planFill(tree(root), { scope: "children", endChoices: 2, ...opts.options }),
    status: "ready", review_depth: null, error: null, version: 1, finished_at: null, created_at: 1, updated_at: 1,
  };
  return { fetch: fetchFake, state, chapters, choices, log, root, open, pre, childOf, runId, tree, addCh, addChoice, images, pictureDrafts, trashed };
}

type Call = { kind: "chapter" | "plan" | "summary"; role?: string; model?: string; message: string };

/** A fake AI. `failChapter` makes every chapter request fail. */
function makeAi(opts: { failChapter?: boolean } = {}) {
  const calls: Call[] = [];
  let k = 0;
  async function* stream(_settings: unknown, req: any): AsyncGenerator<string> {
    const message = req.messages[0].content as string;
    const kind: Call["kind"] = req.system === SYSTEM_CHAPTER ? "chapter" : req.system === SYSTEM_PLAN_STEPS ? "plan" : "summary";
    calls.push({ kind, role: req.role, model: req.model?.model, message });
    if (kind === "chapter") {
      if (opts.failChapter) throw new Error("the model is down");
      yield `# Chapter ${++k}\n\n`;
      yield `Text of chapter ${k}.`;
    } else if (kind === "plan") {
      const given = [...(message.match(/These choices are offered at its end: ([^\n]*?)\.\n/)?.[1].matchAll(/“([^”]+)”/g) ?? [])].map((x) => x[1]);
      const add = Number(message.match(/uggest (\d+) new choice/)?.[1] ?? 0);
      const items = [...given.map((c) => ({ choice: c, direction: `plan for ${c}` })), ...Array.from({ length: add }, (_, i) => ({ choice: `Then ${k}-${i + 1}`, direction: `plan for new ${i + 1}` }))];
      yield JSON.stringify(items);
    } else {
      yield "SUMMARY:\nA short summary.\nSTORY SO FAR:\nThe story so far.";
    }
  }
  return { stream, calls };
}

const settings = { ...DEFAULT_SETTINGS };
const BIG = { connectionId: "c", model: "big" };
const SMALL = { connectionId: "c", model: "small" };
const token = "token-0123456789";

async function drive(server: ReturnType<typeof makeServer>, ai: ReturnType<typeof makeAi>, max = 40) {
  const events: RunEvent[] = [];
  let run = await claim(server.runId, token, { fetch: server.fetch });
  let steps = 0;
  for (; steps < max; steps++) {
    const r = await runNextStep(run, { settings, token, onEvent: (e) => events.push(e), deps: { fetch: server.fetch, stream: ai.stream as any, renewMs: 1e9 } });
    run = r.run;
    if (!r.more) break;
  }
  return { run, events, steps: steps + 1 };
}

// ---- one chapter at a time ("each") ----
{
  const s = makeServer({ options: { models: "each", endChoices: 2, model: BIG, suggestModel: SMALL, guidance: "Keep it light." }, open: ["Go left", "Go right"] });
  const ai = makeAi();
  const { run, events } = await drive(s, ai);
  ok(run.status === "done" && run.tasks.every((t) => t.status === "done"), "a fill run writes every open choice and ends done");
  ok(s.log.posts.length === 2 && s.log.posts.every((p) => p.body.ai_run_id === "run1"), "two chapters were posted, each marked with the run");
  ok(s.log.posts.map((p) => p.body.choice_id).join() === s.open.map((c) => c.id).join(), "…into the open choices, in order");
  const chapterPrompts = ai.calls.filter((c) => c.kind === "chapter");
  ok(chapterPrompts[0].message.includes("plan for Go left") && chapterPrompts[1].message.includes("plan for Go right"), "each chapter's prompt has the direction the plan made for it");
  ok(chapterPrompts[0].message.includes("Keep it light."), "…and the run's guidance");
  ok(s.log.posts.every((p) => p.body.choices.length === 2 && p.body.summary === "A short summary." && p.body.path_summary === "The story so far."), "…each posted with two suggested choices and its summaries");
  ok(ai.calls.filter((c) => c.kind === "chapter").every((c) => c.role === "main" && c.model === "big") && ai.calls.filter((c) => c.kind !== "chapter").every((c) => c.role === "cheap" && c.model === "small"), "chapters use the writing model, planning and summaries the cheaper one");
  ok(events.some((e) => e.type === "text" && e.text.includes("Text of chapter")) && events.some((e) => e.type === "taskDone") && events.at(-1)?.type === "state", "events report the text, finished tasks and the end");
  const t = run.tasks.find((x): x is WriteTask => x.kind === "write")!;
  ok(t.chapterId && t.choiceIds?.length === 2 && t.planned?.length === 2 && t.planned[0].direction.startsWith("plan for"), "a task keeps its chapter, choice ids and the plans for its choices");
  ok(s.state.token === null, "a finished run has released its lease");
}

// ---- no second chapter after a crash ----
{
  const s = makeServer({ options: { models: "each", endChoices: 0 }, open: ["Only"] });
  // The chapter was posted, but the run still says todo.
  const task = s.state.run!.tasks.find((t) => t.kind === "write") as WriteTask;
  const prior = s.addCh("Posted before the crash", 1, (task.slot as { choiceId: string }).choiceId, "run1");
  const ai = makeAi();
  const { run } = await drive(s, ai);
  const done = run.tasks.find((t) => t.kind === "write") as WriteTask;
  ok(s.log.posts.length === 0 && ai.calls.filter((c) => c.kind === "chapter").length === 0, "a choice that already has its chapter isn't written or posted again");
  ok(done.status === "done" && done.chapterId === prior.id && run.status === "done", "…the task is done with that chapter");
}

// ---- a 409 on posting counts as done ----
{
  const s = makeServer({ options: { models: "each", endChoices: 0 }, open: ["Raced"] });
  const task = s.state.run!.tasks.find((t) => t.kind === "write") as WriteTask;
  const ai = makeAi();
  const realStream = ai.stream;
  // Somebody writes the chapter while the model is writing.
  const racing = async function* (st: unknown, req: any) { if (req.system === SYSTEM_CHAPTER) s.addCh("By the author", 1, (task.slot as { choiceId: string }).choiceId); yield* realStream(st, req); };
  const events: RunEvent[] = [];
  let run = await claim(s.runId, token, { fetch: s.fetch });
  for (let i = 0; i < 10; i++) { const r = await runNextStep(run, { settings, token, onEvent: (e) => events.push(e), deps: { fetch: s.fetch, stream: racing as any, renewMs: 1e9 } }); run = r.run; if (!r.more) break; }
  ok(run.status === "done" && (run.tasks.find((t) => t.kind === "write") as WriteTask).status === "done", "a chapter written by someone else meanwhile (409) counts as done");
}

// ---- a failing AI call pauses the run ----
{
  const s = makeServer({ options: { models: "each", endChoices: 0 }, open: ["A", "B"] });
  const ai = makeAi({ failChapter: true });
  const { run, events } = await drive(s, ai);
  const first = run.tasks.find((t) => t.kind === "write") as WriteTask;
  ok(run.status === "paused" && first.status === "failed" && first.error === "the model is down" && run.error === "the model is down", "a task that fails twice is failed and pauses the run");
  ok(ai.calls.filter((c) => c.kind === "chapter").length === 2, "…after one more try");
  ok(events.some((e) => e.type === "error") && events.at(-1)?.type === "state", "…and says so");
  ok(s.state.token === null && s.log.posts.length === 0, "the lease is released and nothing was posted");
  // Retry it with the AI back.
  const again = await retryTask(s.runId, first.id, token, { fetch: s.fetch });
  ok((again.tasks.find((t) => t.id === first.id) as WriteTask).status === "todo" && again.status === "paused", "Retry puts the failed task back to todo");
  const ai2 = makeAi();
  const resumed = await drive(s, ai2);
  ok(resumed.run.status === "done" && s.log.posts.length === 2, "…and the run goes on to the end");
}

// ---- a skipped task ----
{
  const s = makeServer({ options: { models: "each", endChoices: 0 }, open: ["A", "B"] });
  const ids = s.state.run!.tasks.filter((t) => t.kind === "write").map((t) => t.id);
  await skipTask(s.runId, ids[0], token, { fetch: s.fetch });
  const { run } = await drive(s, makeAi());
  ok(run.status === "done" && s.log.posts.length === 1 && (run.tasks.find((t) => t.id === ids[0]) as WriteTask).status === "skipped", "a skipped task isn't written, the others are");
}

// ---- a chapter moved to the trash while the run waited ----
{
  const s = makeServer({ options: { models: "each", endChoices: 0 }, open: ["A", "B"] });
  s.trashed.add(s.root.id);
  const { run } = await drive(s, makeAi());
  const writes = run.tasks.filter((t) => t.kind === "write") as WriteTask[];
  const planTask = run.tasks.find((t) => t.kind === "plan");
  ok(run.status === "done" && s.log.posts.length === 0 && writes.length === 2 && writes.every((t) => t.status === "skipped") && planTask?.status === "skipped" && /trash/i.test(planTask.error ?? ""), "tasks below a trashed chapter are skipped, nothing is posted, and the run finishes");
}

// ---- Stop (abort) pauses ----
{
  const s = makeServer({ options: { models: "each", endChoices: 0 }, open: ["A"] });
  const ctl = new AbortController();
  const ai = makeAi();
  const slow = async function* (st: unknown, req: any) { ctl.abort(); yield* ai.stream(st, req); };
  const run = await claim(s.runId, token, { fetch: s.fetch });
  const r = await runNextStep(run, { settings, token, signal: ctl.signal, deps: { fetch: s.fetch, stream: slow as any, renewMs: 1e9 } });
  ok(!r.more && r.run.status === "paused" && s.log.posts.length === 0 && r.run.tasks.every((t) => t.status === "todo" || t.kind === "plan"), "stopping pauses the run and posts nothing");
}

// ---- group by model: main, main, then cheap ----
{
  const s = makeServer({ options: { models: "group", endChoices: 2, model: BIG, suggestModel: SMALL }, open: ["A", "B"] });
  const ai = makeAi();
  const { run } = await drive(s, ai);
  const seq = ai.calls.map((c) => `${c.kind}:${c.model}`);
  ok(seq.join() === "plan:small,chapter:big,chapter:big,summary:small,plan:small,summary:small,plan:small", "requests go plan (cheap), then both chapters (main), then each chapter's summary and choices (cheap): " + seq.join());
  ok(run.status === "done" && run.tasks.every((t) => t.status === "done"), "…and every task ends done");
  ok(s.log.posts.every((p) => p.body.choices.length === 0 && p.body.summary === undefined), "chapters are posted without suggested choices or summaries");
  ok(s.log.summaries.length === 2 && s.log.choiceAdds.length === 4, "…which are added after: summaries saved, " + s.log.choiceAdds.length + " choices added");
  ok([...s.chapters.values()].filter((c) => c.ai_run_id).every((c) => c.summary === "A short summary."), "…and each chapter ends with its summary");
}

// ---- "use the writing model for everything" ----
{
  const s = makeServer({ options: { models: "writing", endChoices: 1, model: BIG, suggestModel: SMALL }, open: ["A", "B"] });
  const ai = makeAi();
  await drive(s, ai);
  ok(ai.calls.length > 0 && ai.calls.every((c) => c.role === "main" && c.model === "big"), "with the writing model for everything every request uses it");
}

// ---- a written task after a reload gets its summaries and choices, not a second chapter ----
{
  const s = makeServer({ options: { models: "group", endChoices: 2, model: BIG, suggestModel: SMALL }, open: ["A"] });
  const ai = makeAi();
  // Run the plan and the write only.
  let run = await claim(s.runId, token, { fetch: s.fetch });
  for (let i = 0; i < 2; i++) run = (await runNextStep(run, { settings, token, deps: { fetch: s.fetch, stream: ai.stream as any, renewMs: 1e9 } })).run;
  const t = run.tasks.find((x) => x.kind === "write") as WriteTask;
  ok(t.status === "written" && !!t.chapterId && s.log.posts.length === 1, "after the plan and the text the task is written");
  // The tab goes away; another one picks the run up.
  s.state.token = null;
  const before = s.log.posts.length;
  const ai2 = makeAi();
  const { run: end } = await drive(s, ai2);
  ok(s.log.posts.length === before && ai2.calls.filter((c) => c.kind === "chapter").length === 0, "the chapter is not written or posted again");
  ok(end.status === "done" && ai2.calls.map((c) => c.kind).join() === "summary,plan", "…its summary and choices are made (summary first, then the planned choices)");
  ok(s.chapters.get(t.chapterId!)!.summary === "A short summary." && s.choices.filter((c) => c.parent === t.chapterId).length === 2, "…and they are saved");
}

// ---- checking the plan first (D23) ----
{
  const s = makeServer({ options: { models: "each", endChoices: 0, reviewPlan: true }, open: ["A", "B"] });
  const ai = makeAi();
  let run = await claim(s.runId, token, { fetch: s.fetch });
  const r1 = await runNextStep(run, { settings, token, deps: { fetch: s.fetch, stream: ai.stream as any, renewMs: 1e9 } });
  ok(r1.more && r1.run.status === "running", "the plan step runs first");
  const r2 = await runNextStep(r1.run, { settings, token, deps: { fetch: s.fetch, stream: ai.stream as any, renewMs: 1e9 } });
  ok(!r2.more && r2.run.status === "review" && r2.run.review_depth === 1 && ai.calls.filter((c) => c.kind === "chapter").length === 0, "then the run stops in review at that depth, before any chapter is written");
  ok(s.state.token === null, "…and has released its lease");
  // The owner edits a direction and continues (what POST /api/ai-runs/<id>/review does).
  const edited = r2.run.tasks.map((t) => (t.kind === "write" && t.label === "A" ? { ...t, direction: "The owner's own direction" } : t)) as RunTask[];
  s.state.run = { ...r2.run, tasks: edited, status: "queued", review_depth: null, options: { ...r2.run.options, reviewedDepths: [1] }, version: r2.run.version + 1 };
  const { run: end } = await drive(s, ai);
  const prompts = ai.calls.filter((c) => c.kind === "chapter").map((c) => c.message);
  ok(end.status === "done" && prompts.length === 2, "after the review the run goes on to the end");
  ok(prompts[0].includes("The owner's own direction") && !prompts[0].includes("plan for A") && prompts[1].includes("plan for B"), "…using the edited direction, and the plan's for the one not edited");
}

// ---- a second tab can't take a run that is going ----
{
  const s = makeServer({ options: { models: "each" }, open: ["A"] });
  await claim(s.runId, token, { fetch: s.fetch });
  let refused = 0;
  try { await claim(s.runId, "another-token-999", { fetch: s.fetch }); } catch (e: any) { refused = e.status; }
  ok(refused === 409, "claiming a run another tab holds is refused (409)");
  const run = await claim(s.runId, token, { fetch: s.fetch });
  const stopped = await finish(run, "stopped", token, { fetch: s.fetch });
  ok(stopped.status === "stopped" && s.state.token === null, "finish ends the run and releases the lease");
}

// ---- Grow the tree ----
for (const models of ["each", "group"] as const) {
  const s = makeServer({ options: { models, maxDepth: 2, breadth: 2, endChoices: 1, model: BIG, suggestModel: SMALL }, open: [], tree: true });
  const ai = makeAi();
  const { run } = await drive(s, ai, 200);
  const writes = run.tasks.filter((t): t is WriteTask => t.kind === "write");
  ok(run.status === "done" && writes.length === 6 && writes.every((t) => t.status === "done"), `${models}: depth 2 and breadth 2 from a bare chapter writes 6 chapters, adding the tasks as the chapters appear`);
  ok(s.log.posts.length === 6 && s.log.posts.every((p) => p.body.ai_run_id === "run1"), `${models}: each posted as AI-written`);
  const top = [...s.chapters.values()].filter((c) => c.depth === 1).length;
  const second = [...s.chapters.values()].filter((c) => c.depth === 2).length;
  ok(s.choices.filter((c) => c.parent === s.root.id).length === 2 && top === 2 && second === 4, `${models}: two choices on the start chapter, two chapters under them, four under those (${top}, ${second})`);
  const chapterPrompts = ai.calls.filter((c) => c.kind === "chapter").map((c) => c.message);
  ok(chapterPrompts.filter((m) => m.includes("plan for")).length >= 2, `${models}: chapters are written from the plan made with their parent's choices`);
  ok(writes.filter((t) => t.depth === 2).every((t) => t.choices.suggest === 1) && writes.filter((t) => t.depth === 1).every((t) => t.choices.suggest === 2), `${models}: the last level's chapters suggest the end choices, the level above `+"breadth");
  ok([...s.chapters.values()].filter((c) => c.depth === 2).every((c) => s.choices.filter((x) => x.parent === c.id).length === 1), `${models}: the last chapters end with the end choices`);
}

// Keeps what is there: an open choice and a written one on the start chapter.
{
  const s = makeServer({ options: { models: "each", maxDepth: 1, breadth: 3, endChoices: 0 }, open: ["Open one"], written: ["Done already"], tree: true });
  const { run } = await drive(s, makeAi(), 60);
  ok(run.status === "done" && s.log.posts.length === 2 && s.choices.filter((c) => c.parent === s.root.id).length === 3, "tree: keeps the written chapter, writes the open choice and adds what is missing up to breadth");
  ok(s.chapters.get(s.pre["Done already"])!.ai_run_id === null, "…the chapter that was there is not touched");
}

// Over the limit: the run stops with a message instead of growing without end.
{
  const s = makeServer({ options: { models: "each", maxDepth: 4, breadth: 6, endChoices: 0 }, open: [], tree: true });
  const { run } = await drive(s, makeAi(), 900);
  const count = run.tasks.filter((t) => t.kind === "write").length;
  ok(run.status === "paused" && /more than|past 200|200 chapters/i.test(run.error ?? "") && count <= 200, `tree: a run that would pass 200 chapters pauses with a message (${count} chapters planned): ${run.error}`);
  ok(s.log.posts.length <= 200 && s.log.posts.length > 30, "…after writing chapters up to there: " + s.log.posts.length);
}

// ---- Reach a goal ----
for (const models of ["each", "group"] as const) {
  const steps = [{ choice: "Follow the stranger", direction: "She meets the stranger." }, { choice: "Take the tunnel", direction: "They go underground." }, { choice: "Open the vault", direction: "The vault opens." }];
  const options: RunOptions = { models, objective: "The heroes find the vault", alternatives: 1, endChoices: 1, model: BIG, suggestModel: SMALL };
  const s = makeServer({ options, open: [], tasks: (rootId) => planArc(rootId, steps, options) });
  const ai = makeAi();
  const { run } = await drive(s, ai, 100);
  ok(run.status === "done" && s.log.posts.length === 3, `${models}: a goal in 3 chapters writes a chain of 3`);
  const chain = [...s.chapters.values()].filter((c) => c.ai_run_id).sort((a, b) => a.depth - b.depth);
  const parentOf = (c: (typeof chain)[number]) => s.choices.find((x) => x.id === c.parent_choice_id)!;
  ok(chain.length === 3 && parentOf(chain[0]).parent === s.root.id && parentOf(chain[1]).parent === chain[0].id && parentOf(chain[2]).parent === chain[1].id, `${models}: the first under the start chapter, each next under the one before`);
  ok(parentOf(chain[0]).label === "Follow the stranger" && parentOf(chain[1]).label === "Take the tunnel" && parentOf(chain[2]).label === "Open the vault", `${models}: each reached by its step's choice`);
  const prompts = ai.calls.filter((c) => c.kind === "chapter").map((c) => c.message);
  ok(prompts[0].includes("part 1 of 3") && prompts[1].includes("part 2 of 3") && prompts[2].includes("This chapter reaches that goal."), `${models}: each chapter is written from its place in the chain`);
  ok(s.choices.filter((c) => c.parent === chain[0].id)[0].label === "Take the tunnel" && s.choices.filter((c) => c.parent === chain[0].id).length === 2, `${models}: a chapter's first choice is the next step, with one more suggested`);
  ok(s.choices.filter((c) => c.parent === chain[2].id).length === 1, `${models}: the last chapter gets the end choices`);
}

// ---- Fill missing pictures: the prompt step ----
{
  const s = makeServer({ options: { slots: "both", suggestModel: SMALL }, open: [], tasks: () => [] });
  const c2 = s.addCh("Second", 1, null), c3 = s.addCh("Third", 1, null);
  const mk = (id: string, chapterId: string, slot: "header" | "footer", label: string): RunTask => ({ kind: "picture", id, chapterId, slot, label, status: "todo" });
  s.state.run = { ...s.state.run!, mode: "pictures", start_chapter_id: null, options: { slots: "both", suggestModel: SMALL }, tasks: [mk("t1", s.root.id, "header", "Root"), mk("t2", c2.id, "header", "Second"), mk("t3", c3.id, "header", "Third"), mk("t4", c3.id, "footer", "Third")] };
  s.images.add(`${c3.id}:header`);
  const written: string[] = [];
  const writePrompt = async (_s: unknown, o: any) => { written.push(`${o.moment}:${o.model?.model}`); return { scene: `Scene ${written.length}`, prompt: `prompt ${written.length}`, negative: "neg" }; };
  const deps = { fetch: s.fetch, stream: makeAi().stream as any, renewMs: 1e9, writePrompt: writePrompt as any };
  let run = await claim(s.runId, token, { fetch: s.fetch });
  let r = await runNextStep(run, { settings, token, deps });
  ok(r.more && !r.idle && r.run.tasks[0].status === "written" && (r.run.tasks[0] as any).prompt === "prompt 1" && (r.run.tasks[0] as any).negative === "neg", "a picture task's prompt is written and kept on the task; it is then `written`");
  ok(s.pictureDrafts.length === 1 && s.pictureDrafts[0].chapterId === s.root.id && s.pictureDrafts[0].prompt === "prompt 1" && s.pictureDrafts[0].scene === "Scene 1" && s.pictureDrafts[0].moment === "start", "…and saved as that moment's prompt boxes for the Illustrate page");
  ok(written[0] === "start:small", "…written with the model for prompts, for the chapter's start (a header)");
  r = await runNextStep(r.run, { settings, token, deps });
  ok(r.more && r.run.tasks[1].status === "written" && written.length === 2, "every prompt is written before any picture is drawn: the second one follows at once");
  r = await runNextStep(r.run, { settings, token, deps });
  ok(r.run.tasks[2].status === "done" && (r.run.tasks[2] as any).prompt === undefined && written.length === 2, "a slot that has its picture by now is done without a prompt");
  r = await runNextStep(r.run, { settings, token, deps });
  ok(r.run.tasks[3].status === "written" && (r.run.tasks[3] as any).prompt === "prompt 3" && written[2] === "end:small", "…and a footer's prompt is for the chapter's end");
  r = await runNextStep(r.run, { settings, token, deps });
  ok(r.idle === true && !r.more && r.run.status === "running", "with every prompt written the run is idle, waiting for the pictures, not paused");
  ok(written.length === 3, "…and no prompt is written twice");
  // The run is done when every picture is.
  const all = { ...r.run, tasks: r.run.tasks.map((t) => ({ ...t, status: "done" as const })) } as AiRun;
  s.state.run = { ...all, version: all.version + 1 };
  run = await claim(s.runId, token, { fetch: s.fetch });
  r = await runNextStep(run, { settings, token, deps });
  ok(!r.more && r.run.status === "done", "with every picture done the run ends done");
}
{
  // A failing prompt is tried once more, then the run pauses with the error.
  const s = makeServer({ options: { slots: "header" }, open: [], tasks: () => [] });
  s.state.run = { ...s.state.run!, mode: "pictures", start_chapter_id: null, tasks: [{ kind: "picture", id: "t1", chapterId: s.root.id, slot: "header", label: "Root", status: "todo" }] };
  let tries = 0;
  const deps = { fetch: s.fetch, stream: makeAi().stream as any, renewMs: 1e9, writePrompt: (async () => { tries++; throw new Error("the model is down"); }) as any };
  const run = await claim(s.runId, token, { fetch: s.fetch });
  const r = await runNextStep(run, { settings, token, deps });
  ok(tries === 2 && r.run.status === "paused" && (r.run.tasks[0] as any).status === "failed" && r.run.error === "the model is down", "a prompt that fails twice fails the task and pauses the run");
}
