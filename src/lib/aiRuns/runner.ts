// The runner of AI runs. It works one step at a time and saves the run after each, so the work queue (task 1.4)
// can put other work in between and give the machine to pictures. A step is one request or a short run of them:
// plan the choices of a chapter, write a chapter, or finish a chapter that was written without its summaries and
// choices. The AI and ComfyUI are called from the browser; the run lives on the server (`src/lib/aiRuns.ts`).
import type { Settings } from "../settingsSchema";
import {
  addChoice,
  ApiError,
  claimRunLease,
  getChapterCodex,
  getChapterTags,
  getAllChapterTags,
  getContext,
  getPathFacts,
  getRun,
  getStoryTags,
  getVerdicts,
  patchRun,
  postChapter,
  postCodexSuggestions,
  postFacts,
  postVerdict,
  postSummaryCheck,
  postTagSuggestions,
  putSummary,
  type ChapterContext,
  type Fetch,
  type NewChapter,
} from "./api";
import { LIMITS } from "../limits";
import { applyPlan, expandAfter, needsReview, nextTask, resolveSlot, withGuidance } from "./plan";
import type { writeImagePrompt } from "../ai/imagePrompt";
import { hasPicture, loadSetup, writePicturePrompt } from "./pictures";
import type { AiRun, CodexTask, ContinuityTask, FactsTask, PictureTask, PlanTask, RunStatus, RunTask, SummaryTask, TagsTask, WriteTask } from "./types";
import { runCodexCheck, selectEntries } from "../ai/codexCheckAi";
import { extractFacts, judgeConflict } from "../ai/factAi";
import { summaryCheck } from "../ai/summaryCheckAi";
import { CHANGE_EVENT_TAGS, continuityFingerprint, findConflicts, type Conflict } from "../continuity";
import { suggestTagsForChapter } from "../ai/tagAi";
import { planNext, storyContextOf, summarize, withPathSummaries, writeOneChapter, writeText, type PlannedChoice, type Stream } from "./writeChapter";

/** How often a run renews its lease while a step works (the server lets it lapse after two minutes). */
export const RENEW_MS = 30_000;

export type RunEvent =
  | { type: "task"; taskId: string; label: string; phase: "planning" | "writing" | "finishing" }
  | { type: "text"; taskId: string; text: string }
  | { type: "status"; text: string }
  | { type: "taskDone"; taskId: string }
  | { type: "state"; status: RunStatus; error?: string }
  | { type: "error"; taskId: string; message: string };

export type RunnerDeps = { fetch?: Fetch; stream?: Stream; renewMs?: number; writePrompt?: typeof writeImagePrompt };

/**
 * What a step did: the run as saved, and whether another step can follow. `idle`: nothing more can be written for now
 * but the run isn't over, because it is waiting for pictures to be drawn (Fill missing pictures); the queue takes it up
 * again when one is done.
 */
export type StepResult = { run: AiRun; more: boolean; idle?: boolean };

export type StepEnv = {
  settings: Settings;
  /** This tab's lease token: made by the caller, and the one it claimed the run with. */
  token: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  deps?: RunnerDeps;
};

const fetcher = (deps?: RunnerDeps): Fetch => deps?.fetch ?? ((input, init) => fetch(input, init));
const norm = (s: string) => s.toLowerCase().replace(/[\s"'“”‘’.!?]+/g, " ").trim();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const unfinished = (t: RunTask) => t.status === "todo" || t.status === "written";
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Takes the run's lease for this tab and returns the run. Throws an `ApiError` with status 409 when another tab has it. */
export async function claim(runId: string, token: string, deps?: RunnerDeps): Promise<AiRun> {
  const f = fetcher(deps);
  await claimRunLease(f, runId, token);
  return getRun(f, runId);
}

/** Ends the run (or pauses it, or sets it aside): saves the status and releases the lease. */
export async function finish(run: AiRun, status: Extract<RunStatus, "done" | "stopped" | "paused" | "queued">, token: string, deps?: RunnerDeps, error?: string | null): Promise<AiRun> {
  return patchRun(fetcher(deps), run.id, { token, version: run.version, status, ...(error !== undefined && { error }) });
}

/** Puts a failed task (and the tasks that were skipped because of it) back to `todo`. The run must not be going in another tab. */
export async function retryTask(runId: string, taskId: string, token: string, deps?: RunnerDeps): Promise<AiRun> {
  const run = await claim(runId, token, deps);
  const failed = run.tasks.find((t) => t.id === taskId);
  if (!failed || failed.status !== "failed") return run;
  const tasks = run.tasks.map((t) => {
    if (t.id === taskId || (t.status === "skipped" && t.error?.startsWith("Skipped because"))) {
      const { error, ...rest } = t;
      void error;
      return { ...rest, status: "todo" } as RunTask;
    }
    return t;
  });
  return patchRun(fetcher(deps), run.id, { token, version: run.version, tasks, status: "paused", error: null });
}

/** Sets a task aside (it is skipped; so are the tasks waiting for it, when the run next looks). */
export async function skipTask(runId: string, taskId: string, token: string, deps?: RunnerDeps): Promise<AiRun> {
  const run = await claim(runId, token, deps);
  const tasks = run.tasks.map((t) => (t.id === taskId && t.status !== "done" ? ({ ...t, status: "skipped", error: t.error ?? "Skipped by the author." } as RunTask) : t));
  return patchRun(fetcher(deps), run.id, { token, version: run.version, tasks, status: run.status === "running" ? "paused" : run.status });
}

type Pick = { kind: "plan" | "write" | "finish" | "prompt" | "tags" | "facts" | "continuity" | "summary" | "codex"; task: RunTask };

/** Whether the task's dependencies are all done: its plan, and for a `fromTask` slot the task it follows. */
function ready(list: RunTask[], t: RunTask): boolean {
  if (t.kind !== "write") return true;
  const ids = [t.plannedBy, t.slot.kind === "fromTask" ? t.slot.taskId : undefined].filter((x): x is string => !!x);
  return ids.every((id) => list.find((x) => x.id === id)?.status === "done");
}

/**
 * The next step, by the run's model setting (D20). "Group by model" does a depth in three phases: write its chapters
 * (main model), then finish each (summary, planned choices: cheap model), plan tasks wherever nothing can be
 * written; the others do a task at a time, in the order of the list, a chapter's text, choices and summaries together.
 */
function pickStep(run: AiRun, list: RunTask[]): Pick | null {
  if (run.mode === "pictures") {
    // The prompt of the next picture. Every prompt is written before any picture is drawn (the queue starts drawing when
    // none is left), so the text model and the picture model are each loaded once; drawing is the queue's.
    const todo = list.find((t): t is PictureTask => t.kind === "picture" && t.status === "todo");
    return todo ? { kind: "prompt", task: todo } : null;
  }
  if (run.mode === "review") {
    const todo = list.find((t): t is TagsTask | FactsTask | SummaryTask | CodexTask => (t.kind === "tags" || t.kind === "facts" || t.kind === "summary" || t.kind === "codex") && t.status === "todo");
    if (todo) return { kind: todo.kind, task: todo };
    // The clashes are judged last, once every chapter's facts are in.
    const judge = list.find((t): t is ContinuityTask => t.kind === "continuity" && t.status === "todo");
    return judge ? { kind: "continuity", task: judge } : null;
  }
  const writes = list.filter((t): t is WriteTask => t.kind === "write");
  const written = writes.filter((t) => t.status === "written");
  const todoPlans = list.filter((t): t is PlanTask => t.kind === "plan" && t.status === "todo" && ready(list, t));
  const todoWrites = writes.filter((t) => t.status === "todo" && ready(list, t));
  if ((run.options.models ?? "group") !== "group") {
    if (written[0]) return { kind: "finish", task: written[0] };
    const first = list.find((t) => t.status === "todo" && ready(list, t));
    return first ? { kind: first.kind === "plan" ? "plan" : "write", task: first } : null;
  }
  const open = writes.filter(unfinished);
  const depth = open.length ? Math.min(...open.map((t) => t.depth)) : Infinity;
  const write = todoWrites.find((t) => t.depth === depth);
  if (write) return { kind: "write", task: write };
  const finishing = written.filter((t) => t.depth === depth)[0];
  if (finishing) return { kind: "finish", task: finishing };
  const plan = [...todoPlans].sort((a, b) => a.depth - b.depth)[0];
  if (plan) return { kind: "plan", task: plan };
  if (todoWrites[0]) return { kind: "write", task: todoWrites[0] };
  if (written[0]) return { kind: "finish", task: written[0] };
  return null;
}

/** Which chapter a write task continues from. */
function parentOf(task: WriteTask, tasks: RunTask[]): string {
  if (task.slot.kind === "new") return task.slot.parentChapterId;
  if (task.slot.kind === "fromTask") {
    const from = tasks.find((t) => t.id === (task.slot as { taskId: string }).taskId);
    if (from?.kind === "write" && from.chapterId) return from.chapterId;
  }
  if (task.parentChapterId) return task.parentChapterId;
  const planner = tasks.find((t) => t.id === task.plannedBy);
  if (planner?.kind === "plan") return planner.chapterId;
  throw new Error("Can't tell which chapter this one continues from.");
}

const replace = (tasks: RunTask[], next: RunTask) => tasks.map((t) => (t.id === next.id ? next : t));

/**
 * Does one step and saves the run. `more` says another step can follow; false when the run is done, paused (a
 * task failed twice, or it was stopped), or waiting for the owner to check a level's plans (D23). The run's lease
 * is renewed every 30 s while the step works.
 */
export async function runNextStep(run: AiRun, env: StepEnv): Promise<StepResult> {
  const f = fetcher(env.deps);
  const timer = setInterval(() => void claimRunLease(f, run.id, env.token).catch(() => {}), env.deps?.renewMs ?? RENEW_MS);
  try {
    return await step(run, env, f);
  } finally {
    clearInterval(timer);
  }
}

async function step(start: AiRun, env: StepEnv, f: Fetch): Promise<StepResult> {
  const { token, signal, onEvent } = env;
  let run = start;
  const save = async (change: { tasks?: RunTask[]; status?: RunStatus; review_depth?: number | null; error?: string | null }) => {
    run = await patchRun(f, run.id, { token, version: run.version, ...change });
    return run;
  };
  const state = (status: RunStatus, error?: string) => onEvent?.({ type: "state", status, ...(error !== undefined && { error }) });

  if (run.status !== "running") await save({ status: "running", error: null });
  const { tasks: list } = nextTask(run.tasks);
  const picked = pickStep(run, list);

  if (!picked && run.mode === "pictures" && list.some(unfinished)) {
    // Every prompt is written: the rest waits for the pictures to be drawn.
    if (list !== run.tasks) await save({ tasks: list });
    return { run, more: false, idle: true };
  }
  if (!picked) {
    const status = list.some(unfinished) ? "paused" : "done";
    const error = status === "paused" ? "No step can go: the rest is waiting for something that did not finish." : null;
    await save({ tasks: list, status, error });
    state(status, error ?? undefined);
    return { run, more: false };
  }

  // Before a level's chapters are written the owner may want to check the plans (D23).
  if (picked.kind === "write" && needsReview({ options: run.options, tasks: list })) {
    const depth = Math.min(...list.filter((t): t is WriteTask => t.kind === "write" && t.status === "todo").map((t) => t.depth));
    await save({ tasks: list, status: "review", review_depth: depth });
    state("review");
    return { run, more: false };
  }

  const { task } = picked;
  const phase = picked.kind === "plan" ? "planning" : picked.kind === "write" || picked.kind === "prompt" || picked.kind === "tags" || picked.kind === "facts" || picked.kind === "continuity" || picked.kind === "summary" || picked.kind === "codex" ? "writing" : "finishing";
  const label = task.kind === "write" ? task.label : task.kind === "plan" ? "Plan the choices" : task.kind === "picture" ? `Prompt for “${task.label ?? "a chapter"}” (${task.slot})` : task.kind === "tags" ? `Find tags in “${task.label ?? "a chapter"}”` : task.kind === "facts" ? `Find facts in “${task.label ?? "a chapter"}”` : task.kind === "continuity" ? "Check continuity" : task.kind === "summary" ? `Check the summary of “${task.label ?? "a chapter"}”` : task.kind === "codex" ? `Check the codex for “${task.label ?? "a chapter"}”` : "";
  let tasks = list;
  let failure: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    onEvent?.({ type: "task", taskId: task.id, label, phase });
    try {
      tasks = await doStep(picked, run, list, env, f);
      failure = null;
      break;
    } catch (e) {
      if (isAbort(e) || signal?.aborted) {
        // Stop pauses; the task is as it was (nothing is posted until its text is complete).
        await save({ tasks: list, status: "paused" });
        state("paused");
        return { run, more: false };
      }
      if (e instanceof ApiError && e.status === 409 && e.message.includes("another tab")) throw e;
      failure = e;
      onEvent?.({ type: "status", text: `Trying again: ${message(e)}` });
    }
  }
  if (failure) {
    const text = message(failure);
    tasks = replace(list, { ...task, status: "failed", error: text } as RunTask);
    await save({ tasks, status: "paused", error: text });
    onEvent?.({ type: "error", taskId: task.id, message: text });
    state("paused", text);
    return { run, more: false };
  }

  onEvent?.({ type: "taskDone", taskId: task.id });
  const grown = withExpansion(list, tasks, run.options);
  tasks = grown.tasks;
  if (grown.tooMany) {
    const text = `Stopped: going on would take this run past ${LIMITS.runChapters} chapters, the most one run can write.`;
    await save({ tasks, status: "paused", error: text });
    onEvent?.({ type: "error", taskId: task.id, message: text });
    state("paused", text);
    return { run, more: false };
  }
  const settled = !tasks.some(unfinished);
  await save({ tasks, status: settled ? "done" : "running", error: null });
  if (settled) state("done");
  // A pictures run with all its prompts written waits for the pictures.
  const idle = !settled && run.mode === "pictures" && !pickStep(run, nextTask(tasks).tasks);
  return { run, more: !settled && !idle, ...(idle && { idle }) };
}

/** Does the step's work; returns the task list with the task updated (and the tasks it planned, for a plan). Posts and adds choices on the server; the caller saves the run. */
async function doStep(picked: Pick, run: AiRun, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  if (picked.kind === "tags") return doTags(picked.task as TagsTask, run, list, env, f);
  if (picked.kind === "facts") return doFacts(picked.task as FactsTask, list, env, f);
  if (picked.kind === "summary") return doSummary(picked.task as SummaryTask, list, env, f);
  if (picked.kind === "codex") return doCodex(picked.task as CodexTask, list, env, f);
  if (picked.kind === "continuity") return doContinuity(picked.task as ContinuityTask, run, list, env, f);
  if (picked.kind === "prompt") return doPrompt(picked.task as PictureTask, run, list, env, f);
  if (picked.kind === "plan") return doPlan(picked.task as PlanTask, run, list, env, f);
  if (picked.kind === "finish") return doFinish(picked.task as WriteTask, run, list, env, f);
  return doWrite(picked.task as WriteTask, run, list, env, f);
}

/** Finds the chapter already written for the task's slot, if there is one (a crash after posting, or somebody wrote it). */
function writtenFor(task: WriteTask, slot: ReturnType<typeof resolveSlot>, parent: ChapterContext): string | null {
  const choice = "choiceId" in slot ? parent.choices.find((c) => c.id === slot.choiceId) : parent.choices.find((c) => norm(c.label) === norm(slot.newLabel));
  if ("choiceId" in slot && !choice) throw new Error(`The choice “${task.label}” is no longer there.`);
  return choice?.child_chapter_id ?? null;
}

async function doneWith(task: WriteTask, chapterId: string, f: Fetch, list: RunTask[]): Promise<RunTask[]> {
  const written = await getContext(f, chapterId);
  // A chapter that was there already keeps the choices it has: they are what Grow the tree goes on from.
  const planned = task.planned ?? written.choices.map((c) => ({ label: c.label, direction: "" }));
  return replace(list, { ...task, status: "done", chapterId, choiceIds: written.choices.map((c) => c.id), planned, error: undefined } as RunTask);
}

/**
 * Tasks that became done in this step may add tasks (Grow the tree: the chapters for a new chapter's choices, and for
 * the choices a plan step added). Returns the list with them appended; `tooMany` when that would take the run past
 * the most chapters one run may write, in which case nothing is added.
 */
function withExpansion(before: RunTask[], after: RunTask[], options: AiRun["options"]): { tasks: RunTask[]; tooMany: boolean } {
  const added: RunTask[] = [];
  for (const t of after) {
    if (t.status !== "done" || before.find((b) => b.id === t.id)?.status === "done") continue;
    added.push(...expandAfter(t, [...after, ...added], options));
  }
  if (added.length === 0) return { tasks: after, tooMany: false };
  const chapters = [...after, ...added].filter((t) => t.kind === "write" && t.status !== "skipped").length;
  if (chapters > LIMITS.runChapters) return { tasks: after, tooMany: true };
  return { tasks: [...after, ...added], tooMany: false };
}

async function doPlan(task: PlanTask, run: AiRun, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const { settings, signal } = env;
  const context = await getContext(f, task.chapterId);
  const chapter = context.path.at(-1)!;
  const open = new Set(context.choices.filter((c) => !c.child_chapter_id).map((c) => norm(c.label)));
  const labels = task.labels.filter((l) => open.has(norm(l)));
  env.onEvent?.({ type: "status", text: "Planning what happens after each choice…" });
  const before = { ...context, path: context.path.slice(0, -1) };
  // Never past the most choices a chapter can have.
  const planned = await planNext(settings, {
    ctx: storyContextOf(before, null, []),
    chapter,
    given: labels,
    suggest: Math.max(0, Math.min(task.add, LIMITS.choices - context.choices.length)),
    options: run.options,
    signal,
    stream: env.deps?.stream,
    strict: true,
  });
  let current = context;
  if (planned.some((p) => p.isNew)) {
    for (const p of planned.filter((x) => x.isNew)) await addChoice(f, task.chapterId, p.label);
    current = await getContext(f, task.chapterId);
  }
  const steps = planned.map((p) => ({ label: p.label, direction: p.direction, choiceId: current.choices.find((c) => norm(c.label) === norm(p.label))?.id }));
  const done: PlanTask = { ...task, status: "done", steps, error: undefined };
  return applyPlan(replace(list, done), done, run.options.guidance ?? "");
}

async function doWrite(task: WriteTask, run: AiRun, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const { settings, signal, onEvent } = env;
  const slot = resolveSlot(task, list);
  const parent = await getContext(f, parentOf(task, list));
  const already = writtenFor(task, slot, parent);
  if (already) return doneWith(task, already, f, list);

  const direction = task.direction.trim() || withGuidance("", run.options.guidance);
  const grouped = (run.options.models ?? "group") === "group";
  const target = "choiceId" in slot ? { choice_id: slot.choiceId } : { parent_chapter_id: slot.parentChapterId, new_choice_label: slot.newLabel };
  const text = (soFar: string) => onEvent?.({ type: "text", taskId: task.id, text: soFar });
  let chapter: NewChapter;
  let planned: PlannedChoice[];
  if (grouped) {
    // The text alone, with the choices it was given; its summaries and suggested choices follow in the cheap-model phase.
    const ctx = await withPathSummaries(settings, storyContextOf(parent, task.label), signal, (s) => onEvent?.({ type: "status", text: s }), f);
    const out = await writeText(settings, { ctx, label: task.label, direction, options: run.options, signal, onText: text, stream: env.deps?.stream });
    planned = task.choices.given.map((label) => ({ label, direction: "", isNew: false }));
    chapter = { ...out, choices: task.choices.given, ai_run_id: run.id, ...target };
  } else {
    const out = await writeOneChapter(settings, {
      context: parent,
      label: task.label,
      direction,
      given: task.choices.given,
      suggest: task.choices.suggest,
      options: run.options,
      signal,
      onText: text,
      onStatus: (s) => onEvent?.({ type: "status", text: s }),
      stream: env.deps?.stream,
      fetch: f,
    });
    planned = out.choices;
    chapter = { title: out.title, body: out.body, summary: out.summary, path_summary: out.path_summary, choices: out.choices.map((c) => c.label), ai_run_id: run.id, ...target };
  }
  let posted: { chapter_id: string; choice_ids: string[] };
  try {
    posted = await postChapter(f, chapter);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) throw e;
    // Written meanwhile (by the author, or by this run before a crash): count it as done.
    const again = writtenFor(task, slot, await getContext(f, parentOf(task, list)));
    if (!again) throw e;
    return doneWith(task, again, f, list);
  }
  return replace(list, {
    ...task,
    status: grouped ? "written" : "done",
    chapterId: posted.chapter_id,
    choiceIds: posted.choice_ids,
    ...(!grouped && { planned: planned.map((p) => ({ label: p.label, direction: p.direction })) }),
    error: undefined,
  } as RunTask);
}

/** A chapter written without its summaries and suggested choices: makes them with the cheap model (the summary, then the planned choices). */
async function doFinish(task: WriteTask, run: AiRun, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const { settings, signal, onEvent } = env;
  if (!task.chapterId) throw new Error("This chapter was not posted.");
  let context = await getContext(f, task.chapterId);
  const chapter = context.path.at(-1)!;
  const before = context.path.slice(0, -1);
  const story = { title: context.story.title, premise: context.story.premise };

  if (!chapter.summary || !chapter.path_summary) {
    onEvent?.({ type: "status", text: "Summarizing…" });
    const s = await summarize(settings, { story, previous: before.at(-1)?.path_summary ?? null, chapter, options: run.options, signal, stream: env.deps?.stream });
    if (s) await putSummary(f, chapter.id, chapter.revision, s.summary, s.path_summary).catch(() => {});
  }

  // Only the choices still missing are suggested, so finishing again after a crash doesn't add more.
  const have = new Set(context.choices.map((c) => norm(c.label)));
  const given = task.choices.given.filter((l) => have.has(norm(l)));
  const suggest = Math.max(0, task.choices.given.length + task.choices.suggest - context.choices.length);
  onEvent?.({ type: "status", text: "Planning the choices…" });
  const planned = await planNext(settings, {
    ctx: storyContextOf({ ...context, path: before }, task.label, []),
    chapter,
    given,
    suggest,
    options: run.options,
    signal,
    stream: env.deps?.stream,
  });
  for (const p of planned.filter((x) => x.isNew)) await addChoice(f, chapter.id, p.label);
  if (planned.some((p) => p.isNew)) context = await getContext(f, chapter.id);
  return replace(list, {
    ...task,
    status: "done",
    choiceIds: context.choices.map((c) => c.id),
    planned: planned.map((p) => ({ label: p.label, direction: p.direction })),
    error: undefined,
  } as RunTask);
}

/** Fill missing pictures: the prompt for one picture. The picture itself is drawn through the picture queue, which has the run's `written` tasks asked of it. A slot that has its picture by now is simply done. */
async function doPrompt(task: PictureTask, run: AiRun, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  if (await hasPicture(f, task.chapterId, task.slot)) return replace(list, { ...task, status: "done", error: undefined });
  env.onEvent?.({ type: "status", text: `Writing the picture prompt for “${task.label ?? "the chapter"}”…` });
  const setup = await loadSetup(f, task.chapterId);
  const written = await writePicturePrompt(env.settings, f, setup, task, run.options, { write: env.deps?.writePrompt, signal: env.signal });
  return replace(list, { ...task, status: "written", prompt: written.prompt, negative: written.negative, error: undefined });
}

/**
 * Find tags: the AI reads one chapter and the suggestions are saved (as the review page's Find tags does). The chapter,
 * the tags and what was decided are read again here, since the run may be old. A chapter edited since the run was made
 * (or while the AI read it) is skipped; one with every tag decided already is done without asking the AI.
 */
async function doTags(task: TagsTask, run: AiRun, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const context = await getContext(f, task.chapterId);
  const chapter = context.path.at(-1)!;
  const skip = (why: string) => replace(list, { ...task, status: "skipped", error: why });
  if (chapter.revision !== task.revision) return skip("Skipped: the chapter was edited after the run was made.");
  const { tags, enabled } = await getStoryTags(f, run.story_id);
  const on = tags.filter((t) => enabled.includes(t.id));
  const { chapter_tags, checked } = await getChapterTags(f, run.story_id, task.chapterId);
  const decided = new Set([
    ...chapter_tags.filter((t) => t.status === "approved" || (t.status === "rejected" && t.revision === chapter.revision)).map((t) => t.tag_id),
    ...(checked[task.chapterId] ?? []),
  ]);
  if (on.every((t) => decided.has(t.id))) return replace(list, { ...task, status: "done", error: undefined });
  env.onEvent?.({ type: "status", text: `Reading “${chapter.title}” for tags…` });
  const rules = on.map((t) => ({ id: t.id, name: t.name, applies: t.applies, not_applies: t.not_applies, choices: t.choices, examples: t.examples }));
  const suggestions = await suggestTagsForChapter(env.settings, {
    story: { title: context.story.title, premise: context.story.premise },
    chapter: { title: chapter.title, body: chapter.body },
    tags: rules,
    signal: env.signal,
    role: "cheap",
  });
  let added = 0;
  try {
    // Every tag is sent and recorded as checked, like the review page does.
    const saved = await postTagSuggestions(f, task.chapterId, task.revision, rules.map((t) => t.id), suggestions);
    added = saved.added ?? 0;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return skip("Skipped: the chapter was edited while it was read.");
    throw e;
  }
  return replace(list, { ...task, status: "done", found: added, error: undefined });
}

/**
 * Facts: the AI reads one chapter for the lasting facts it states, and they are saved over the chapter's earlier ones. The
 * chapter is read again here, since the run may be old: one edited since the run was made (or while the AI read it) is
 * skipped.
 */
async function doFacts(task: FactsTask, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const context = await getContext(f, task.chapterId);
  const chapter = context.path.at(-1)!;
  const skip = (why: string) => replace(list, { ...task, status: "skipped", error: why });
  if (chapter.revision !== task.revision) return skip("Skipped: the chapter was edited after the run was made.");
  env.onEvent?.({ type: "status", text: `Reading “${chapter.title}” for facts…` });
  const facts = await extractFacts(env.settings, {
    chapter: { title: chapter.title, body: chapter.body },
    codexNames: context.codex.map((c) => c.name),
    signal: env.signal,
    role: "cheap",
  });
  let saved = 0;
  try {
    saved = (await postFacts(f, task.chapterId, task.revision, facts)).saved;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return skip("Skipped: the chapter was edited while it was read.");
    throw e;
  }
  return replace(list, { ...task, status: "done", found: saved, error: undefined });
}

/**
 * Codex check: the AI reads one chapter against the codex as it stands there and leaves suggestions in the codex inbox.
 * The chapter is read again here, since the run may be old: one edited since the run was made (or while the AI read it)
 * is skipped.
 */
async function doCodex(task: CodexTask, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const context = await getContext(f, task.chapterId);
  const chapter = context.path.at(-1)!;
  const skip = (why: string) => replace(list, { ...task, status: "skipped", error: why });
  if (chapter.revision !== task.revision) return skip("Skipped: the chapter was edited after the run was made.");
  env.onEvent?.({ type: "status", text: `Reading “${chapter.title}” for codex changes…` });
  const { entries } = await getChapterCodex(f, task.chapterId);
  // The request shows the entries the chapter mentions (and the always-included); the rest are only names, so they aren't proposed as new.
  const shown = new Set(selectEntries(entries, chapter.body));
  const suggestions = await runCodexCheck(env.settings, {
    chapter: { title: chapter.title, body: chapter.body },
    entries,
    otherNames: entries.filter((e) => !shown.has(e)).map((e) => e.name),
    signal: env.signal,
    role: "cheap",
  });
  let saved = 0;
  try {
    saved = (await postCodexSuggestions(f, task.chapterId, task.revision, suggestions)).saved;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return skip("Skipped: the chapter was edited while it was read.");
    throw e;
  }
  return replace(list, { ...task, status: "done", found: saved, error: undefined });
}

/**
 * Summary: the AI checks whether a chapter's summary matches the chapter, and the answer is saved with the revision and
 * the summary text it was about. The chapter is read again here, since the run may be old: one edited since the run was
 * made (or while the AI read it), or whose summary is now empty, is skipped.
 */
async function doSummary(task: SummaryTask, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const context = await getContext(f, task.chapterId);
  const chapter = context.path.at(-1)!;
  const skip = (why: string) => replace(list, { ...task, status: "skipped", error: why });
  if (chapter.revision !== task.revision) return skip("Skipped: the chapter was edited after the run was made.");
  const summary = chapter.summary ?? "";
  if (!summary.trim()) return skip("Skipped: the chapter has no summary.");
  env.onEvent?.({ type: "status", text: `Checking the summary of “${chapter.title}”…` });
  const result = await summaryCheck(env.settings, { chapter: { title: chapter.title, body: chapter.body }, summary, signal: env.signal, role: "cheap" });
  try {
    await postSummaryCheck(f, task.chapterId, { revision: task.revision, summary, verdict: result.ok ? "ok" : "wrong", ...(!result.ok && { problem: result.problem }) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return skip("Skipped: the chapter or its summary was edited while it was checked.");
    throw e;
  }
  return replace(list, { ...task, status: "done", found: result.ok ? 0 : 1, error: undefined });
}

/** The most clashes one run asks the AI about; the rest wait for the next run (they have no verdict yet). */
export const MAX_JUDGMENTS = 30;

/**
 * Continuity: the facts along the way to each end chapter are compared in plain code, and the AI is asked about each
 * clash that has no verdict yet. A chapter with an approved tag in CHANGE_EVENT_TAGS may change a value without a clash.
 * Each verdict is saved as soon as it is made, so a retry or a later run does not ask again.
 */
async function doContinuity(task: ContinuityTask, run: AiRun, list: RunTask[], env: StepEnv, f: Fetch): Promise<RunTask[]> {
  const { chapter_tags } = await getAllChapterTags(f, run.story_id);
  const changeEvents = new Set(chapter_tags.filter((t) => t.status === "approved" && CHANGE_EVENT_TAGS.includes(t.tag_name.trim().toLowerCase())).map((t) => t.chapter_id));
  // A verdict made about older text (either chapter edited since) is asked again, so the clash isn't lost.
  const known = new Map((await getVerdicts(f, run.story_id)).verdicts.map((v) => [v.fingerprint, v]));
  const info = new Map<string, { title: string; revision: number }>();
  const todo = new Map<string, Conflict>();
  env.onEvent?.({ type: "status", text: "Comparing the facts chapter by chapter…" });
  for (const id of task.chapterIds) {
    const [{ path: facts }, context] = await Promise.all([getPathFacts(f, id), getContext(f, id)]);
    for (const c of context.path) info.set(c.id, { title: c.title, revision: c.revision });
    for (const conflict of findConflicts(facts, changeEvents)) {
      const fingerprint = continuityFingerprint(conflict.before.quote, conflict.after.quote);
      if (!todo.has(fingerprint)) todo.set(fingerprint, conflict);
    }
  }
  for (const [fingerprint, conflict] of todo) {
    const v = known.get(fingerprint);
    if (v && v.before.revision === info.get(conflict.before.chapterId)?.revision && v.after.revision === info.get(conflict.after.chapterId)?.revision) todo.delete(fingerprint);
  }
  let found = 0;
  let asked = 0;
  for (const conflict of todo.values()) {
    if (asked >= MAX_JUDGMENTS) break;
    const before = info.get(conflict.before.chapterId);
    const after = info.get(conflict.after.chapterId);
    if (!before || !after) continue;
    asked++;
    env.onEvent?.({ type: "status", text: `Judging ${conflict.entity}, ${conflict.attribute} (${asked} of ${Math.min(todo.size, MAX_JUDGMENTS)})…` });
    const verdict = await judgeConflict(env.settings, {
      conflict: { entity: conflict.entity, attribute: conflict.attribute, before: conflict.before, after: conflict.after },
      chapterTitles: { before: before.title, after: after.title },
      signal: env.signal,
      role: "cheap",
    });
    await postVerdict(f, run.story_id, {
      verdict,
      entity: conflict.entity,
      attribute: conflict.attribute,
      before: { chapterId: conflict.before.chapterId, revision: before.revision, value: conflict.before.value, quote: conflict.before.quote },
      after: { chapterId: conflict.after.chapterId, revision: after.revision, value: conflict.after.value, quote: conflict.after.quote },
    });
    if (verdict === "contradiction") found++;
  }
  return replace(list, { ...task, status: "done", found, error: undefined });
}
