// What StoryTime tells ComfyUI about a job when it queues it (in the job's `extra_data`, which ComfyUI
// keeps in its queue and its history). A page that was refreshed while a job was being made reads it back
// to find the job again, show it, and record it. Browser code.
import type { PictureMoment } from "../pictureTarget";

/** How a job was made: what the picture-job log records besides the chapter, ComfyUI's job id and the pictures. */
export type JobRecord = {
  prompt: string;
  negative: string;
  checkpoint: string;
  width: number;
  height: number;
  seed: number;
  count: number;
  moment: PictureMoment;
  source?: string;
  denoise?: number | null;
  instruction?: string;
  edit_model?: string;
};

export type JobTag = {
  /** Null for the story's cover. */
  chapterId: string | null;
  storyId: string;
  /** The WebSocket client id the job was queued with, which ComfyUI sends its progress to. */
  clientId: string;
  job: JobRecord;
  /** The StoryTime that queued it (`GET /api/instance`); jobs from before this have none. */
  instance?: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The tag in a job's `extra_data`, or null when it has none (a job from before jobs were tagged this fully, or not StoryTime's). */
export function readTag(extra: unknown): JobTag | null {
  const t = isObject(extra) ? extra.storytime : null;
  if (!isObject(t) || (!isString(t.chapterId) && t.chapterId !== null) || !isString(t.storyId) || !isString(t.clientId) || !isObject(t.job)) return null;
  const j = t.job;
  if (!isString(j.prompt) || !isString(j.negative) || !isString(j.checkpoint)) return null;
  if (!isNumber(j.width) || !isNumber(j.height) || !isNumber(j.seed) || !isNumber(j.count)) return null;
  // A cover job has no chapter, and a chapter's job is for its start or end.
  if (t.chapterId === null ? j.moment !== "cover" : j.moment !== "start" && j.moment !== "end") return null;
  if ((j.source !== undefined && !isString(j.source)) || (j.instruction !== undefined && !isString(j.instruction)) || (j.edit_model !== undefined && !isString(j.edit_model))) return null;
  if (j.denoise !== undefined && j.denoise !== null && !isNumber(j.denoise)) return null;
  return { chapterId: t.chapterId, storyId: t.storyId, clientId: t.clientId, job: j as JobRecord, ...(isString(t.instance) && { instance: t.instance }) };
}
