// AI runs on the server: one step of a run at a time, then back in line (a port of `runStep` and the run parts of
// WorkQueue.tsx). The run itself and its tasks are in `ai_runs`; the queue's item `run:<id>` is what the queue shows.
// The worker holds the runs it works on with one lease token (D8); the steps are the runner's, which reaches the run's
// routes through `selfFetch`. Events and the saved run go out on the bus channel `run:<id>`.
import { listUnfinishedRuns } from "../aiRuns";
import { claim, finish as finishRun, retryTask, runNextStep, skipTask, type RunEvent } from "../aiRuns/runner";
import type { AiRun } from "../aiRuns/types";
import { instanceId } from "../instance";
import { parseSettings } from "../settingsSchema";
import { getSettings } from "../settingsStore";
import { publish, workerState } from "./bus";
import { createItem, getItem, listItems, updateItem, type WorkRow } from "./items";
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
  }
}

/** Stops a run: a step going is aborted (the run is paused); one waiting is paused. False when the queue has no such run. */
export async function stopRun(runId: string): Promise<boolean> {
  const key = runItemKey(runId);
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

/** A run step that was going when the server stopped goes back in line (D12); its lease runs out by itself. */
export function recoverRuns() {
  for (const item of listItems()) if (item.type === "run" && item.state === "working") updateItem(item.key, { state: "waiting" });
}
