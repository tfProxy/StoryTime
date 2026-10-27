// Picture jobs on the server. A click on Queue arrives as an `ask`: the job as data (a `JobSpec`, D6), its target and how
// its place looks. Quick clicks are gathered here (a port of `ask` and `markReady` in WorkQueue.tsx): a click that
// matches the job being gathered adds a picture to it, and the job is closed GATHER_MS after the last click.
import { z } from "zod";
import type { Picture } from "../../components/pictures";
import { freeOllamaForPictures } from "../ai/ollama";
import { cancelPrompt, listTaggedJobs, waitForPictures, type ComfyImage, type Progress, type TaggedJob } from "../comfy/client";
import { fromSpec, type JobSpec } from "../comfy/jobSpec";
import { tagTarget, type JobRecord } from "../comfy/jobTag";
import { queueJob, sameJob } from "../comfy/makeJob";
import { newId } from "../db";
import { instanceId } from "../instance";
import { knownPromptIds, NewJobSchema, recordPictureJob } from "../pictureJobs";
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
    if (process.env.STORYTIME_TEST === "1" && workerState().failRecording) throw new Error(workerState().failRecording!);
    const by = target.kind === "chapter" ? { chapter_id: target.chapterId } : target.kind === "cover" ? { story_id: target.storyId } : { story_id: target.storyId, entry_id: target.entryId };
    const job = recordPictureJob(NewJobSchema.parse({ ...by, prompt_id: promptId, ...record, images, unseen }));
    return { pictures: picturesOfJob(chapterId, job.id, promptId, record, images), unseen };
  } catch (e) {
    // Not this StoryTime's chapter: nothing to show or to warn about.
    if (e instanceof PostError && e.status === 404) return { gone: true };
    // Not in the log: a later scan of ComfyUI (which still has the job, tagged) records it.
    workerState().picked.delete(promptId);
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
  endProgress(key);
  if ("stopped" in result || "gone" in result) deleteItem(key);
  else if ("error" in result) updateItem(key, { state: "failed", data: { message: result.error, progress: undefined } });
  else updateItem(key, { state: "done", data: { pictures: result.pictures, message: result.warning, unseen: result.unseen, progress: undefined } });
}

const failed = (key: string, e: unknown) => ended(key, e instanceof DOMException && e.name === "AbortError" ? { stopped: true } : { error: e instanceof Error ? e.message : String(e) });

/** Progress goes out at most four times a second per job, but a change of stage always does. */
const PROGRESS_MS = 250;
type ProgressState = { at: number; stage: string; pending: Progress | null; timer: ReturnType<typeof setTimeout> | null };
const lastProgress = new Map<string, ProgressState>();

function saveProgress(key: string, progress: Progress) {
  const s: ProgressState = lastProgress.get(key) ?? { at: 0, stage: "", pending: null, timer: null };
  lastProgress.set(key, s);
  const send = (p: Progress) => {
    s.at = Date.now();
    s.stage = p.stage;
    s.pending = null;
    updateItem(key, { data: { progress: p } });
  };
  const wait = PROGRESS_MS - (Date.now() - s.at);
  if (s.stage !== progress.stage || wait <= 0) {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    return send(progress);
  }
  // Too soon after the last one: the latest is sent when the time is up, so the last word is never lost.
  s.pending = progress;
  s.timer ??= setTimeout(() => {
    s.timer = null;
    if (s.pending && lastProgress.get(key) === s) send(s.pending);
  }, wait);
}

/** The job has ended: no progress is sent for it any more. */
function endProgress(key: string) {
  const s = lastProgress.get(key);
  if (s?.timer) clearTimeout(s.timer);
  lastProgress.delete(key);
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
        worker.picked.add(id);
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
    endProgress(key);
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

// ---- jobs found in ComfyUI: this StoryTime's jobs that nothing here is watching (made before a restart, or by a page that is gone) ----

/** How a job looks in the list, from the record ComfyUI kept of it. */
const viewOfRecord = (job: JobRecord) => ({
  prompt: job.prompt,
  negative: job.negative,
  checkpoint: job.checkpoint,
  width: job.width,
  height: job.height,
  denoise: job.denoise ?? null,
  source: job.source ?? null,
  mask: job.mask ?? null,
  refs: job.refs ?? [],
  instruction: job.instruction ?? null,
  editModel: job.edit_model ?? null,
  moment: job.moment,
  ...(job.temporary && { temporary: true }),
});

/** Makes the item for a job found in ComfyUI (`working` until its end is recorded). */
function itemForFound(found: TaggedJob): string {
  const { job, clientId } = found.tag;
  const key = `job-${newId()}`;
  createItem({
    key,
    type: "picture",
    state: "working",
    data: {
      target: tagTarget(found.tag),
      spec: {},
      count: job.count,
      view: viewOfRecord(job),
      progress: { stage: "queued", ahead: null },
      promptId: found.promptId,
      clientId,
      ...(found.tag.session && { session: found.tag.session, base: found.tag.base ?? "" }),
    },
  });
  return key;
}

/** Waits for a job ComfyUI has, records it and ends its item (as the end of `send` does). */
export function watchFound(key: string, url: string, found: TaggedJob) {
  const worker = workerState();
  const { job, clientId } = found.tag;
  const control = { ctl: new AbortController(), promptId: found.promptId, url };
  worker.pictures.set(key, control);
  worker.picked.add(found.promptId);
  waitForPictures(url, found.promptId, clientId, (progress) => saveProgress(key, progress), control.ctl.signal)
    .then((images) => {
      if (images.length === 0) throw new Error("ComfyUI finished but sent back no pictures. Does the workflow end in a Save Image node?");
      ended(key, recordPictures(tagTarget(found.tag), found.promptId, job, images, !job.temporary && !found.tag.session));
    })
    .catch((e) => failed(key, e))
    .finally(() => endProgress(key));
}

/**
 * Asks ComfyUI for this StoryTime's jobs it is making or has made lately that nothing here has picked up: those being
 * made are shown again and recorded when they finish; those finished but never recorded are recorded and kept as new.
 * ComfyUI may be shared with other StoryTimes and tools: only jobs this one queued (or, from before jobs carried an id,
 * for chapters it has) are picked up. Never throws (ComfyUI may be down).
 */
export async function scanComfy(): Promise<void> {
  const worker = workerState();
  if (worker.scan.running) return;
  const url = (getSettings() ?? parseSettings({})).comfy.url.trim();
  if (!url) return;
  worker.scan.running = true;
  worker.scan.last = Date.now();
  try {
    const mine = instanceId();
    const inItems = new Set(listItems().flatMap((i) => (i.type === "picture" && i.data.promptId ? [i.data.promptId] : [])));
    const found = (await listTaggedJobs(url)).filter((j) => !worker.picked.has(j.promptId) && !inItems.has(j.promptId) && (!j.tag.instance || j.tag.instance === mine));
    if (found.length === 0) return;
    const done = found.filter((j): j is TaggedJob & { state: "done" } => j.state === "done");
    const targets = found.map((j) => tagTarget(j.tag));
    const { known, chapters, stories } = knownPromptIds({
      prompt_ids: done.map((j) => j.promptId),
      chapter_ids: [...new Set(targets.flatMap((t) => (t.kind === "chapter" ? [t.chapterId] : [])))],
      story_ids: [...new Set(targets.flatMap((t) => (t.kind === "chapter" ? [] : [t.storyId])))],
    });
    const knownIds = new Set(known);
    for (const j of found) {
      const t = tagTarget(j.tag);
      if (worker.picked.has(j.promptId) || !(t.kind === "chapter" ? chapters.includes(t.chapterId) : stories.includes(t.storyId))) continue;
      worker.picked.add(j.promptId);
      if (j.state !== "done") watchFound(itemForFound(j), url, j);
      else if (!knownIds.has(j.promptId)) {
        const result = recordPictures(t, j.promptId, j.tag.job, j.images, !j.tag.job.temporary && !j.tag.session);
        if ("gone" in result) continue;
        const key = itemForFound(j);
        ended(key, result);
      }
    }
  } catch {
    // ComfyUI not reachable: the Illustrate page's checkpoint check says so.
  } finally {
    worker.scan.running = false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long, and how often, a restart looks for ComfyUI when it is not up yet (both may be starting together). */
const RECOVER_TRIES = 5;
const RECOVER_WAIT_MS = 3000;

/**
 * Restart recovery (D12) for pictures: a job that was being made in ComfyUI is waited for again and recorded, found by
 * the tag it carries there; one that had not been queued yet goes back to waiting; one ComfyUI no longer knows fails.
 */
export async function recoverPictures(wait = RECOVER_WAIT_MS): Promise<void> {
  const worker = workerState();
  const lost = listItems().filter((i): i is WorkRow<"picture"> => i.type === "picture" && i.state === "working" && !worker.pictures.has(i.key));
  for (const item of lost) {
    const promptId = item.data.promptId;
    if (!promptId) {
      updateItem(item.key, { state: "waiting", data: { progress: undefined } });
      continue;
    }
    const url = (item.data.spec as { comfy?: { url?: string } }).comfy?.url || (getSettings() ?? parseSettings({})).comfy.url.trim();
    let found: TaggedJob | undefined;
    let reached = false;
    for (let attempt = 0; attempt < RECOVER_TRIES && !reached; attempt++) {
      try {
        found = (await listTaggedJobs(url)).find((j) => j.promptId === promptId);
        reached = true;
      } catch {
        if (attempt < RECOVER_TRIES - 1) await sleep(wait);
      }
    }
    if (found) watchFound(item.key, url, found);
    else updateItem(item.key, { state: "failed", data: { message: reached ? "StoryTime restarted, and ComfyUI no longer has this job." : "StoryTime restarted and couldn't reach ComfyUI to find this job.", progress: undefined } });
  }
}

/** How long after the last scan a page opening is enough reason to scan again. */
const RESCAN_MS = 2000;

/** Scans when it is on and the last scan was a while ago: a page has just come into view, so jobs ComfyUI finished meanwhile are looked for now. */
export function scanIfDue() {
  const { scan } = workerState();
  if (scan.enabled && Date.now() - scan.last > RESCAN_MS) void scanComfy();
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
