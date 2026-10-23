"use client";

// The picture queue: every job asked of ComfyUI, for any chapter, kept for the whole app rather than one
// page, so a job goes on (and is recorded) when the author moves to another page. It lives in the root
// layout, which stays while pages change. The Illustrate page asks it for jobs and shows its own chapter's;
// a chapter's finished jobs are handed to its page when it is open, and kept until it is opened otherwise.
// After a refresh it finds StoryTime's jobs in ComfyUI's queue and history again (by their tags).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/lib/settings";
import { freeOllamaForPictures } from "@/lib/ai/ollama";
import { cancelPrompt, listTaggedJobs, waitForPictures, type ComfyImage, type Progress, type TaggedJob } from "@/lib/comfy/client";
import { tagTarget, type JobRecord } from "@/lib/comfy/jobTag";
import { queueJob, sameJob, type JobInput, type UploadCache } from "@/lib/comfy/makeJob";
import { randomSeed } from "@/lib/comfy/workflow";
import type { PictureJob } from "@/lib/pictureJobs";
import { chapterIdOf, chapterTarget, codexTarget, coverTarget, targetKey, targetOfIds, type PictureTarget } from "@/lib/pictureTarget";
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

type QueueApi = {
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

const QueueContext = createContext<QueueApi | null>(null);

export function usePictureQueue(): QueueApi {
  const api = useContext(QueueContext);
  if (!api) throw new Error("usePictureQueue needs a PictureQueueProvider above it");
  return api;
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

export default function PictureQueueProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const comfyUrl = settings.comfy.url;
  // The AI connections as they are now, for the callbacks below (which outlive a render).
  const connectionsRef = useRef(settings.connections);
  useEffect(() => {
    connectionsRef.current = settings.connections;
  }, [settings.connections]);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  // The same list, for the callbacks below (which outlive a render).
  const jobsRef = useRef<QueueJob[]>([]);
  const update = useCallback((change: (prev: QueueJob[]) => QueueJob[]) => {
    jobsRef.current = change(jobsRef.current);
    setJobs(jobsRef.current);
  }, []);
  const patch = useCallback((key: string, p: Partial<QueueJob>) => update((prev) => prev.map((j) => (j.key === key ? ({ ...j, ...p } as QueueJob) : j))), [update]);
  // What Stop needs for each job being made.
  const controls = useRef(new Map<string, { promptId: string | null; ctl: AbortController; url: string }>());
  // The newest job, while clicks can still add pictures to it.
  const gathering = useRef<Gathering | null>(null);
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

  /** Sends a gathered job: no more clicks join it. Queues it on ComfyUI and waits for its pictures. */
  const send = useCallback(
    async (g: Gathering) => {
      if (gathering.current === g) gathering.current = null;
      const control = controls.current.get(g.key);
      if (!control) return;
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

  /**
   * One more picture. Clicks with the same target (chapter or cover), prompt and settings, each within
   * GATHER_MS of the last, are gathered into one job (up to MAX_BATCH pictures); a click with anything
   * changed sends the job being gathered at once and starts another.
   */
  const ask = useCallback(
    ({ input, view, ...asked }: AskRequest) => {
      const target = targetOf(asked);
      const g = gathering.current;
      if (g && targetKey(g.target) === targetKey(target) && sameJob(g.input) === sameJob(input) && g.count < MAX_BATCH) {
        g.count += 1;
        clearTimeout(g.timer);
        g.timer = setTimeout(() => void send(g), GATHER_MS);
        return patch(g.key, { count: g.count });
      }
      if (g) {
        clearTimeout(g.timer);
        void send(g);
      }
      const key = `job-${randomSeed().toString(36)}`;
      controls.current.set(key, { promptId: null, ctl: new AbortController(), url: input.comfy.url });
      const next: Gathering = { key, target, input, count: 1, timer: setTimeout(() => void send(next), GATHER_MS) };
      gathering.current = next;
      update((prev) => [...prev, { ...view, ...(input.temporary && { temporary: true }), ...(input.session && { session: input.session, base: input.base ?? "" }), key, count: 1, progress: { stage: "gathering" }, ...target, state: "making" }]);
    },
    [patch, send, update],
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
      const c = controls.current.get(key);
      if (!c) return;
      if (c.promptId) void cancelPrompt(c.url, c.promptId);
      c.ctl.abort();
    },
    [ended],
  );

  const dismiss = useCallback(
    (key: string) => {
      const job = jobsRef.current.find((j) => j.key === key && j.state !== "making");
      if (!job) return;
      if (job.unseen) markJobsSeen(jobIdsOf(job.pictures));
      update((prev) => prev.filter((j) => j !== job));
    },
    [update],
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
      update((prev) => [
        ...prev,
        {
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
      update((prev) => [...prev, { ...job, key, progress: { stage: "loading" }, state: "making" }]);
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
      await loadUnseen();
      if (comfyUrl) await scan(comfyUrl);
    };
    void look();
    const again = () => {
      if (document.visibilityState === "visible" && Date.now() - lastScan.current > RESCAN_MS) void look();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [comfyUrl, scan, loadUnseen]);

  const api = useMemo(() => ({ jobs, ask, stop, dismiss, listen, listenSession }), [jobs, ask, stop, dismiss, listen, listenSession]);
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
