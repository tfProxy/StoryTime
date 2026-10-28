"use client";

// The work queue as the browser sees it. The work itself (picture jobs sent to ComfyUI, AI runs, Generates) is done by
// the StoryTime server, which keeps going with every tab closed (src/lib/worker). This is a
// client of it: it follows the server's items over server-sent events (`/api/queue/events`), asks and stops through
// its routes, and hands a chapter's (or a Refine session's) finished jobs to the page that is open on it. It lives in
// the root layout, which stays while pages change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { maskUploadKey, toSpec } from "@/lib/comfy/jobSpec";
import { maskOf, refsOf, type JobInput } from "@/lib/comfy/makeJob";
import { renderMask } from "@/lib/mask";
import type { PictureJob } from "@/lib/pictureJobs";
import { chapterTarget, codexTarget, coverTarget, targetKey, targetOfIds, type PictureTarget } from "@/lib/pictureTarget";
import type { Holder } from "@/lib/workQueue/schedule";
import type { RunEvent } from "@/lib/aiRuns/runner";
import type { AiRun, RunMode } from "@/lib/aiRuns/types";
import type { Length, StoryContext } from "@/lib/ai/prompts";
import type { Draft } from "@/lib/drafts";
import type { ModelRef } from "@/lib/settingsSchema";
import { picturesOf, type PendingJob, type Picture } from "./pictures";

/** How long after the last click a job is closed, so quick clicks with the same settings make one job (the server does it). */
export const GATHER_MS = 800;
/** The most pictures one job makes; a click beyond it starts another job (the server does it). */
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

/** What an open page (a chapter's, or the cover's) is told: each finished job's pictures, and how a job ended when there is something to say. */
export type ChapterListener = {
  onPictures: (pictures: Picture[]) => void;
  onStatus: (status: { ok: boolean; text: string }) => void;
};

/** A Refine screen's listener: the same as a page's, and `onPictures` also says which base picture the job started from. */
export type SessionListener = {
  onPictures: (pictures: Picture[], info: { base: string }) => void;
  onStatus: (status: { ok: boolean; text: string }) => void;
  /** A job of the session failed (`base` is the one it was asked with); Make missing pictures retries it once. */
  onFailed?: (base: string, message: string) => void;
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
  /** A review the server queued after an AI run, for the chapters it wrote. */
  automatic?: boolean;
  /** Chapters written, of how many. */
  done: number;
  total: number;
  /** What it is on now: the choice being written. */
  current?: string;
  /** `waiting`: its turn hasn't come. */
  state: "waiting" | "working" | "paused" | "done" | "failed";
  error?: string;
  /** Why it is paused, when it isn't the author's doing ("Plan ready to check"). */
  note?: string;
  addedAt: number;
};

/** What the writing page asks the queue to generate: everything the request needs, so it can finish with the page gone. */
export type GenerateRequest = {
  /** The draft's key (`fill:<choice id>` and so on): one Generate per draft. */
  key: string;
  /** Where the draft is written, for Open. */
  href: string;
  label: string;
  /** The story so far, as it is now (the older chapters are summarized first if the prompt needs it). */
  ctx: StoryContext;
  direction: string;
  length: Length;
  model: ModelRef | null;
  suggestModel: ModelRef | null;
  /** After the chapter: make the choice text for the previous chapter, and suggest choices for this one. */
  after: { choiceText: boolean; suggestChoices: boolean };
  /** The draft's title and text when it started, which applying the new text keeps as the previous version. */
  base: { title: string; body: string };
  /** The draft as the page has it, to start from when the server has none saved yet. */
  draft: Draft;
};

/** A Generate from the writing page, as an item of the queue (D15). The text itself is kept apart, for `listenDraft`. */
export type GenerateItem = {
  type: "generate";
  /** `gen:<draft key>`, for Dismiss. */
  key: string;
  draftKey: string;
  href: string;
  label: string;
  state: "waiting" | "working" | "done" | "failed";
  /** Why it waits ("Waiting for pictures to finish (2 left)"). */
  note?: string;
  error?: string;
  /** Kept with an error that lost the text, so it can be copied. */
  text?: string;
  addedAt: number;
};

/** What a writing page open on a draft is told while its Generate goes on. */
export type DraftListener = {
  /** The text so far (all of it, each time), and the draft's text when the Generate started. */
  onText: (text: string, base: { title: string; body: string }) => void;
  onDone: (after: { choiceLabel?: string; suggestions?: string[] }) => void;
  onError: (message: string) => void;
};

/** Everything the work queue holds (later work adds other kinds). */
export type WorkItem = PictureItem | RunItem | GenerateItem;

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
   * ended while it wasn't listening, then each as it ends. A session's jobs never reach a page's `listen`er, are never
   * "ready" in the header, and are recorded in the job log as temporary like any other. Returns the way to stop.
   */
  listenSession: (sessionId: string, listener: SessionListener) => () => void;
};

/** The work queue: its items, and the picture functions. */
export type WorkQueueApi = Omit<QueueApi, "jobs"> & {
  /** Oldest first. */
  items: WorkItem[];
  /** Keys of the jobs that finished gathering and wait to be sent, in the order they will go (what the queue page shows as Waiting). */
  waiting: string[];
  /** Pause queue: nothing new is sent, what is running finishes. Kept on the server, so it is the same on every device. */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Moves a waiting job; ignored for a job that isn't waiting (it is gathering, or ComfyUI has it). */
  move: (key: string, how: "up" | "down" | "next") => void;
  /** Puts a run in the queue (it goes `queued` on the server and the server does its steps in turn). */
  startRun: (runId: string) => Promise<void>;
  /** Stops the run's current request; the run is paused. */
  stopRun: (runId: string) => void;
  /** Puts a paused or failed run back in line. */
  resumeRun: (runId: string) => Promise<void>;
  /** A run page is open: it is told what the run does while it does it. Returns the way to stop. */
  listenRun: (runId: string, listener: RunListener) => () => void;
  /** Hands a Generate to the queue (it goes before waiting runs, D16). A Generate already going for that draft is left alone. */
  generate: (request: GenerateRequest) => void;
  /** Stops it: what was written so far stays in the draft. */
  stopGenerate: (draftKey: string) => void;
  /** The writing page for the draft is open: it is told the text as it comes (a page that joins late first gets the text so far) and applies it to its own draft. Returns the way to stop. */
  listenDraft: (draftKey: string, listener: DraftListener) => () => void;
  /** Who has the machine when taking turns, and what waits: for the header's line. */
  machine: { holder: Holder; waitingPictures: number; waitingWriting: number };
};

// ---- what the server sends: a row of its `work_items` table (src/lib/worker/items.ts) ----

type PictureRow = {
  key: string;
  type: "picture";
  state: "gathering" | "waiting" | "working" | "paused" | "done" | "failed";
  data: {
    target: PictureTarget;
    count: number;
    view: Omit<Queued, "key" | "count" | "progress">;
    progress?: Queued["progress"];
    pictures?: Picture[];
    message?: string;
    unseen?: boolean;
    session?: string;
    base?: string;
  };
  endedAt: number | null;
  createdAt: number;
};
type RunRow = {
  key: string;
  type: "run";
  state: RunItem["state"] | "gathering";
  data: Omit<RunItem, "type" | "key" | "state" | "addedAt">;
  createdAt: number;
};
type GenerateRow = {
  key: string;
  type: "generate";
  state: GenerateItem["state"] | "gathering" | "paused";
  data: { draftKey: string; href: string; label: string; note?: string; error?: string; text?: string };
  createdAt: number;
};
type Row = PictureRow | RunRow | GenerateRow;

type ServerEvent =
  | { type: "items"; items: Row[] }
  | { type: "item"; item: Row }
  | { type: "removed"; key: string }
  | { type: "machine"; machine: WorkQueueApi["machine"]; waiting: string[]; paused: boolean };

const pictureItem = (r: PictureRow): PictureItem => {
  const { target, count, view, progress, pictures, message, unseen, session, base } = r.data;
  return {
    type: "picture",
    ...view,
    ...target,
    key: r.key,
    count,
    progress: progress ?? { stage: "gathering" },
    state: r.state === "done" ? "done" : r.state === "failed" ? "failed" : "making",
    ...(pictures && { pictures }),
    ...(message && { message }),
    ...(r.endedAt !== null && { endedAt: r.endedAt }),
    ...(unseen && { unseen }),
    ...(session && { session, base: base ?? "" }),
  };
};

const runItem = (r: RunRow): RunItem => ({ type: "run", key: r.key, ...r.data, state: r.state === "gathering" ? "waiting" : r.state, addedAt: r.createdAt });

const generateItem = (r: GenerateRow): GenerateItem => ({
  type: "generate",
  key: r.key,
  ...r.data,
  state: r.state === "gathering" || r.state === "paused" ? "waiting" : r.state,
  addedAt: r.createdAt,
});

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

/** Just the target, without the rest of a job. */
const targetOf = (t: PictureTarget): PictureTarget =>
  t.kind === "chapter" ? chapterTarget(t.storyId, t.chapterId) : t.kind === "cover" ? coverTarget(t.storyId) : codexTarget(t.storyId, t.entryId);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** An answer that is not ok, as the error it carries. */
async function failure(res: Response): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error((data as { error?: string } | null)?.error ?? `The request failed (${res.status})`);
}

const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const itemUrl = (key: string) => `/api/queue/items/${encodeURIComponent(key)}`;

// Pause queue used to be kept in this browser (localStorage); it is on the server now. The old setting is sent to the server once.
const OLD_PAUSE_KEY = "storytime-queue-paused";

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

export default function WorkQueueProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);
  const applyRows = useCallback((change: (prev: Row[]) => Row[]) => {
    rowsRef.current = change(rowsRef.current);
    setRows(rowsRef.current);
  }, []);
  // Finished jobs the server's log has that are not in the list (finished while the app was closed, long ago): shown as ready.
  const [kept, setKept] = useState<PictureItem[]>([]);
  const keptRef = useRef<PictureItem[]>([]);
  const updateKept = useCallback((change: (prev: PictureItem[]) => PictureItem[]) => {
    keptRef.current = change(keptRef.current);
    setKept(keptRef.current);
  }, []);
  const [machine, setMachine] = useState<WorkQueueApi["machine"]>({ holder: null, waitingPictures: 0, waitingWriting: 0 });
  const [waiting, setWaiting] = useState<string[]>([]);
  const [paused, setPausedState] = useState(false);

  // The pages open now: a chapter's (by `targetKey`) and the Refine screens (by session id).
  const listeners = useRef(new Map<string, ChapterListener>());
  const sessionListeners = useRef(new Map<string, SessionListener>());
  // Jobs this tab stopped (told "Stopped." when they go), and jobs already handed on (a job is handed on once).
  const stoppedHere = useRef(new Set<string>());
  const handed = useRef(new Set<string>());

  /** Takes a job off the server's list (it is finished or failed), and off ours. */
  const dismissOnServer = useCallback(
    (key: string) => {
      applyRows((prev) => prev.filter((r) => r.key !== key));
      void fetch(itemUrl(key), { method: "DELETE" }).catch(() => {
        // it stays on the server's list until dismissed again
      });
    },
    [applyRows],
  );

  /** A finished job of a Refine session goes to the screen that is open on it; with none open it waits on the server. */
  const handToSession = useCallback(
    (row: PictureRow): boolean => {
      const { session, base, pictures, message } = row.data;
      const sl = session ? sessionListeners.current.get(session) : undefined;
      if (!sl || !session) return false;
      handed.current.add(row.key);
      if (row.state === "done" && pictures) sl.onPictures(pictures, { base: base ?? "" });
      if (message) sl.onStatus({ ok: false, text: message });
      if (row.state === "failed") sl.onFailed?.(base ?? "", message ?? "");
      dismissOnServer(row.key);
      return true;
    },
    [dismissOnServer],
  );

  /** A finished job of a chapter goes to its page when it is open; a temporary one that nobody is waiting for is dropped. */
  const handToPage = useCallback(
    (row: PictureRow, wasClosed: boolean): boolean => {
      const listener = listeners.current.get(targetKey(row.data.target));
      const { pictures, message, unseen, view } = row.data;
      if (listener) {
        handed.current.add(row.key);
        if (row.state === "done" && pictures) {
          // Jobs that finished while the page wasn't open are marked new there.
          listener.onPictures(wasClosed ? pictures.map((p) => ({ ...p, isNew: true })) : pictures);
          if (unseen) markJobsSeen(jobIdsOf(pictures));
        }
        if (message) listener.onStatus({ ok: false, text: message });
        dismissOnServer(row.key);
        return true;
      }
      // A temporary job's pictures are for the screen that asked; with it gone they aren't "ready" in the header.
      if (view.temporary && row.state === "done") {
        handed.current.add(row.key);
        dismissOnServer(row.key);
        return true;
      }
      return false;
    },
    [dismissOnServer],
  );

  /** A job that ended: handed to whoever is waiting for it (once), otherwise left in the list. */
  const deliver = useCallback(
    (row: Row, wasClosed = false) => {
      if (row.type !== "picture" || (row.state !== "done" && row.state !== "failed") || handed.current.has(row.key)) return;
      if (row.data.session) handToSession(row);
      else handToPage(row, wasClosed);
    },
    [handToPage, handToSession],
  );

  // ---- following the server ----
  const connect = useRef<() => void>(() => {});
  const loadUnseenRef = useRef<() => void>(() => {});
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let wait = 1000;
    let live = true;
    const handle = (event: ServerEvent) => {
      if (event.type === "items") {
        applyRows(() => event.items);
        for (const r of event.items) deliver(r);
        loadUnseenRef.current();
      } else if (event.type === "item") {
        applyRows((prev) => (prev.some((r) => r.key === event.item.key) ? prev.map((r) => (r.key === event.item.key ? event.item : r)) : [...prev, event.item]));
        deliver(event.item);
      } else if (event.type === "removed") {
        const gone = rowsRef.current.find((r) => r.key === event.key);
        applyRows((prev) => prev.filter((r) => r.key !== event.key));
        handed.current.delete(event.key);
        if (stoppedHere.current.delete(event.key) && gone?.type === "picture") {
          const sl = gone.data.session ? sessionListeners.current.get(gone.data.session) : undefined;
          (sl ?? listeners.current.get(targetKey(gone.data.target)))?.onStatus({ ok: true, text: "Stopped." });
        }
      } else if (event.type === "machine") {
        setMachine(event.machine);
        setWaiting((prev) => (prev.length === event.waiting.length && prev.every((k, i) => k === event.waiting[i]) ? prev : event.waiting));
        setPausedState(event.paused);
      }
    };
    const open = () => {
      if (!live || (source && source.readyState !== EventSource.CLOSED)) return;
      source = new EventSource("/api/queue/events");
      source.onopen = () => {
        wait = 1000;
      };
      source.onmessage = (m) => {
        try {
          handle(JSON.parse(m.data) as ServerEvent);
        } catch {
          // a message that is not ours
        }
      };
      source.onerror = () => {
        // The browser reconnects by itself unless the server refused; then try again, a little later each time.
        if (source && source.readyState === EventSource.CLOSED && live) {
          retry = setTimeout(open, wait);
          wait = Math.min(wait * 2, 30_000);
        }
      };
    };
    connect.current = open;
    open();
    const again = () => {
      if (document.visibilityState === "visible") {
        open();
        loadUnseenRef.current();
      }
    };
    document.addEventListener("visibilitychange", again);
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", again);
      source?.close();
    };
  }, [applyRows, deliver]);

  // The pause the old versions kept in this browser goes to the server once.
  useEffect(() => {
    try {
      if (localStorage.getItem(OLD_PAUSE_KEY) === "1") void fetch("/api/queue/paused", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: true }) });
      localStorage.removeItem(OLD_PAUSE_KEY);
    } catch {
      // storage unavailable: nothing to move
    }
  }, []);

  // Jobs recorded but not seen yet, from the server's log: finished while their chapter's page wasn't open, in this
  // browser or another, and no longer in the queue's list. Those not in the list already are added as ready.
  const loadUnseen = useCallback(async () => {
    try {
      const res = await fetch("/api/picture-jobs?unseen=1", { cache: "no-store" });
      if (!res.ok) return;
      const { jobs: found } = (await res.json()) as { jobs: PictureJob[] };
      const listed = new Set([...rowsRef.current.flatMap((r) => (r.type === "picture" ? jobIdsOf(r.data.pictures) : [])), ...keptRef.current.flatMap((j) => jobIdsOf(j.pictures))]);
      const added: PictureItem[] = [];
      for (const j of [...found].reverse()) {
        if (listed.has(j.id) || seenHere.has(j.id)) continue;
        listed.add(j.id);
        added.push({
          type: "picture",
          key: `job-${j.id}`,
          ...targetOfIds(j.story_id, j.chapter_id, j.entry_id),
          count: j.images.length,
          prompt: j.prompt,
          negative: j.negative,
          checkpoint: j.checkpoint,
          width: j.width,
          height: j.height,
          denoise: j.denoise,
          source: j.source,
          mask: j.mask,
          refs: j.refs ?? [],
          instruction: j.instruction,
          editModel: j.edit_model,
          moment: j.moment,
          progress: { stage: "loading" },
          state: "done",
          pictures: picturesOf([j]),
          unseen: true,
        });
      }
      if (added.length) updateKept((prev) => [...prev, ...added]);
    } catch {
      // asked again when the app next comes into view
    }
  }, [updateKept]);
  useEffect(() => {
    loadUnseenRef.current = () => void loadUnseen();
  }, [loadUnseen]);

  // ---- pictures ----
  // Pictures only this browser has (a picked file, Refine's flattened picture) and masks go up to the server once each.
  const uploaded = useRef(new Map<string, Promise<string>>());
  const uploadOnce = useCallback((key: string, getBlob: () => Promise<Blob>): Promise<string> => {
    let up = uploaded.current.get(key);
    if (!up) {
      up = (async () => {
        const blob = await getBlob();
        const res = await fetch("/api/queue/uploads", { method: "POST", headers: { "Content-Type": blob.type.startsWith("image/") ? blob.type : "image/png" }, body: blob });
        if (!res.ok) throw await failure(res);
        return ((await res.json()) as { source: string }).source;
      })();
      uploaded.current.set(key, up);
      up.catch(() => uploaded.current.delete(key)); // tried again next time
    }
    return up;
  }, []);

  /** Sends what the server can't fetch itself, and turns the job into data. */
  const specOf = useCallback(
    async (input: JobInput) => {
      const up: Record<string, string> = {};
      const needsUpload = (p: { key: string; source: string }) => p.source.startsWith("upload:") || p.key.startsWith("refine:");
      let job = input;
      if (job.start && needsUpload(job.start)) up[job.start.key] = await uploadOnce(job.start.key, job.start.blob);
      for (const r of refsOf(job)) if (needsUpload(r)) up[r.key] = await uploadOnce(r.key, r.blob);
      const area = maskOf(job);
      if (area) {
        // Drawn here, since the server has no canvas; with nothing painted the whole picture is redrawn.
        const rendered = area.render ? { blob: await area.render() } : await renderMask(area, area.width, area.height);
        if (rendered) up[maskUploadKey(area.id)] = await uploadOnce(`mask:${area.id}`, async () => rendered.blob);
        else job = { ...job, mask: null };
      }
      return toSpec(job, up);
    },
    [uploadOnce],
  );

  /** A job that couldn't be asked for ends like one that failed. */
  const askFailed = useCallback((target: PictureTarget, input: JobInput, text: string) => {
    if (input.session) {
      const sl = sessionListeners.current.get(input.session);
      sl?.onStatus({ ok: false, text });
      sl?.onFailed?.(input.base ?? "", text);
    } else listeners.current.get(targetKey(target))?.onStatus({ ok: false, text });
  }, []);

  // Asks are sent one after another, in the order they were made: the server gathers quick clicks into one job.
  const askChain = useRef<Promise<void>>(Promise.resolve());
  const ask = useCallback(
    ({ input, view, ...asked }: AskRequest) => {
      const target = targetOf(asked);
      askChain.current = askChain.current.then(async () => {
        try {
          const spec = await specOf(input);
          const res = await post("/api/queue/pictures", { target, spec, view });
          if (!res.ok) throw await failure(res);
          const { item } = (await res.json()) as { item: Row };
          applyRows((prev) => (prev.some((r) => r.key === item.key) ? prev.map((r) => (r.key === item.key ? item : r)) : [...prev, item]));
        } catch (e) {
          askFailed(target, input, errorText(e));
        }
      });
    },
    [applyRows, askFailed, specOf],
  );

  const stop = useCallback((key: string) => {
    stoppedHere.current.add(key);
    void post(itemUrl(key), { action: "stop" }).then((res) => {
      if (!res.ok) stoppedHere.current.delete(key);
    });
  }, []);

  const dismiss = useCallback(
    (key: string) => {
      const local = keptRef.current.find((j) => j.key === key);
      if (local) {
        if (local.unseen) markJobsSeen(jobIdsOf(local.pictures));
        return updateKept((prev) => prev.filter((j) => j !== local));
      }
      const row = rowsRef.current.find((r) => r.key === key);
      // A job or Generate or run that is waiting or going can't be dismissed (Stop it first).
      if (!row || row.state === "gathering" || row.state === "waiting" || row.state === "working") return;
      if (row.type === "picture" && row.data.unseen) markJobsSeen(jobIdsOf(row.data.pictures));
      dismissOnServer(key);
    },
    [dismissOnServer, updateKept],
  );

  const listen = useCallback(
    (target: PictureTarget, listener: ChapterListener) => {
      const at = targetKey(target);
      listeners.current.set(at, listener);
      // What ended while the page wasn't open.
      for (const r of rowsRef.current) if (r.type === "picture" && !r.data.session && targetKey(r.data.target) === at) deliver(r, true);
      const waitingHere = keptRef.current.filter((j) => targetKey(j) === at);
      if (waitingHere.length) {
        updateKept((prev) => prev.filter((j) => !waitingHere.includes(j)));
        for (const j of waitingHere) {
          if (j.pictures) listener.onPictures(j.pictures.map((p) => ({ ...p, isNew: true })));
          if (j.message) listener.onStatus({ ok: false, text: j.message });
        }
        markJobsSeen(waitingHere.filter((j) => j.unseen).flatMap((j) => jobIdsOf(j.pictures)));
      }
      return () => {
        if (listeners.current.get(at) === listener) listeners.current.delete(at);
      };
    },
    [deliver, updateKept],
  );

  const listenSession = useCallback(
    (sessionId: string, listener: SessionListener) => {
      sessionListeners.current.set(sessionId, listener);
      // What ended while the screen wasn't listening.
      for (const r of rowsRef.current) if (r.type === "picture" && r.data.session === sessionId) deliver(r);
      return () => {
        if (sessionListeners.current.get(sessionId) === listener) sessionListeners.current.delete(sessionId);
      };
    },
    [deliver],
  );

  const setPaused = useCallback((value: boolean) => {
    setPausedState(value);
    void fetch("/api/queue/paused", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: value }) });
  }, []);

  const move = useCallback((key: string, how: "up" | "down" | "next") => void post(itemUrl(key), { action: "move", how }), []);

  // ---- AI runs ----
  const startRun = useCallback(
    async (runId: string) => {
      const res = await post(`/api/ai-runs/${encodeURIComponent(runId)}/queue`);
      if (!res.ok) throw await failure(res);
      const { item } = (await res.json()) as { item: Row };
      applyRows((prev) => (prev.some((r) => r.key === item.key) ? prev.map((r) => (r.key === item.key ? item : r)) : [...prev, item]));
    },
    [applyRows],
  );
  const stopRun = useCallback((runId: string) => void fetch(`/api/ai-runs/${encodeURIComponent(runId)}/queue`, { method: "DELETE" }), []);

  const listenRun = useCallback((runId: string, listener: RunListener) => {
    const source = new EventSource(`/api/ai-runs/${encodeURIComponent(runId)}/events`);
    source.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as { type: string; event?: RunEvent; run?: AiRun };
        if (e.type === "event" && e.event) listener.onEvent(e.event);
        else if (e.type === "run" && e.run) listener.onRun(e.run);
      } catch {
        // a message that is not ours
      }
    };
    return () => source.close();
  }, []);

  // ---- Generate from the writing page ----
  const generate = useCallback((request: GenerateRequest) => {
    void post("/api/queue/generate", request);
  }, []);
  const stopGenerate = useCallback((draftKey: string) => void fetch(`/api/queue/generate?key=${encodeURIComponent(draftKey)}`, { method: "DELETE" }), []);
  const listenDraft = useCallback((draftKey: string, listener: DraftListener) => {
    const source = new EventSource(`/api/queue/generate/events?key=${encodeURIComponent(draftKey)}`);
    source.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as { type: string; text?: string; base?: { title: string; body: string }; after?: { choiceLabel?: string; suggestions?: string[] }; message?: string };
        if (e.type === "text" && e.text !== undefined && e.base) listener.onText(e.text, e.base);
        else if (e.type === "done") listener.onDone(e.after ?? {});
        else if (e.type === "error") listener.onError(e.message ?? "The Generate failed.");
      } catch {
        // a message that is not ours
      }
    };
    return () => source.close();
  }, []);

  const items = useMemo<WorkItem[]>(() => {
    const fromServer = rows.flatMap<WorkItem>((r) => {
      if (r.type === "picture") {
        // A Refine session's finished jobs belong to its screen alone: never "ready" in the header.
        if (r.data.session && (r.state === "done" || r.state === "failed")) return [];
        return [pictureItem(r)];
      }
      return [r.type === "run" ? runItem(r) : generateItem(r)];
    });
    // Pictures first, then runs, then Generates, each oldest first (as before).
    const of = (type: WorkItem["type"]) => [...fromServer.filter((i) => i.type === type), ...(type === "picture" ? kept : [])];
    return [...of("picture"), ...of("run"), ...of("generate")];
  }, [rows, kept]);

  const api = useMemo(
    () => ({ items, ask, stop, dismiss, listen, listenSession, waiting, paused, setPaused, move, startRun, stopRun, resumeRun: startRun, listenRun, generate, stopGenerate, listenDraft, machine }),
    [items, ask, stop, dismiss, listen, listenSession, waiting, paused, setPaused, move, startRun, stopRun, listenRun, generate, stopGenerate, listenDraft, machine],
  );
  // For the browser tests: the run page that starts runs comes later, so a test page asks for the queue itself.
  useEffect(() => {
    const w = window as unknown as { __STORYTIME_TEST__?: boolean; __storytimeQueue?: unknown };
    if (w.__STORYTIME_TEST__) w.__storytimeQueue = api;
  }, [api]);
  return <QueueContext.Provider value={api}>{children}</QueueContext.Provider>;
}
