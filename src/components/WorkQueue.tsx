"use client";

// The work queue (for now it holds picture jobs only): every job asked of ComfyUI, for any chapter, kept for
// the whole app rather than one page, so a job goes on (and is recorded) when the author moves to another page.
// What to send when is decided by `nextActions` (src/lib/workQueue/schedule.ts). It lives in the root
// layout, which stays while pages change. The Illustrate page asks it for jobs and shows its own chapter's;
// a chapter's finished jobs are handed to its page when it is open, and kept until it is opened otherwise.
// After a refresh it finds StoryTime's jobs in ComfyUI's queue and history again (by their tags).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSettings } from "@/lib/settings";
import { freeOllamaForPictures } from "@/lib/ai/ollama";
import { cancelPrompt, listTaggedJobs, waitForPictures, type ComfyImage, type Progress, type TaggedJob } from "@/lib/comfy/client";
import { tagTarget, type JobRecord } from "@/lib/comfy/jobTag";
import { queueJob, sameJob, type JobInput, type UploadCache } from "@/lib/comfy/makeJob";
import { randomSeed } from "@/lib/comfy/workflow";
import type { PictureJob } from "@/lib/pictureJobs";
import { chapterIdOf, chapterTarget, codexTarget, coverTarget, targetKey, targetOfIds, type PictureTarget } from "@/lib/pictureTarget";
import { moveWaiting, schedule, waitingOrder, type Holder, type ReadyPicture } from "@/lib/workQueue/schedule";
import { ApiError, getRun } from "@/lib/aiRuns/api";
import { claim, finish as finishRun, runNextStep, type RunEvent } from "@/lib/aiRuns/runner";
import type { AiRun, RunMode } from "@/lib/aiRuns/types";
import { picturesOf, type PendingJob, type Picture } from "./pictures";

/** How long after the last click a job is sent, so quick clicks with the same settings make one job. */
export const GATHER_MS = 800;
/** The most pictures one job makes; a click beyond it starts another job. */
export const MAX_BATCH = 8;

/** What a job's place in the Pictures panel shows while it is made (a PendingJob without its Stop). */
export type Queued = Omit<PendingJob, "stop">;

/** A job in the queue, for a chapter or the story's cover: being made, or finished (or failed) while its page wasn't open. */
export type QueueJob = Queued & PictureTarget & {
  state: "making" | "done" | "failed";
  /** A finished job's pictures. */
  pictures?: Picture[];
  /** Why it failed, or a warning about a finished job (its pictures couldn't be recorded). */
  message?: string;
  /** When it finished or failed (ms since 1970). */
  endedAt?: number;
  /** Recorded as not seen yet, so it is marked seen once shown or dismissed. */
  unseen?: boolean;
  /** Made for a Refine screen's session (its id), from that session's base picture: only that screen is given its pictures (see `listenSession`). */
  session?: string;
  base?: string;
};

/** What a job's end hands on. */
type Ended = { pictures: Picture[]; warning?: string; unseen?: boolean } | { error: string } | { stopped: true } | { gone: true };

/** What an open page (a chapter's, or the cover's) is told: each finished job's pictures, and how a job ended when there is something to say. */
export type ChapterListener = {
  onPictures: (pictures: Picture[]) => void;
  onStatus: (status: { ok: boolean; text: string }) => void;
};

/** A Refine screen's listener: the same as a page's, and `onPictures` also says which base picture the job started from. */
export type SessionListener = {
  onPictures: (pictures: Picture[], info: { base: string }) => void;
  onStatus: (status: { ok: boolean; text: string }) => void;
};

/** What a page asks for: one more picture for its target, made with `input`; `view` is how its place looks meanwhile. */
export type AskRequest = PictureTarget & {
  input: JobInput;
  view: Omit<Queued, "key" | "count" | "progress">;
};

/** A picture job as an item of the work queue. */
export type PictureItem = QueueJob & { type: "picture" };

/** What the queue shows of an AI run (write ahead). The run itself, and its task list, live on the server. */
export type RunItem = {
  type: "run";
  /** `run:<runId>`, for Dismiss. */
  key: string;
  runId: string;
  storyId: string;
  storyTitle: string;
  startChapterId: string | null;
  startTitle: string;
  mode: RunMode;
  /** Chapters written, of how many. */
  done: number;
  total: number;
  /** What it is on now: the choice being written. */
  current?: string;
  /** `waiting`: its turn hasn't come; `elsewhere`: going in another tab or browser (Open only). */
  state: "waiting" | "working" | "paused" | "done" | "failed" | "elsewhere";
  error?: string;
  /** Why it is paused, when it isn't the author's doing ("Plan ready to check"). */
  note?: string;
  addedAt: number;
};

/** Everything the work queue holds (later work adds other kinds). */
export type WorkItem = PictureItem | RunItem;

/** What a run page listening to its run is told while it works. */
export type RunListener = {
  onEvent: (event: RunEvent) => void;
  /** The run as last saved (after each step). */
  onRun: (run: AiRun) => void;
};

export type QueueApi = {
  /** Oldest first. */
  jobs: QueueJob[];
  ask: (req: AskRequest) => void;
  stop: (key: string) => void;
  /** Takes a finished or failed job off the list without opening its chapter. */
  dismiss: (key: string) => void;
  /** The target's page is open: hands it the jobs that ended while it wasn't, then each as it ends. Returns the way to stop. */
  listen: (target: PictureTarget, listener: ChapterListener) => () => void;
  /**
   * A Refine screen is open: it is handed the pictures of the jobs made for its session (`JobInput.session`) that
   * ended while it wasn't listening (this tab only), then each as it ends. A session's jobs never reach a page's
   * `listen`er, are never "ready" in the header, and are recorded in the job log as temporary like any other. Returns the way to stop.
   */
  listenSession: (sessionId: string, listener: SessionListener) => () => void;
};

/** The work queue: its items, and the picture functions. */
export type WorkQueueApi = Omit<QueueApi, "jobs"> & {
  /** Oldest first. */
  items: WorkItem[];
  /** Keys of the jobs that finished gathering and wait to be sent, in the order they will go (what the queue page shows as Waiting). */
  waiting: string[];
  /** Pause queue: nothing new is sent, what is running finishes. Kept in this browser. */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Moves a waiting job; ignored for a job that isn't waiting (it is gathering, or ComfyUI has it). */
  move: (key: string, how: "up" | "down" | "next") => void;
  /** Puts a run in the queue (it goes `queued` on the server and is claimed when its turn comes). */
  startRun: (runId: string) => Promise<void>;
  /** Stops the run's current request; the run is paused. */
  stopRun: (runId: string) => void;
  /** Puts a paused or failed run back in line. */
  resumeRun: (runId: string) => Promise<void>;
  /** A run page is open: it is told what the run does while it does it. Returns the way to stop. */
  listenRun: (runId: string, listener: RunListener) => () => void;
  /** Who has the machine when taking turns, and what waits: for the header's line. */
  machine: { holder: Holder; waitingPictures: number; waitingWriting: number };
};

/** This tab's id for the leases on AI runs (new at every page load, so a reload is another tab as far as the server knows). */
const TAB_TOKEN: string =
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

// Pause queue is kept in this browser (localStorage, which may be unavailable), so a reload stays paused.
const PAUSE_KEY = "storytime-queue-paused";
let pausedNow: boolean | null = null;
const pauseListeners = new Set<() => void>();
const isPaused = () => {
  if (pausedNow === null) {
    try {
      pausedNow = localStorage.getItem(PAUSE_KEY) === "1";
    } catch {
      pausedNow = false;
    }
  }
  return pausedNow;
};
const writePaused = (paused: boolean) => {
  pausedNow = paused;
  try {
    if (paused) localStorage.setItem(PAUSE_KEY, "1");
    else localStorage.removeItem(PAUSE_KEY);
  } catch {
    // paused until the tab closes
  }
  pauseListeners.forEach((l) => l());
};
const watchPaused = (cb: () => void) => {
  pauseListeners.add(cb);
  return () => void pauseListeners.delete(cb);
};

const QueueContext = createContext<WorkQueueApi | null>(null);

export function useWorkQueue(): WorkQueueApi {
  const api = useContext(QueueContext);
  if (!api) throw new Error("useWorkQueue needs a WorkQueueProvider above it");
  return api;
}

/** The picture jobs of the work queue, as the pages that draw pictures use them. */
export function usePictureQueue(): QueueApi {
  const { items, ask, stop, dismiss, listen, listenSession } = useWorkQueue();
  const jobs = useMemo(() => items.filter((i): i is PictureItem => i.type === "picture"), [items]);
  return useMemo(() => ({ jobs, ask, stop, dismiss, listen, listenSession }), [jobs, ask, stop, dismiss, listen, listenSession]);
}

/** The job's chapter isn't in this StoryTime (deleted meanwhile, or the job is another StoryTime's). */
class ChapterGone extends Error {}

/** Records a finished job in StoryTime's log; returns the record's id. */
async function recordJob(job: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/picture-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) throw new ChapterGone(data.error);
  if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't record the job (${res.status})`);
  return data.id;
}

/** This StoryTime's id, which its jobs carry in ComfyUI (null when it can't be fetched; asked again next time). */
let instance: Promise<string | null> | null = null;
function getInstanceId(): Promise<string | null> {
  instance ??= fetch("/api/instance", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { id?: unknown } | null) => (typeof d?.id === "string" ? d.id : null))
    .catch(() => null)
    .then((id) => {
      if (!id) instance = null;
      return id;
    });
  return instance;
}

/** Jobs marked seen in this tab, which the server may not have heard of yet: not listed as ready again. */
const seenHere = new Set<string>();

/** Marks recorded jobs' pictures as seen, so they are no longer new on their chapter's page or ready in the header. */
export function markJobsSeen(ids: string[]): void {
  if (ids.length === 0) return;
  for (const id of ids) seenHere.add(id);
  void fetch("/api/picture-jobs/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {
    // still new next time; nothing is lost
  });
}

/** The ids of the recorded jobs a finished job's pictures belong to. */
const jobIdsOf = (pictures: Picture[] = []) => [...new Set(pictures.map((p) => p.jobId).filter((id): id is string => id !== null))];

/** Which of these ComfyUI jobs StoryTime has already recorded, and which of these chapters it has. */
async function knownJobs(promptIds: string[], targets: PictureTarget[]): Promise<{ known: Set<string>; has: (t: PictureTarget) => boolean }> {
  // A chapter's job needs the chapter here; a cover job, the story.
  const chapterIds = [...new Set(targets.flatMap((t) => (t.kind === "chapter" ? [t.chapterId] : [])))];
  const storyIds = [...new Set(targets.flatMap((t) => (t.kind === "chapter" ? [] : [t.storyId])))];
  const res = await fetch("/api/picture-jobs/known", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt_ids: promptIds, chapter_ids: chapterIds, story_ids: storyIds }),
  });
  if (!res.ok) throw new Error(`Couldn't check the picture log (${res.status})`);
  const body = (await res.json()) as { known: string[]; chapters: string[]; stories?: string[] };
  const chapters = new Set(body.chapters);
  const stories = new Set(body.stories ?? []);
  return { known: new Set(body.known), has: (t) => (t.kind === "chapter" ? chapters.has(t.chapterId) : stories.has(t.storyId)) };
}

/** A finished job's pictures, as the Illustrate page shows them. */
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

/** How long after the last look ComfyUI is asked again for jobs made elsewhere, when the app comes back into view. */
const RESCAN_MS = 10_000;

/** A job not sent yet, which more clicks can still add pictures to. */
type Gathering = { key: string; target: PictureTarget; input: JobInput; count: number; timer: ReturnType<typeof setTimeout> };

/** Just the target, without the rest of a job. */
const targetOf = (t: PictureTarget): PictureTarget =>
  t.kind === "chapter" ? chapterTarget(t.storyId, t.chapterId) : t.kind === "cover" ? coverTarget(t.storyId) : codexTarget(t.storyId, t.entryId);

export default function WorkQueueProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const comfyUrl = settings.comfy.url;
  // The AI connections as they are now, for the callbacks below (which outlive a render).
  const connectionsRef = useRef(settings.connections);
  useEffect(() => {
    connectionsRef.current = settings.connections;
  }, [settings.connections]);
  const [items, setItems] = useState<PictureItem[]>([]);
  // The same list, for the callbacks below (which outlive a render). The picture items; runs are kept apart (`runItems`).
  const jobsRef = useRef<PictureItem[]>([]);
  const update = useCallback((change: (prev: PictureItem[]) => PictureItem[]) => {
    jobsRef.current = change(jobsRef.current);
    setItems(jobsRef.current);
  }, []);
  const patch = useCallback((key: string, p: Partial<QueueJob>) => update((prev) => prev.map((j) => (j.key === key ? ({ ...j, ...p } as PictureItem) : j))), [update]);
  // What Stop needs for each job being made.
  const controls = useRef(new Map<string, { promptId: string | null; ctl: AbortController; url: string }>());
  // The newest job, while clicks can still add pictures to it.
  const gathering = useRef<Gathering | null>(null);
  // Jobs that finished gathering and wait for `nextActions` to send them, in the order they became ready.
  const ready = useRef<(ReadyPicture & { g: Gathering })[]>([]);
  // The drawing preset of the last job sent, and the grouping setting, for the order the ready jobs go in.
  const lastPreset = useRef<string | null>(null);
  const groupRef = useRef(settings.queue.groupPictures);
  useEffect(() => {
    groupRef.current = settings.queue.groupPictures;
  }, [settings.queue.groupPictures]);
  // The ready jobs' keys in the order they will go, for the queue page.
  const [waiting, setWaiting] = useState<string[]>([]);
  const syncWaiting = useCallback(() => {
    const order = waitingOrder(ready.current, lastPreset.current, groupRef.current).map((r) => r.key);
    setWaiting((prev) => (prev.length === order.length && prev.every((k, i) => k === order[i]) ? prev : order));
  }, []);
  const paused = useSyncExternalStore(watchPaused, isPaused, () => false);
  // Writing: the runs waiting for a step (oldest first), and the run whose step is going now.
  const writingQueue = useRef<string[]>([]);
  const writingActive = useRef<string | null>(null);
  // Who has the machine when taking turns (D18, D19), kept by `schedule`; and what the Queue settings say.
  const holderRef = useRef<Holder>(null);
  const queueSettings = useRef(settings.queue);
  useEffect(() => {
    queueSettings.current = settings.queue;
  }, [settings.queue]);
  const [machine, setMachine] = useState<WorkQueueApi["machine"]>({ holder: null, waitingPictures: 0, waitingWriting: 0 });
  // The functions defined after `pump`, which `pump` and `ended` call.
  const pumpRef = useRef<() => void>(() => {});
  const runStepRef = useRef<(runId: string) => void>(() => {});
  // Keys of jobs sent to ComfyUI and not ended yet.
  const inFlight = useRef(new Set<string>());
  const uploads = useRef<UploadCache["current"]>(null);
  // The pages open now, by `targetKey`.
  const listeners = useRef(new Map<string, ChapterListener>());
  // The Refine screens open now, by session id; and what a session's jobs ended with while its screen wasn't listening
  // (kept in memory only, out of the job list, so the header never shows them).
  const sessionListeners = useRef(new Map<string, SessionListener>());
  const parked = useRef(new Map<string, { base: string; pictures?: Picture[]; message?: string }[]>());
  // ComfyUI jobs already picked up, made here or found in ComfyUI.
  const picked = useRef(new Set<string>());

  /** A job has ended: its chapter's page is told now, or the job is kept until the page is opened. */
  const ended = useCallback(
    (key: string, result: Ended) => {
      controls.current.delete(key);
      inFlight.current.delete(key);
      // The machine may be free for the other kind now.
      queueMicrotask(() => pumpRef.current());
      const job = jobsRef.current.find((j) => j.key === key);
      if (!job) return;
      if (job.session) {
        // A Refine job belongs to its screen alone: never to the target's page, never kept as "ready".
        const sl = sessionListeners.current.get(job.session);
        if ("stopped" in result || "gone" in result) {
          if ("stopped" in result) sl?.onStatus({ ok: true, text: "Stopped." });
        } else {
          const pictures = "pictures" in result ? result.pictures : undefined;
          const message = "error" in result ? result.error : result.warning;
          if (sl) {
            if (pictures) sl.onPictures(pictures, { base: job.base ?? "" });
            if (message) sl.onStatus({ ok: false, text: message });
          } else {
            // The screen isn't open (yet): its pictures wait here for it, briefly (the job log has them as temporary).
            const list = parked.current.get(job.session) ?? [];
            parked.current.set(job.session, [...list, { base: job.base ?? "", pictures, message }].slice(-20));
          }
        }
        return update((prev) => prev.filter((j) => j.key !== key));
      }
      const listener = listeners.current.get(targetKey(job));
      if ("stopped" in result || "gone" in result) {
        if ("stopped" in result) listener?.onStatus({ ok: true, text: "Stopped." });
        return update((prev) => prev.filter((j) => j.key !== key));
      }
      if (listener) {
        if ("pictures" in result) {
          listener.onPictures(result.pictures);
          if (result.unseen) markJobsSeen(jobIdsOf(result.pictures));
        }
        const text = "error" in result ? result.error : result.warning;
        if (text) listener.onStatus({ ok: false, text });
        return update((prev) => prev.filter((j) => j.key !== key));
      }
      // A temporary job's pictures are for the screen that asked; with it gone they aren't "ready" in the header.
      if (job.temporary && "pictures" in result) return update((prev) => prev.filter((j) => j.key !== key));
      patch(key, "error" in result
        ? { state: "failed", message: result.error, endedAt: Date.now() }
        : { state: "done", pictures: result.pictures, message: result.warning, unseen: result.unseen, endedAt: Date.now() });
    },
    [patch, update],
  );

  /** Records a finished job: as not seen yet when its page isn't open. */
  const record = useCallback(
    (target: PictureTarget, promptId: string, job: JobRecord, images: ComfyImage[]) =>
      // A temporary job is never new: it isn't offered in the header's queue.
      recordPictures(target, promptId, job, images, !job.temporary && !listeners.current.has(targetKey(target))),
    [],
  );

  /** Waits for a job ComfyUI has queued, records it and hands on its pictures. */
  const finish = useCallback(
    async (key: string, job: { target: PictureTarget; url: string; promptId: string; clientId: string; record: JobRecord; signal: AbortSignal }) => {
      const images = await waitForPictures(job.url, job.promptId, job.clientId, (progress: Progress) => patch(key, { progress }), job.signal);
      if (images.length === 0) throw new Error("ComfyUI finished but sent back no pictures. Does the workflow end in a Save Image node?");
      return record(job.target, job.promptId, job.record, images);
    },
    [patch, record],
  );

  /** What went wrong, as the end of a job. */
  const failed = useCallback(
    (key: string, e: unknown) =>
      ended(key, e instanceof DOMException && e.name === "AbortError" ? { stopped: true } : { error: e instanceof Error ? e.message : String(e) }),
    [ended],
  );

  /** Sends a ready job: queues it on ComfyUI and waits for its pictures. */
  const send = useCallback(
    async (g: Gathering) => {
      const control = controls.current.get(g.key);
      if (!control) {
        inFlight.current.delete(g.key);
        return;
      }
      try {
        const made = await queueJob(g.input, g.count, { ...g.target, instance: await getInstanceId() }, {
          signal: control.ctl.signal,
          uploads,
          onProgress: (progress) => patch(g.key, { progress }),
          onSize: (width, height) => patch(g.key, { width, height }),
          beforeQueue: () => freeOllamaForPictures(connectionsRef.current),
          onPromptId: (id) => {
            control.promptId = id;
            picked.current.add(id);
          },
        });
        ended(g.key, await finish(g.key, { target: g.target, url: g.input.comfy.url, signal: control.ctl.signal, ...made }));
      } catch (e) {
        failed(g.key, e);
      }
    },
    [ended, failed, finish, patch],
  );

  /** Asks `nextActions` what to do with the ready jobs and does it: a job to send leaves `ready` and counts as in flight. */
  const pump = useCallback(() => {
    const q = queueSettings.current;
    const plan = schedule({
      ready: ready.current.map(({ key, targetKey, drawPreset, readyAt, moved }) => ({ key, targetKey, drawPreset, readyAt, moved })),
      inFlight: [...inFlight.current],
      paused: isPaused(),
      lastPreset: lastPreset.current,
      group: groupRef.current,
      writing: { waiting: writingQueue.current, active: writingActive.current !== null },
      sharing: q.sharing,
      switchMinutes: q.switchMinutes,
      switchItems: q.switchItems,
      now: Date.now(),
      holder: holderRef.current,
    });
    holderRef.current = plan.holder;
    for (const action of plan.actions) {
      if (action.kind === "startWriting") {
        writingQueue.current = writingQueue.current.filter((id) => id !== action.id);
        runStepRef.current(action.id);
        continue;
      }
      const at = ready.current.findIndex((r) => r.key === action.key);
      if (at < 0) continue;
      const [{ g, drawPreset }] = ready.current.splice(at, 1);
      inFlight.current.add(g.key);
      lastPreset.current = drawPreset;
      void send(g);
    }
    // Jobs still held while taking turns say so on their place and in the header.
    if (q.sharing === "turns" && !isPaused()) {
      for (const r of ready.current) {
        const job = jobsRef.current.find((j) => j.key === r.key);
        if (job && job.progress.stage === "gathering") patch(r.key, { progress: { stage: "held" } });
      }
    }
    syncWaiting();
    setMachine({ holder: holderRef.current, waitingPictures: ready.current.length, waitingWriting: writingQueue.current.length });
  }, [patch, send, syncWaiting]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const setPaused = useCallback(
    (value: boolean) => {
      writePaused(value);
      if (!value) pump();
    },
    [pump],
  );

  const move = useCallback(
    (key: string, how: "up" | "down" | "next") => {
      const order = waitingOrder(ready.current, lastPreset.current, groupRef.current);
      const moved = moveWaiting(order, key, how);
      if (moved.every((r, i) => r.key === order[i].key)) return;
      const byKey = new Map(ready.current.map((r) => [r.key, r]));
      ready.current = moved.map((r) => ({ ...byKey.get(r.key)!, moved: true }));
      syncWaiting();
    },
    [syncWaiting],
  );

  // ---- AI runs (write ahead): the queue does one step of a run at a time and puts it back in line ----
  const [runItems, setRunItems] = useState<RunItem[]>([]);
  const runItemsRef = useRef<RunItem[]>([]);
  const updateRuns = useCallback((change: (prev: RunItem[]) => RunItem[]) => {
    runItemsRef.current = change(runItemsRef.current);
    setRunItems(runItemsRef.current);
  }, []);
  const patchRunItem = useCallback(
    (runId: string, p: Partial<RunItem>) => updateRuns((prev) => prev.map((r) => (r.runId === runId ? { ...r, ...p } : r))),
    [updateRuns],
  );
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  // What Stop needs for the run being worked on, and the run pages listening.
  const runControl = useRef(new Map<string, AbortController>());
  const runListeners = useRef(new Map<string, Set<RunListener>>());
  const plainFetch = useCallback((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), []);

  /** The run as last saved: the item's counts, and the run pages listening. */
  const applyRun = useCallback(
    (run: AiRun) => {
      const writes = run.tasks.filter((t) => t.kind === "write");
      patchRunItem(run.id, { done: writes.filter((t) => t.status === "done").length, total: writes.length });
      runListeners.current.get(run.id)?.forEach((l) => l.onRun(run));
    },
    [patchRunItem],
  );

  const onRunEvent = useCallback(
    (runId: string, event: RunEvent) => {
      if (event.type === "task" && event.label) patchRunItem(runId, { current: event.label });
      runListeners.current.get(runId)?.forEach((l) => l.onEvent(event));
    },
    [patchRunItem],
  );

  /** Takes the run, sets it `queued` on the server and puts it in line for its next step. */
  const enqueue = useCallback(
    async (runId: string) => {
      try {
        const run = await claim(runId, TAB_TOKEN, { fetch: plainFetch });
        applyRun(await finishRun(run, "queued", TAB_TOKEN, { fetch: plainFetch }, null));
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return patchRunItem(runId, { state: "elsewhere", error: undefined, note: undefined });
        return patchRunItem(runId, { state: "failed", error: e instanceof Error ? e.message : String(e) });
      }
      patchRunItem(runId, { state: "waiting", error: undefined, note: undefined });
      if (!writingQueue.current.includes(runId)) writingQueue.current.push(runId);
      pumpRef.current();
    },
    [applyRun, patchRunItem, plainFetch],
  );

  const startRun = useCallback(
    async (runId: string) => {
      const existing = runItemsRef.current.find((r) => r.runId === runId);
      if (existing) {
        if (existing.state === "working" || existing.state === "waiting") return;
        patchRunItem(runId, { state: "waiting" });
        return enqueue(runId);
      }
      const run = await getRun(plainFetch, runId);
      let labels: Record<string, { title: string; story_title: string }> = {};
      if (run.start_chapter_id) {
        const res = await fetch(`/api/chapters/labels?ids=${encodeURIComponent(run.start_chapter_id)}`).catch(() => null);
        labels = res?.ok ? ((await res.json()) as { labels: typeof labels }).labels : {};
      }
      const label = run.start_chapter_id ? labels[run.start_chapter_id] : undefined;
      const writes = run.tasks.filter((t) => t.kind === "write");
      updateRuns((prev) => [
        ...prev.filter((r) => r.runId !== runId),
        {
          type: "run", key: `run:${runId}`, runId, storyId: run.story_id, storyTitle: label?.story_title ?? "A story", startChapterId: run.start_chapter_id,
          startTitle: label?.title ?? "", mode: run.mode, done: writes.filter((t) => t.status === "done").length, total: writes.length,
          state: "waiting", addedAt: Date.now(),
        },
      ]);
      await enqueue(runId);
    },
    [enqueue, patchRunItem, plainFetch, updateRuns],
  );

  /** One step of the run, then back in line (or paused, done, failed). */
  const runStep = useCallback(
    async (runId: string) => {
      writingActive.current = runId;
      const ctl = new AbortController();
      runControl.current.set(runId, ctl);
      patchRunItem(runId, { state: "working", error: undefined, note: undefined });
      setMachine((m) => ({ ...m, waitingWriting: writingQueue.current.length }));
      try {
        const run = await claim(runId, TAB_TOKEN, { fetch: plainFetch });
        const out = await runNextStep(run, {
          settings: settingsRef.current,
          token: TAB_TOKEN,
          signal: ctl.signal,
          onEvent: (e) => onRunEvent(runId, e),
          deps: { fetch: plainFetch },
        });
        applyRun(out.run);
        if (out.more) {
          patchRunItem(runId, { state: "waiting" });
          writingQueue.current.push(runId);
        } else if (out.run.status === "done") patchRunItem(runId, { state: "done", current: undefined });
        else if (out.run.status === "review") patchRunItem(runId, { state: "paused", note: "Plan ready to check", current: undefined });
        else if (out.run.error && !ctl.signal.aborted) patchRunItem(runId, { state: "failed", error: out.run.error, current: undefined });
        else patchRunItem(runId, { state: "paused", current: undefined });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) patchRunItem(runId, { state: "elsewhere", current: undefined });
        else patchRunItem(runId, { state: "failed", error: e instanceof Error ? e.message : String(e), current: undefined });
      } finally {
        writingActive.current = null;
        runControl.current.delete(runId);
        pumpRef.current();
      }
    },
    [applyRun, onRunEvent, patchRunItem, plainFetch],
  );
  useEffect(() => {
    runStepRef.current = (id) => void runStep(id);
  }, [runStep]);

  const stopRun = useCallback(
    (runId: string) => {
      if (writingActive.current === runId) return runControl.current.get(runId)?.abort();
      if (!writingQueue.current.includes(runId)) return;
      writingQueue.current = writingQueue.current.filter((id) => id !== runId);
      patchRunItem(runId, { state: "paused" });
      pumpRef.current();
      void claim(runId, TAB_TOKEN, { fetch: plainFetch })
        .then((run) => finishRun(run, "paused", TAB_TOKEN, { fetch: plainFetch }))
        .then(applyRun)
        .catch(() => {
          // the run stays queued on the server; it shows as paused here
        });
    },
    [applyRun, patchRunItem, plainFetch],
  );

  const resumeRun = useCallback(
    async (runId: string) => {
      const item = runItemsRef.current.find((r) => r.runId === runId);
      if (!item || item.state === "working" || item.state === "waiting") return;
      patchRunItem(runId, { state: "waiting", error: undefined, note: undefined });
      await enqueue(runId);
    },
    [enqueue, patchRunItem],
  );

  const listenRun = useCallback((runId: string, listener: RunListener) => {
    const set = runListeners.current.get(runId) ?? new Set<RunListener>();
    set.add(listener);
    runListeners.current.set(runId, set);
    return () => void set.delete(listener);
  }, []);

  /** Runs the server lists as unfinished that this tab doesn't have: going in another tab ("elsewhere"), or paused here to resume. Nothing starts by itself. */
  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-runs?unfinished=1", { cache: "no-store" });
      if (!res.ok) return;
      const { runs } = (await res.json()) as {
        runs: { id: string; story_id: string; start_chapter_id: string | null; mode: RunMode; leased: boolean; error: string | null; story_title?: string; start_title?: string | null; chapters: { done: number; total: number } }[];
      };
      const listed = new Map(runs.map((r) => [r.id, r]));
      updateRuns((prev) => {
        // Runs of other tabs that have gone from the list are dropped; the ones still there follow their lease.
        const kept = prev
          .filter((r) => !((r.state === "elsewhere" || r.state === "paused") && !listed.has(r.runId)))
          .map((r) => {
            const found = listed.get(r.runId);
            return found && (r.state === "elsewhere" || r.state === "paused") ? { ...r, state: found.leased ? ("elsewhere" as const) : ("paused" as const) } : r;
          });
        const known = new Set(kept.map((r) => r.runId));
        const added: RunItem[] = runs
          .filter((r) => !known.has(r.id))
          .map((r) => ({
            type: "run", key: `run:${r.id}`, runId: r.id, storyId: r.story_id, storyTitle: r.story_title ?? "A story", startChapterId: r.start_chapter_id,
            startTitle: r.start_title ?? "", mode: r.mode, done: r.chapters.done, total: r.chapters.total, state: r.leased ? "elsewhere" : "paused",
            ...(r.error && !r.leased && { error: r.error }), addedAt: Date.now(),
          }));
        return [...kept, ...added];
      });
    } catch {
      // asked again when the app next comes into view
    }
  }, [updateRuns]);

  /** A gathered job is closed (its timer ran out, or a different click came): no more clicks join it, and it waits to be sent. */
  const markReady = useCallback(
    (g: Gathering) => {
      if (gathering.current === g) gathering.current = null;
      clearTimeout(g.timer);
      if (ready.current.some((r) => r.key === g.key)) return;
      ready.current.push({ key: g.key, targetKey: targetKey(g.target), drawPreset: g.input.draw.id ?? null, readyAt: Date.now(), g });
      pump();
    },
    [pump],
  );

  /**
   * One more picture. Clicks with the same target (chapter or cover), prompt and settings, each within
   * GATHER_MS of the last, are gathered into one job (up to MAX_BATCH pictures); a click with anything
   * changed sends the job being gathered at once and starts another. With Settings › Drawing's batching
   * off, each click is sent at once.
   */
  const ask = useCallback(
    ({ input, view, ...asked }: AskRequest) => {
      const target = targetOf(asked);
      const g = gathering.current;
      const gathers = input.comfy.batchClicks;
      if (gathers && g && targetKey(g.target) === targetKey(target) && sameJob(g.input) === sameJob(input) && g.count < MAX_BATCH) {
        g.count += 1;
        clearTimeout(g.timer);
        g.timer = setTimeout(() => markReady(g), GATHER_MS);
        return patch(g.key, { count: g.count });
      }
      if (g) markReady(g);
      const key = `job-${randomSeed().toString(36)}`;
      controls.current.set(key, { promptId: null, ctl: new AbortController(), url: input.comfy.url });
      const next: Gathering = { key, target, input, count: 1, timer: setTimeout(() => markReady(next), gathers ? GATHER_MS : 0) };
      gathering.current = next;
      update((prev) => [...prev, { type: "picture", ...view, ...(input.temporary && { temporary: true }), ...(input.session && { session: input.session, base: input.base ?? "" }), key, count: 1, progress: { stage: "gathering" }, ...target, state: "making" }]);
    },
    [markReady, patch, update],
  );

  const stop = useCallback(
    (key: string) => {
      const g = gathering.current;
      if (g?.key === key) {
        // Not sent yet: just drop it.
        clearTimeout(g.timer);
        gathering.current = null;
        return ended(key, { stopped: true });
      }
      const held = ready.current.findIndex((r) => r.key === key);
      if (held >= 0) {
        // Ready but not sent yet: drop it the same way.
        ready.current.splice(held, 1);
        syncWaiting();
        return ended(key, { stopped: true });
      }
      const c = controls.current.get(key);
      if (!c) return;
      if (c.promptId) void cancelPrompt(c.url, c.promptId);
      c.ctl.abort();
    },
    [ended, syncWaiting],
  );

  const dismiss = useCallback(
    (key: string) => {
      if (key.startsWith("run:")) {
        // A run that is going or waiting can't be dismissed (Stop it first).
        return updateRuns((prev) => prev.filter((r) => r.key !== key || r.state === "working" || r.state === "waiting"));
      }
      const job = jobsRef.current.find((j) => j.key === key && j.state !== "making");
      if (!job) return;
      if (job.unseen) markJobsSeen(jobIdsOf(job.pictures));
      update((prev) => prev.filter((j) => j !== job));
    },
    [update, updateRuns],
  );

  const listen = useCallback(
    (target: PictureTarget, listener: ChapterListener) => {
      const at = targetKey(target);
      listeners.current.set(at, listener);
      const waiting = jobsRef.current.filter((j) => targetKey(j) === at && j.state !== "making");
      if (waiting.length) {
        update((prev) => prev.filter((j) => !waiting.includes(j)));
        for (const j of waiting) {
          // They finished while the page wasn't open, so they are marked new there.
          if (j.pictures) listener.onPictures(j.pictures.map((p) => ({ ...p, isNew: true })));
          if (j.message) listener.onStatus({ ok: false, text: j.message });
        }
        markJobsSeen(waiting.filter((j) => j.unseen).flatMap((j) => jobIdsOf(j.pictures)));
      }
      return () => {
        if (listeners.current.get(at) === listener) listeners.current.delete(at);
      };
    },
    [update],
  );

  const listenSession = useCallback((sessionId: string, listener: SessionListener) => {
    sessionListeners.current.set(sessionId, listener);
    const waiting = parked.current.get(sessionId);
    parked.current.delete(sessionId);
    for (const w of waiting ?? []) {
      if (w.pictures) listener.onPictures(w.pictures, { base: w.base });
      if (w.message) listener.onStatus({ ok: false, text: w.message });
    }
    return () => {
      if (sessionListeners.current.get(sessionId) === listener) sessionListeners.current.delete(sessionId);
    };
  }, []);

  /** Shows a job found in ComfyUI's queue like one asked for here, and records it when it finishes. */
  const resume = useCallback(
    (url: string, found: TaggedJob) => {
      const { job, clientId } = found.tag;
      const target = tagTarget(found.tag);
      const key = `job-${randomSeed().toString(36)}`;
      const ctl = new AbortController();
      controls.current.set(key, { promptId: found.promptId, ctl, url });
      // A job found in ComfyUI counts as pictures holding the machine (taking turns).
      inFlight.current.add(key);
      update((prev) => [
        ...prev,
        {
          type: "picture",
          key,
          ...target,
          state: "making",
          count: job.count,
          progress: { stage: "queued", ahead: null },
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
          ...(found.tag.session && { session: found.tag.session, base: found.tag.base ?? "" }),
        },
      ]);
      finish(key, { target, url, promptId: found.promptId, clientId, record: job, signal: ctl.signal }).then(
        (result) => ended(key, result),
        (e) => failed(key, e),
      );
    },
    [ended, failed, finish, update],
  );

  /** A finished job that wasn't made in this tab: handed to its chapter's page if it is open, else kept. */
  const keep = useCallback(
    (job: Omit<Queued, "key" | "progress"> & PictureTarget & { session?: string; base?: string }, result: Ended) => {
      const key = `job-${randomSeed().toString(36)}`;
      update((prev) => [...prev, { type: "picture", ...job, key, progress: { stage: "loading" }, state: "making" }]);
      ended(key, result);
    },
    [ended, update],
  );

  /** A job ComfyUI finished that was never recorded (the page that asked for it was gone): records it and keeps it as new. */
  const adopt = useCallback(
    async (found: TaggedJob & { state: "done" }) => {
      const { job } = found.tag;
      const target = tagTarget(found.tag);
      const result = await record(target, found.promptId, job, found.images);
      if ("gone" in result) return;
      keep(
        {
          ...target, count: job.count, prompt: job.prompt, negative: job.negative, checkpoint: job.checkpoint, width: job.width, height: job.height,
          denoise: job.denoise ?? null, source: job.source ?? null, mask: job.mask ?? null, refs: job.refs ?? [], instruction: job.instruction ?? null, editModel: job.edit_model ?? null, moment: job.moment,
          ...(job.temporary && { temporary: true }),
          ...(found.tag.session && { session: found.tag.session, base: found.tag.base ?? "" }),
        },
        result,
      );
    },
    [keep, record],
  );

  // Jobs recorded but not seen yet, from the server: finished while their chapter's page wasn't open, in
  // this browser or another. Those not in the list already are added as ready.
  const loadUnseen = useCallback(async () => {
    try {
      const res = await fetch("/api/picture-jobs?unseen=1", { cache: "no-store" });
      if (!res.ok) return;
      const { jobs: found } = (await res.json()) as { jobs: PictureJob[] };
      const listed = new Set(jobsRef.current.flatMap((j) => jobIdsOf(j.pictures)));
      for (const j of [...found].reverse()) {
        if (listed.has(j.id) || seenHere.has(j.id)) continue;
        listed.add(j.id);
        keep(
          {
            ...targetOfIds(j.story_id, j.chapter_id, j.entry_id), count: j.images.length, prompt: j.prompt, negative: j.negative, checkpoint: j.checkpoint,
            width: j.width, height: j.height, denoise: j.denoise, source: j.source, mask: j.mask, refs: j.refs ?? [], instruction: j.instruction, editModel: j.edit_model, moment: j.moment,
          },
          { pictures: picturesOf([j]), unseen: true },
        );
      }
    } catch {
      // asked again when the app next comes into view
    }
  }, [keep]);

  // On opening the app, and when it comes back into view, ComfyUI is asked for StoryTime's jobs it is making
  // or has made lately that this app hasn't picked up: those being made are shown again, and those finished
  // but never recorded are recorded and kept as new.
  const scanning = useRef(false);
  const lastScan = useRef(0);
  const scan = useCallback(
    async (url: string) => {
      if (scanning.current) return;
      scanning.current = true;
      try {
        // ComfyUI may be shared with other StoryTimes and tools: only jobs this one queued (or, from before
        // jobs carried an id, for chapters it has) are picked up.
        const mine = await getInstanceId();
        const found = (await listTaggedJobs(url)).filter((j) => !picked.current.has(j.promptId) && (!j.tag.instance || !mine || j.tag.instance === mine));
        if (found.length === 0) return;
        const done = found.filter((j): j is TaggedJob & { state: "done" } => j.state === "done");
        const { known, has } = await knownJobs(done.map((j) => j.promptId), found.map((j) => tagTarget(j.tag)));
        for (const j of found) {
          if (picked.current.has(j.promptId) || !has(tagTarget(j.tag))) continue;
          picked.current.add(j.promptId);
          if (j.state !== "done") resume(url, j);
          else if (!known.has(j.promptId)) void adopt(j);
        }
      } catch {
        // ComfyUI not reachable: the Illustrate page's checkpoint check says so.
      } finally {
        scanning.current = false;
      }
    },
    [adopt, resume],
  );
  // The new jobs the server has come first, so a job found in ComfyUI and recorded meanwhile isn't listed twice.
  useEffect(() => {
    const look = async () => {
      lastScan.current = Date.now();
      void loadRuns();
      await loadUnseen();
      if (comfyUrl) await scan(comfyUrl);
    };
    void look();
    const again = () => {
      if (document.visibilityState === "visible" && Date.now() - lastScan.current > RESCAN_MS) void look();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [comfyUrl, scan, loadUnseen, loadRuns]);

  // Closing the tab while writing goes on, or pictures are held back here, loses that work: ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (writingActive.current !== null || ready.current.length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const allItems = useMemo<WorkItem[]>(() => [...items, ...runItems], [items, runItems]);
  const api = useMemo(
    () => ({ items: allItems, ask, stop, dismiss, listen, listenSession, waiting, paused, setPaused, move, startRun, stopRun, resumeRun, listenRun, machine }),
    [allItems, ask, stop, dismiss, listen, listenSession, waiting, paused, setPaused, move, startRun, stopRun, resumeRun, listenRun, machine],
  );
  // For the browser tests: the run page that starts runs comes later, so a test page asks for the queue itself.
  useEffect(() => {
    const w = window as unknown as { __STORYTIME_TEST__?: boolean; __storytimeQueue?: unknown };
    if (w.__STORYTIME_TEST__) w.__storytimeQueue = api;
  }, [api]);
  return <QueueContext.Provider value={api}>{children}</QueueContext.Provider>;
}

/** Records a finished job in the log and makes its pictures. The pictures are usable even if recording fails. */
async function recordPictures(target: PictureTarget, promptId: string, record: JobRecord, images: ComfyImage[], unseen: boolean): Promise<Ended> {
  const chapterId = chapterIdOf(target);
  try {
    // A cover job is recorded for its story, a codex job for its story and entry.
    const by = target.kind === "chapter" ? { chapter_id: target.chapterId } : target.kind === "cover" ? { story_id: target.storyId } : { story_id: target.storyId, entry_id: target.entryId };
    const jobId = await recordJob({ ...by, prompt_id: promptId, ...record, images, unseen });
    return { pictures: picturesOfJob(chapterId, jobId, promptId, record, images), unseen };
  } catch (e) {
    // Not this StoryTime's chapter: nothing to show or to warn about.
    if (e instanceof ChapterGone) return { gone: true };
    return {
      pictures: picturesOfJob(chapterId, null, promptId, record, images),
      warning: `The pictures are ready, but StoryTime couldn't record how they were made: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
