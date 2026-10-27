// Picture jobs on the server. A click on Queue arrives as an `ask`: the job as data (a `JobSpec`, D6), its target and how
// its place looks. Quick clicks are gathered here (a port of `ask` and `markReady` in WorkQueue.tsx): a click that
// matches the job being gathered adds a picture to it, and the job is closed GATHER_MS after the last click.
import { z } from "zod";
import type { Picture } from "../../components/pictures";
import { freeOllamaForPictures } from "../ai/ollama";
import { cancelPrompt, waitForPictures, type ComfyImage, type Progress } from "../comfy/client";
import { fromSpec, type JobSpec } from "../comfy/jobSpec";
import type { JobRecord } from "../comfy/jobTag";
import { queueJob, sameJob } from "../comfy/makeJob";
import { newId } from "../db";
import { instanceId } from "../instance";
import { NewJobSchema, recordPictureJob } from "../pictureJobs";
import { chapterIdOf, targetKey, type PictureTarget } from "../pictureTarget";
import { PostError } from "../stories";
import { parseSettings } from "../settingsSchema";
import { getSettings } from "../settingsStore";
import { moveWaiting, waitingOrder, type ReadyPicture } from "../workQueue/schedule";
import { workerState } from "./bus";
import { createItem, deleteItem, getItem, listItems, pictureTargetSchema, updateItem, type WorkRow } from "./items";
import { resolveSource } from "./uploads";

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

// ---- sending: queue the job on ComfyUI, wait for its pictures, record them (ports of `send`, `finish`, `record`, `ended`, `stop`) ----

/** A job's pictures, as the Illustrate page shows them. */
function picturesOfJob(chapterId: string | null, jobId: string | null, promptId: string, record: JobRecord, images: ComfyImage[]): Picture[] {
  return images.map((image, i) => ({
    key: `${jobId ?? promptId}-${i}`,
    index: i,
    mark: null,
    fresh: true,
    image,
    jobId,
    prompt: record.prompt,
    negative: record.negative,
    seed: record.seed,
    checkpoint: record.checkpoint,
    width: record.width,
    height: record.height,
    denoise: record.denoise ?? null,
    source: record.source ?? null,
    mask: record.mask ?? null,
    refs: record.refs ?? [],
    instruction: record.instruction ?? null,
    editModel: record.edit_model ?? null,
    moment: record.moment,
    ...(record.temporary && { temporary: true }),
    chapterId,
    madeAt: Date.now(),
    batch: images.length,
  }));
}

/** What a job's end hands on. */
type Ended = { pictures: Picture[]; warning?: string; unseen: boolean } | { error: string } | { stopped: true } | { gone: true };

/** Records a finished job in the log (a cover job for its story, a codex job for its story and entry). */
function recordPictures(target: PictureTarget, promptId: string, record: JobRecord, images: ComfyImage[], unseen: boolean): Ended {
  const chapterId = chapterIdOf(target);
  try {
    const by = target.kind === "chapter" ? { chapter_id: target.chapterId } : target.kind === "cover" ? { story_id: target.storyId } : { story_id: target.storyId, entry_id: target.entryId };
    const job = recordPictureJob(NewJobSchema.parse({ ...by, prompt_id: promptId, ...record, images, unseen }));
    return { pictures: picturesOfJob(chapterId, job.id, promptId, record, images), unseen };
  } catch (e) {
    // Not this StoryTime's chapter: nothing to show or to warn about.
    if (e instanceof PostError && e.status === 404) return { gone: true };
    return {
      pictures: picturesOfJob(chapterId, null, promptId, record, images),
      warning: `The pictures are ready, but StoryTime couldn't record how they were made: ${e instanceof Error ? e.message : String(e)}`,
      unseen: false,
    };
  }
}

/** A job has ended: its item becomes done or failed (for the pages to hand on), or goes when it was stopped or is not this StoryTime's. */
function ended(key: string, result: Ended) {
  workerState().pictures.delete(key);
  if ("stopped" in result || "gone" in result) deleteItem(key);
  else if ("error" in result) updateItem(key, { state: "failed", data: { message: result.error, progress: undefined } });
  else updateItem(key, { state: "done", data: { pictures: result.pictures, message: result.warning, unseen: result.unseen, progress: undefined } });
}

const failed = (key: string, e: unknown) => ended(key, e instanceof DOMException && e.name === "AbortError" ? { stopped: true } : { error: e instanceof Error ? e.message : String(e) });

/** Progress goes out at most four times a second per job, but a change of stage always does. */
const PROGRESS_MS = 250;
const lastProgress = new Map<string, { at: number; stage: string }>();

function saveProgress(key: string, progress: Progress) {
  const last = lastProgress.get(key);
  const now = Date.now();
  if (last && last.stage === progress.stage && now - last.at < PROGRESS_MS) return;
  lastProgress.set(key, { at: now, stage: progress.stage });
  updateItem(key, { data: { progress } });
}

/** Queues a sent job on ComfyUI and waits for its pictures. `posted` is called once ComfyUI has the job (or it failed before). */
async function send(key: string, posted: () => void) {
  const worker = workerState();
  const control = worker.pictures.get(key);
  const item = getItem(key);
  if (!control || item?.type !== "picture") {
    worker.pictures.delete(key);
    posted();
    return;
  }
  const { target, spec, count, session } = item.data;
  try {
    const input = fromSpec(spec as unknown as JobSpec, resolveSource);
    const settings = getSettings() ?? parseSettings({});
    const made = await queueJob(input, count, { ...target, instance: instanceId() }, {
      signal: control.ctl.signal,
      uploads: worker.uploads,
      onProgress: (progress) => saveProgress(key, progress),
      onSize: (width, height) => updateItem(key, { data: { view: { ...(getItem(key)?.data as { view?: object } | undefined)?.view, width, height } } }),
      beforeQueue: () => freeOllamaForPictures(settings.connections),
      onPromptId: (id) => {
        control.promptId = id;
        updateItem(key, { data: { promptId: id } });
      },
    });
    posted();
    const images = await waitForPictures(input.comfy.url, made.promptId, made.clientId, (progress) => saveProgress(key, progress), control.ctl.signal);
    if (images.length === 0) throw new Error("ComfyUI finished but sent back no pictures. Does the workflow end in a Save Image node?");
    ended(key, recordPictures(target, made.promptId, made.record, images, !made.record.temporary && !session));
  } catch (e) {
    posted();
    failed(key, e);
  } finally {
    lastProgress.delete(key);
  }
}

/** Sends a ready job: it is `working` at once, and goes to ComfyUI when the job before it has been queued there. */
export function sendPicture(key: string) {
  const worker = workerState();
  const item = getItem(key);
  if (item?.type !== "picture" || item.state !== "waiting" || worker.pictures.has(key)) return;
  const spec = item.data.spec as { comfy?: { url?: string }; draw?: { id?: string } };
  worker.lastPreset = spec.draw?.id ?? null;
  worker.pictures.set(key, { ctl: new AbortController(), promptId: null, url: spec.comfy?.url ?? "" });
  // In the chain before the item changes: changing it can pump again, which sends the jobs behind this one.
  // (A job that takes more than 15 s to queue doesn't hold up the ones behind it.)
  worker.sendChain = worker.sendChain.then(
    () =>
      new Promise<void>((resolve) => {
        const give = setTimeout(resolve, 15_000);
        void send(key, () => {
          clearTimeout(give);
          resolve();
        });
      }),
  );
  updateItem(key, { state: "working", data: { progress: { stage: "queued", ahead: null } } });
}

/** The waiting jobs as the scheduler takes them (oldest first; jobs the owner moved have the earliest times). */
export function readyPictures(items = listItems()): (ReadyPicture & { key: string })[] {
  return items
    .filter((i): i is WorkRow<"picture"> => i.type === "picture" && i.state === "waiting")
    .sort((a, b) => (a.readyAt ?? a.createdAt) - (b.readyAt ?? b.createdAt))
    .map((i) => ({ key: i.key, targetKey: i.targetKey ?? "", drawPreset: (i.data.spec as { draw?: { id?: string } }).draw?.id ?? null, readyAt: i.readyAt ?? i.createdAt, moved: i.moved }));
}

/** Stops a job: one being gathered or waiting is dropped; one sent is taken off ComfyUI. False when there is no such job. */
export function stopPicture(key: string): boolean {
  const worker = workerState();
  const item = getItem(key);
  if (item?.type !== "picture") return false;
  if (worker.gathering?.key === key) {
    clearTimeout(worker.gathering.timer);
    worker.gathering = null;
    return deleteItem(key);
  }
  if (item.state === "gathering" || item.state === "waiting") return deleteItem(key);
  const control = worker.pictures.get(key);
  if (item.state !== "working" || !control) return false;
  if (control.promptId) void cancelPrompt(control.url, control.promptId);
  control.ctl.abort();
  return true;
}

/** Takes a finished or failed job off the list (the pages have handed its pictures on). */
export function dismissPicture(key: string): boolean {
  const item = getItem(key);
  if (item?.type !== "picture" || (item.state !== "done" && item.state !== "failed")) return false;
  return deleteItem(key);
}

/** Moves a waiting job in the order they will go; the order is the owner's from then on. False when nothing moved. */
export function movePicture(key: string, how: "up" | "down" | "next"): boolean {
  const group = (getSettings() ?? parseSettings({})).queue.groupPictures;
  const order = waitingOrder(readyPictures(), workerState().lastPreset, group);
  const moved = moveWaiting(order, key, how);
  if (moved.every((r, i) => r.key === order[i].key)) return false;
  // Their times become 1, 2, 3…: the moved jobs sort by them, ahead of every job that was not moved.
  moved.forEach((r, i) => updateItem(r.key, { moved: true, readyAt: i + 1 }));
  return true;
}
