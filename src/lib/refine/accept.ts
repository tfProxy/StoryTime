// Accept on the Refine screen: keeps the picture the author sees as a pinned picture on the Illustrate page. Plain
// functions over fetch; the planning on top is pure code.
import { uploadImage, type ComfyImage } from "../comfy/client";
import { chapterIdOf, type PictureTarget } from "../pictureTarget";
import type { RefineState } from "../refineHistory";
import { uploadedImage } from "./apply";
import { sentPictureKey } from "./send";
import { baseOf, imageOfResultBase, ORIGINAL_BASE, type AcceptRecord, type RefineSession } from "./session";

/**
 * What Accept does, from what the author sees: `leave` (the working picture is the original and no paint shows: nothing
 * to keep), `result` (an applied result with no visible paint: that ComfyUI picture is kept), or `paint` (visible paint:
 * the flattened picture is uploaded and recorded as a new picture). Hidden paint and the mask count for nothing.
 */
export type AcceptPlan = { kind: "leave" } | { kind: "result" } | { kind: "paint" };

export function planAccept(state: Pick<RefineState, "base" | "paint" | "paintVisible">): AcceptPlan {
  if (state.paintVisible && state.paint.length > 0) return { kind: "paint" };
  return state.base === ORIGINAL_BASE ? { kind: "leave" } : { kind: "result" };
}

export const sameImage = (a: ComfyImage, b: ComfyImage) => a.filename === b.filename && a.subfolder === b.subfolder && a.type === b.type;

type JobPage = { jobs: { id: string; moment: string | null; images: ComfyImage[] }[]; next: number | null };

/** The job log's list for a target; temporary jobs included. */
function listUrl(target: PictureTarget): string {
  const q = target.kind === "chapter" ? `chapter=${encodeURIComponent(target.chapterId)}` : target.kind === "cover" ? `cover=${encodeURIComponent(target.storyId)}` : `story=${encodeURIComponent(target.storyId)}&entry=${encodeURIComponent(target.entryId)}`;
  return `/api/picture-jobs?${q}&temporary=1&limit=200`;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const MAX_PAGES = 10;

/** The job in the target's log that made `image`, with the picture's place in it, or null (not recorded, e.g. an upload). */
export async function findJobPicture(target: PictureTarget, image: ComfyImage): Promise<{ jobId: string; index: number; moment: string | null } | null> {
  let before: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${listUrl(target)}${before === null ? "" : `&before=${before}`}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Couldn't read StoryTime's picture log (${res.status}).`);
    const data = (await res.json()) as JobPage;
    for (const job of data.jobs) {
      const index = job.images.findIndex((i) => sameImage(i, image));
      if (index >= 0) return { jobId: job.id, index, moment: job.moment };
    }
    if (data.next === null) return null;
    before = data.next;
  }
  return null;
}

/** Pins or rejects one picture of a logged job. */
export async function markPicture(jobId: string, index: number, mark: "pinned" | "rejected"): Promise<void> {
  const res = await fetch(`/api/picture-jobs/${encodeURIComponent(jobId)}/mark`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index, mark }) });
  if (!res.ok) throw new Error(String((await json(res)).error ?? `StoryTime wouldn't keep the picture (${res.status}).`));
}

/** The chapter's moment: the one of the job that made the picture when known, else the one saved with the chapter's boxes, else "start". */
async function chapterMoment(target: PictureTarget, known: string | null): Promise<"start" | "middle" | "end" | "cover" | "codex"> {
  if (target.kind === "cover") return "cover";
  if (target.kind === "codex") return "codex";
  if (known === "start" || known === "middle" || known === "end") return known;
  try {
    const res = await fetch(`/api/chapters/${encodeURIComponent(chapterIdOf(target)!)}/picture-draft`, { cache: "no-store" });
    const d = res.ok ? (((await res.json()) as { draft?: { moment?: unknown } | null }).draft ?? null) : null;
    return d?.moment === "end" || d?.moment === "middle" ? d.moment : "start";
  } catch {
    return "start";
  }
}

/** Records a finished, kept (not temporary) job of one picture in the log; returns its id. A job recorded twice under one `promptId` is the same record. */
async function recordKept(args: {
  target: PictureTarget;
  promptId: string;
  prompt: string;
  negative: string;
  checkpoint: string;
  width: number;
  height: number;
  moment: string;
  source: string | null;
  image: ComfyImage;
}): Promise<string> {
  const { target } = args;
  const by = target.kind === "chapter" ? { chapter_id: target.chapterId } : target.kind === "cover" ? { story_id: target.storyId } : { story_id: target.storyId, entry_id: target.entryId };
  const res = await fetch("/api/picture-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...by,
      prompt_id: args.promptId,
      prompt: args.prompt,
      negative: args.negative,
      checkpoint: args.checkpoint,
      width: args.width,
      height: args.height,
      seed: 0,
      count: 1,
      moment: args.moment,
      source: args.source,
      images: [args.image],
      unseen: false,
      temporary: false,
    }),
  });
  const data = await json(res);
  if (!res.ok || typeof data.id !== "string") throw new Error(String(data.error ?? `StoryTime couldn't record the picture (${res.status}).`));
  return data.id;
}

export type AcceptArgs = {
  session: RefineSession;
  present: RefineState;
  comfyUrl: string;
  /** The working picture's size. */
  size: { w: number; h: number } | null;
  /** The working picture's `source` string (`comfy:…`, `saved:…`, `codex:…`). */
  source: string | null;
  /** The working picture with the visible paint on it, as a PNG. */
  flatten: () => Promise<Blob>;
  /** Called whenever the progress changes, so the session can keep it (a retry then doesn't repeat finished steps). */
  remember: (record: AcceptRecord) => void;
};

const randomPart = () => Math.random().toString(36).slice(2, 8);

/**
 * Keeps the picture the author sees, in an order that leaves nothing half done that matters: the picture is uploaded (when
 * painted), recorded and pinned, and only then is the original trashed (when it is a job's picture; a saved header, footer,
 * cover or codex picture is never touched). Throws with a message to show; calling it again continues where it stopped.
 */
export async function acceptPicture(a: AcceptArgs): Promise<void> {
  const { session, present } = a;
  const target = session.target;
  const plan = planAccept(present);
  if (plan.kind === "leave") return;
  const base = baseOf(session, present.base);
  const sig = sentPictureKey(session.id, present);
  let rec: AcceptRecord = session.accepting?.sig === sig ? session.accepting : { sig, promptId: `refine-${session.id}-${Date.now().toString(36)}-${randomPart()}` };
  const keep = (next: AcceptRecord) => {
    rec = next;
    a.remember(next);
  };

  // The original's job is looked up first, while nothing has changed.
  const originalImage = session.original.kind === "comfy" ? session.original.image : null;
  const originalJob = originalImage ? await findJobPicture(target, originalImage) : null;

  // The text the new record carries: the working picture's own, else the session's.
  const prompt = (base.prompt ?? session.sourcePrompt ?? session.prompt ?? session.boxPrompt ?? "").trim() || "Refined picture";
  const negative = base.negative ?? session.sourceNegative ?? session.negative ?? session.boxNegative ?? "";

  let kept: { jobId: string; index: number };
  if (plan.kind === "result") {
    const shown = base.original.kind === "comfy" ? base.original.image : null;
    // The result's own picture (a resampled copy in the input folder is not in the log; the result it was made from is).
    const image = imageOfResultBase(present.base) ?? shown;
    if (!image) throw new Error("StoryTime can't tell which picture this is.");
    const found = await findJobPicture(target, image);
    if (found) kept = found;
    else {
      // Not in the log (its record was refused): record it now as a picture of its own.
      const id = rec.jobId ?? (await recordKept({ target, promptId: rec.promptId, prompt, negative, checkpoint: "Refine", width: a.size?.w ?? 1, height: a.size?.h ?? 1, moment: await chapterMoment(target, null), source: null, image }));
      if (!rec.jobId) keep({ ...rec, image, jobId: id });
      kept = { jobId: id, index: 0 };
    }
  } else {
    if (!a.size) throw new Error("The picture isn't loaded yet.");
    let image = rec.image;
    if (!image) {
      const png = await a.flatten();
      const name = await uploadImage(a.comfyUrl, png, `storytime-refine-accepted-${Date.now().toString(36)}-${randomPart()}.png`);
      image = uploadedImage(name);
      keep({ ...rec, image });
    }
    let jobId = rec.jobId;
    if (!jobId) {
      const baseJob = base.original.kind === "comfy" ? await findJobPicture(target, base.original.image) : null;
      jobId = await recordKept({
        target,
        promptId: rec.promptId,
        prompt,
        negative,
        checkpoint: "Refine (painted)",
        width: a.size.w,
        height: a.size.h,
        moment: await chapterMoment(target, baseJob?.moment ?? originalJob?.moment ?? null),
        source: a.source,
        image,
      });
      keep({ ...rec, jobId });
    }
    kept = { jobId, index: 0 };
  }

  await markPicture(kept.jobId, kept.index, "pinned");
  if (originalJob && !(originalJob.jobId === kept.jobId && originalJob.index === kept.index)) await markPicture(originalJob.jobId, originalJob.index, "rejected");
}
