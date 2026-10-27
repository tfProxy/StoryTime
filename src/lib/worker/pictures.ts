// Picture jobs on the server. A click on Queue arrives as an `ask`: the job as data (a `JobSpec`, D6), its target and how
// its place looks. Quick clicks are gathered here (a port of `ask` and `markReady` in WorkQueue.tsx): a click that
// matches the job being gathered adds a picture to it, and the job is closed GATHER_MS after the last click.
import { z } from "zod";
import { newId } from "../db";
import { sameJob } from "../comfy/makeJob";
import { fromSpec, type JobSpec } from "../comfy/jobSpec";
import { targetKey, type PictureTarget } from "../pictureTarget";
import { workerState } from "./bus";
import { createItem, getItem, listItems, pictureTargetSchema, updateItem, type WorkRow } from "./items";

/** How long after the last click a job is closed, so quick clicks with the same settings make one job. */
export const GATHER_MS = 800;
/** The most pictures one job makes; a click beyond it starts another job. */
export const MAX_BATCH = 8;

/** The most a job's spec may be, as JSON. */
const MAX_SPEC_CHARS = 2_000_000;

/** What a page asks for: one more picture for its target, made as `spec` says; `view` is how its place looks meanwhile. */
export const askRequest = z.object({
  target: pictureTargetSchema,
  spec: z.record(z.string(), z.unknown()).refine((s) => JSON.stringify(s).length <= MAX_SPEC_CHARS, "The job is too large"),
  view: z.record(z.string(), z.unknown()),
});
export type AskRequest = z.infer<typeof askRequest>;

/** A spec the server cannot read (a 400 for the caller). */
export class AskError extends Error {}

const never = async (source: string): Promise<Blob> => {
  throw new Error(`unexpected fetch of ${source}`);
};

/** What a click must match to join the job being gathered, and whether the job gathers at all (Settings › Drawing). */
function readSpec(spec: JobSpec): { signature: string; gathers: boolean } {
  try {
    const input = fromSpec(spec, never);
    return { signature: sameJob(input), gathers: input.comfy.batchClicks };
  } catch {
    throw new AskError("That picture job is not valid.");
  }
}

/** Closes a gathered job: no more clicks join it, and it waits to be sent. */
export function markReady(key: string) {
  const worker = workerState();
  if (worker.gathering?.key === key) {
    clearTimeout(worker.gathering.timer);
    worker.gathering = null;
  }
  const item = getItem(key);
  if (item?.type === "picture" && item.state === "gathering") updateItem(key, { state: "waiting", readyAt: Date.now() });
}

/**
 * One more picture. Clicks with the same target, prompt and settings, each within GATHER_MS of the last, are gathered
 * into one job (up to MAX_BATCH pictures); a click with anything changed closes the job being gathered at once and
 * starts another. With batching off (`comfy.batchClicks`), each click is its own job, closed at once.
 */
export function askPicture(request: AskRequest): WorkRow<"picture"> {
  const worker = workerState();
  const target = request.target as PictureTarget;
  const { signature, gathers } = readSpec(request.spec as unknown as JobSpec);
  const at = targetKey(target);
  const g = worker.gathering;
  if (gathers && g && g.targetKey === at && g.signature === signature && g.count < MAX_BATCH) {
    g.count += 1;
    clearTimeout(g.timer);
    g.timer = setTimeout(() => markReady(g.key), GATHER_MS);
    return updateItem(g.key, { data: { count: g.count } }) as WorkRow<"picture">;
  }
  if (g) markReady(g.key);
  const key = `job-${newId()}`;
  const spec = request.spec as { session?: string; base?: string; temporary?: boolean };
  const item = createItem({
    key,
    type: "picture",
    state: "gathering",
    data: {
      target: request.target,
      spec: request.spec,
      count: 1,
      view: { ...request.view, ...(spec.temporary && { temporary: true }) },
      progress: { stage: "gathering" },
      ...(spec.session && { session: spec.session, base: spec.base ?? "" }),
    },
  });
  worker.gathering = { key, targetKey: at, signature, count: 1, timer: setTimeout(() => markReady(key), gathers ? GATHER_MS : 0) };
  return item;
}

/** Jobs that were still gathering when the server stopped are closed: nothing will click into them now. */
export function recoverGathering() {
  for (const item of listItems()) if (item.type === "picture" && item.state === "gathering") markReady(item.key);
}
