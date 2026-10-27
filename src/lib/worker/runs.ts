// AI runs on the server: one step of a run at a time, then back in line (a port of `runStep` and the run parts of
// WorkQueue.tsx). The run itself and its tasks are in `ai_runs`; the queue's item `run:<id>` is what the queue shows.
// The worker holds the runs it works on with one lease token (D8); the steps are the runner's, which reaches the run's
// routes through `selfFetch`. Events and the saved run go out on the bus channel `run:<id>`.
import type { Picture } from "../../components/pictures";
import { listUnfinishedRuns } from "../aiRuns";
import { getRun, patchRun } from "../aiRuns/api";
import { buildPictureJob, loadModels, loadSetup, savePicture } from "../aiRuns/pictures";
import { claim, finish as finishRun, retryTask, runNextStep, skipTask, type RunEvent } from "../aiRuns/runner";
import type { AiRun } from "../aiRuns/types";
import { toSpec } from "../comfy/jobSpec";
import { denoiseOf, madeWithText, refsOf } from "../comfy/makeJob";
import { storedOf } from "../comfy/references";
import { instanceId } from "../instance";
import { chapterTarget } from "../pictureTarget";
import { parseSettings } from "../settingsSchema";
import { getSettings } from "../settingsStore";
import { publish, QUEUE_CHANNEL, subscribe, workerState } from "./bus";
import { createItem, deleteItem, getItem, listItems, updateItem, type WorkRow } from "./items";
import { askPicture, stopPicture } from "./pictures";
import { prepareImageOnServer } from "./prepareImage";
import { selfFetch } from "./selfFetch";

const deps = { fetch: selfFetch };
const token = () => `worker:${instanceId()}`;

export const runItemKey = (runId: string) => `run:${runId}`;
export const runChannel = runItemKey;

/** What a page watching a run is sent on `run:<id>`. */
export type RunStreamEvent = { type: "event"; event: RunEvent } | { type: "run"; run: AiRun };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The chapters (or pictures) done, of how many, as the queue counts them. */
function counts(run: AiRun) {
  const parts = run.tasks.filter((t) => t.kind === (run.mode === "pictures" ? "picture" : "write"));
  return { done: parts.filter((t) => t.status === "done" || (t.kind === "write" && t.status === "written")).length, total: parts.length };
}

/** Tells the watchers the run as saved, and keeps the item's counts. */
function applyRun(run: AiRun) {
  updateItem(runItemKey(run.id), { data: counts(run) });
  publish(runChannel(run.id), { type: "run", run } satisfies RunStreamEvent);
}

/**
 * Puts the run in line: takes it, sets it `queued` and makes (or resets) its item `waiting`. A run that is going or
 * waiting is left alone. Throws an `ApiError` (409 when another tab has the run).
 */
export async function queueRun(runId: string): Promise<WorkRow<"run">> {
  const existing = getItem(runItemKey(runId));
  if (existing?.type === "run" && (existing.state === "waiting" || existing.state === "working")) return existing;
  const run = await claim(runId, token(), deps);
  const saved = await finishRun(run, "queued", token(), deps, null);
  const summary = listUnfinishedRuns().find((r) => r.id === runId);
  const fields = { ...counts(saved), error: undefined, note: undefined, current: undefined };
  if (existing) {
    updateItem(existing.key, { state: "waiting", data: fields });
  } else {
    createItem({
      key: runItemKey(runId),
      type: "run",
      state: "waiting",
      data: {
        runId,
        storyId: saved.story_id,
        storyTitle: summary?.story_title ?? "A story",
        startChapterId: saved.start_chapter_id,
        startTitle: summary?.start_title ?? "",
        mode: saved.mode,
        ...counts(saved),
      },
    });
  }
  publish(runChannel(runId), { type: "run", run: saved } satisfies RunStreamEvent);
  // A picture run that has its prompts written already (after a restart) has them drawn.
  pictureTick(runId);
  return getItem(runItemKey(runId)) as WorkRow<"run">;
}

/** One step of the run, then back in line (or paused, done, failed). */
export async function runStep(runId: string): Promise<void> {
  const key = runItemKey(runId);
  const item = getItem(key);
  const state = workerState();
  if (!item || item.type !== "run" || item.state !== "waiting" || state.runs.has(runId)) return;
  const ctl = new AbortController();
  let finished!: () => void;
  state.runs.set(runId, { ctl, done: new Promise<void>((resolve) => (finished = resolve)) });
  updateItem(key, { state: "working", data: { error: undefined, note: undefined } });
  try {
    const run = await claim(runId, token(), deps);
    const out = await runNextStep(run, {
      settings: getSettings() ?? parseSettings({}),
      token: token(),
      signal: ctl.signal,
      onEvent: (event) => {
        if (event.type === "task" && event.label && (getItem(key)?.data as { current?: string } | undefined)?.current !== event.label) updateItem(key, { data: { current: event.label } });
        publish(runChannel(runId), { type: "event", event } satisfies RunStreamEvent);
      },
      deps,
    });
    applyRun(out.run);
    if (out.idle) updateItem(key, { state: "working", data: { current: "Drawing pictures" } });
    else if (out.more) updateItem(key, { state: "waiting" });
    else if (out.run.status === "done") updateItem(key, { state: "done", data: { current: undefined } });
    else if (out.run.status === "review") updateItem(key, { state: "paused", data: { note: "Plan ready to check", current: undefined } });
    else if (out.run.error && !ctl.signal.aborted) updateItem(key, { state: "failed", data: { error: out.run.error, current: undefined } });
    else updateItem(key, { state: "paused", data: { current: undefined } });
  } catch (e) {
    updateItem(key, { state: "failed", data: { error: message(e), current: undefined } });
  } finally {
    state.runs.delete(runId);
    finished();
    // Pictures finished during the step are put on the run now, and written prompts are asked for.
    void flushPictures(runId).then(() => pictureTick(runId));
  }
}

/** Stops a run: a step going is aborted (the run is paused); one waiting is paused. False when the queue has no such run. */
export async function stopRun(runId: string): Promise<boolean> {
  const key = runItemKey(runId);
  stopPictures(runId);
  const running = workerState().runs.get(runId);
  if (running) {
    running.ctl.abort();
    return true;
  }
  const item = getItem(key);
  if (!item || item.type !== "run" || (item.state !== "waiting" && item.state !== "working")) return false;
  updateItem(key, { state: "paused", data: { current: undefined } });
  try {
    const run = await claim(runId, token(), deps);
    applyRun(await finishRun(run, "paused", token(), deps));
  } catch {
    // the run stays queued on the server; the item shows it as paused
  }
  return true;
}

/** Ends a run for good ("Stop" on an unfinished run): a step going is stopped and waited for, then the run is saved as stopped and leaves the queue. */
export async function endRun(runId: string): Promise<AiRun> {
  stopPictures(runId);
  const running = workerState().runs.get(runId);
  if (running) {
    running.ctl.abort();
    await running.done;
  }
  const run = await claim(runId, token(), deps);
  const saved = await finishRun(run, "stopped", token(), deps);
  deleteItem(runItemKey(runId));
  publish(runChannel(runId), { type: "run", run: saved } satisfies RunStreamEvent);
  return saved;
}

/** Retry or skip a task. A step going is waited for first. Answers the run as saved. */
export async function changeTask(runId: string, taskId: string, action: "retry" | "skip"): Promise<AiRun> {
  await workerState().runs.get(runId)?.done;
  const run = action === "retry" ? await retryTask(runId, taskId, token(), deps) : await skipTask(runId, taskId, token(), deps);
  const item = getItem(runItemKey(runId));
  if (item && item.state !== "waiting" && item.state !== "working") updateItem(item.key, { state: "paused", data: { error: undefined, ...counts(run) } });
  else if (item) updateItem(item.key, { data: counts(run) });
  publish(runChannel(runId), { type: "run", run } satisfies RunStreamEvent);
  return run;
}

// ---- Fill missing pictures: the run writes the prompts (steps above); the drawing goes through the picture queue ----

/** The session the pictures of a picture run are asked under: their items belong to the run, never to a page. */
const sessionOf = (runId: string) => `pictures:${runId}`;

function pictureState(runId: string) {
  const all = workerState().pictureRuns;
  let s = all.get(runId);
  if (!s) all.set(runId, (s = { asked: new Set(), retried: new Set(), results: [], flushing: false }));
  return s;
}

/** The pictures of the run's tasks that are in the picture queue (being gathered, waiting or being made), by task id. */
const inPictureQueue = (runId: string) =>
  new Set(listItems().flatMap((i) => (i.type === "picture" && i.data.session === sessionOf(runId) && ["gathering", "waiting", "working"].includes(i.state) ? [i.data.base ?? ""] : [])));

/** Puts the pictures finished since the last step on the run (done, or failed after a retry), and ends the run when none are left. Waits while the run is in a step of its own, which saves it. */
async function flushPictures(runId: string): Promise<void> {
  const s = pictureState(runId);
  if (s.results.length === 0 || s.flushing || workerState().runs.has(runId)) return;
  s.flushing = true;
  const batch = s.results.splice(0);
  const key = runItemKey(runId);
  try {
    const run = await claim(runId, token(), deps);
    const tasks = run.tasks.map((t) => {
      const r = t.kind === "picture" ? batch.find((x) => x.taskId === t.id) : undefined;
      return r ? ({ ...t, status: r.error ? "failed" : "done", ...(r.jobId && { jobId: r.jobId }), error: r.error } as typeof t) : t;
    });
    const failed = batch.find((b) => b.error);
    const settled = !tasks.some((t) => t.status === "todo" || t.status === "written");
    const saved = await patchRun(deps.fetch, runId, {
      token: token(),
      version: run.version,
      tasks,
      status: failed ? "paused" : settled ? "done" : "running",
      error: failed?.error ?? null,
    });
    applyRun(saved);
    if (failed) {
      stopPictures(runId);
      updateItem(key, { state: "failed", data: { error: failed.error, current: undefined } });
    } else if (settled) updateItem(key, { state: "done", data: { current: undefined } });
  } catch (e) {
    updateItem(key, { state: "failed", data: { error: message(e) } });
  } finally {
    s.flushing = false;
  }
}

/** One picture's drawing job failed: it is tried once more, then the run stops with the error. */
function pictureFailed(runId: string, taskId: string, text: string) {
  const s = pictureState(runId);
  s.asked.delete(taskId);
  if (!s.retried.has(taskId)) {
    s.retried.add(taskId);
    return pictureTick(runId);
  }
  s.results.push({ taskId, error: text });
  void flushPictures(runId);
}

/** A picture is drawn: it is saved as the chapter's header or footer (which also pins it), then put on the run. */
async function pictureMade(runId: string, taskId: string, pictures: Picture[]) {
  const first = pictures[0];
  try {
    const run = await getRun(deps.fetch, runId);
    const task = run.tasks.find((t) => t.id === taskId);
    if (!task || task.kind !== "picture" || !first) return;
    try {
      await savePicture(deps.fetch, (getSettings() ?? parseSettings({})).comfy.url, task, first.image, first.jobId, first.index, prepareImageOnServer);
      pictureState(runId).results.push({ taskId, jobId: first.jobId ?? undefined });
      await flushPictures(runId);
    } catch (e) {
      pictureFailed(runId, taskId, message(e));
    }
  } catch {
    return; // the run is gone
  }
  pictureTick(runId);
}

/** Asks the picture queue for the picture of a task whose prompt is written. */
async function askRunPicture(run: AiRun, task: Extract<AiRun["tasks"][number], { kind: "picture" }>) {
  try {
    const settings = getSettings() ?? parseSettings({});
    const setup = await loadSetup(deps.fetch, task.chapterId);
    const models = await loadModels(settings.comfy.url);
    const built = buildPictureJob(settings, setup, task, { prompt: task.prompt ?? "", negative: task.negative ?? "" }, models, run.options, sessionOf(run.id));
    if ("problem" in built) throw new Error(built.problem);
    const { input } = built.job;
    askPicture({
      target: chapterTarget(setup.story.id, task.chapterId),
      spec: toSpec(input, {}) as unknown as Record<string, unknown>,
      view: {
        prompt: input.prompt,
        negative: input.negative,
        checkpoint: madeWithText(input),
        width: input.comfy.width,
        height: input.comfy.height,
        denoise: denoiseOf(input),
        source: null,
        mask: null,
        refs: storedOf(refsOf(input)),
        instruction: null,
        editModel: null,
        moment: input.moment,
      },
    });
  } catch (e) {
    pictureFailed(run.id, task.id, message(e));
  }
}

/** Looks at a picture run: puts the run back in line while prompts are left to write, then (all written) asks for the pictures. */
export function pictureTick(runId: string) {
  void (async () => {
    const key = runItemKey(runId);
    const item = getItem(key);
    if (item?.type !== "run" || item.state === "paused" || item.state === "failed" || item.state === "done") return;
    const run = await getRun(deps.fetch, runId);
    if (run.mode !== "pictures" || run.status === "done" || run.status === "stopped") return;
    const s = pictureState(runId);
    // Every prompt is written before any picture is asked for, so the text model isn't swapped for the picture model and back.
    const todo = run.tasks.some((t) => t.status === "todo");
    if (!todo) {
      const queued = inPictureQueue(runId);
      for (const t of run.tasks) {
        if (t.kind === "picture" && t.status === "written" && !s.asked.has(t.id) && !queued.has(t.id)) {
          s.asked.add(t.id);
          void askRunPicture(run, t);
        }
      }
    }
    if (todo && !workerState().runs.has(runId) && getItem(key)?.state !== "waiting") updateItem(key, { state: "waiting", data: { current: undefined } });
  })().catch(() => {});
}

/** Stop: the run's pictures being made are stopped, and what was asked for is asked again when the run goes on. */
export function stopPictures(runId: string) {
  pictureState(runId).asked.clear();
  for (const i of listItems()) {
    if (i.type === "picture" && i.data.session === sessionOf(runId) && ["gathering", "waiting", "working"].includes(i.state)) stopPicture(i.key);
  }
}

/** Hands a picture run's finished pictures to the run (they belong to it alone, and are not kept in the list). Started with the loop. */
export function watchPictureRuns() {
  const handled = new Set<string>();
  subscribe(QUEUE_CHANNEL, (event) => {
    const e = event as { type?: string; item?: WorkRow };
    const item = e.item;
    if (e.type !== "item" || item?.type !== "picture" || (item.state !== "done" && item.state !== "failed") || !item.data.session?.startsWith("pictures:") || handled.has(item.key)) return;
    handled.add(item.key);
    const runId = item.data.session.slice("pictures:".length);
    const taskId = item.data.base ?? "";
    deleteItem(item.key);
    if (item.state === "done") void pictureMade(runId, taskId, (item.data.pictures ?? []) as Picture[]);
    else pictureFailed(runId, taskId, item.data.message ?? "The picture could not be made.");
  });
}

/** A run step that was going when the server stopped goes back in line (D12); its lease runs out by itself. */
export function recoverRuns() {
  for (const item of listItems()) if (item.type === "run" && item.state === "working") updateItem(item.key, { state: "waiting" });
}
