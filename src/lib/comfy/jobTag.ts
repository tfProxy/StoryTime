// What StoryTime tells ComfyUI about a job when it queues it (in the job's `extra_data`, which ComfyUI
// keeps in its queue and its history). A page that was refreshed while a job was being made reads it back
// to find the job again, show it, and record it. Browser code.
import { targetOfIds, type PictureMoment, type PictureTarget } from "../pictureTarget";
import { REFERENCE_ROLES, type StoredReference } from "./references";

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
  /** The mask picture's name in ComfyUI's input folder, when only a painted part was redrawn. */
  mask?: string | null;
  instruction?: string;
  edit_model?: string;
  /** The reference pictures it was made with (at most 4); left out when there were none. */
  refs?: StoredReference[];
  /** Made by the Refine screen: the log keeps it out of the Illustrate page unless asked for or pinned; left out for an ordinary job. */
  temporary?: true;
};

export type JobTag = {
  /** Null for the story's cover. */
  chapterId: string | null;
  /** The codex entry of a codex job (whose `chapterId` is null and moment `codex`); tags from before codex pictures have none. */
  entryId?: string;
  storyId: string;
  /** The WebSocket client id the job was queued with, which ComfyUI sends its progress to. */
  clientId: string;
  job: JobRecord;
  /** The StoryTime that queued it (`GET /api/instance`); jobs from before this have none. */
  instance?: string;
  /** Made for a Refine screen's session (its id) and from this base picture of it: the queue hands the pictures to that screen only. */
  session?: string;
  base?: string;
};

/** What the tag's job was made for. */
export const tagTarget = (tag: JobTag): PictureTarget => targetOfIds(tag.storyId, tag.chapterId, tag.entryId);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isStoredReference = (v: unknown): v is StoredReference =>
  isObject(v) && isString(v.source) && isString(v.label) && isNumber(v.weight) && (REFERENCE_ROLES as readonly unknown[]).includes(v.role);

/** The tag in a job's `extra_data`, or null when it has none (a job from before jobs were tagged this fully, or not StoryTime's). */
export function readTag(extra: unknown): JobTag | null {
  const t = isObject(extra) ? extra.storytime : null;
  if (!isObject(t) || (!isString(t.chapterId) && t.chapterId !== null) || !isString(t.storyId) || !isString(t.clientId) || !isObject(t.job)) return null;
  const j = t.job;
  if (!isString(j.prompt) || !isString(j.negative) || !isString(j.checkpoint)) return null;
  if (!isNumber(j.width) || !isNumber(j.height) || !isNumber(j.seed) || !isNumber(j.count)) return null;
  // A cover job has no chapter (nor an entry), a codex job has an entry instead, and a chapter's job is for its start, middle or end.
  if (t.entryId !== undefined && !isString(t.entryId)) return null;
  if (t.chapterId === null ? (t.entryId === undefined ? j.moment !== "cover" : j.moment !== "codex") : t.entryId !== undefined || (j.moment !== "start" && j.moment !== "middle" && j.moment !== "end")) return null;
  if ((j.source !== undefined && !isString(j.source)) || (j.instruction !== undefined && !isString(j.instruction)) || (j.edit_model !== undefined && !isString(j.edit_model))) return null;
  if (j.denoise !== undefined && j.denoise !== null && !isNumber(j.denoise)) return null;
  if (j.mask !== undefined && j.mask !== null && (!isString(j.mask) || j.mask.length === 0 || j.mask.length > 300)) return null;
  if (j.temporary !== undefined && j.temporary !== true) return null;
  if (j.refs !== undefined && !(Array.isArray(j.refs) && j.refs.length <= 4 && j.refs.every(isStoredReference))) return null;
  if ((t.session !== undefined && !isString(t.session)) || (t.base !== undefined && !isString(t.base))) return null;
  return {
    chapterId: t.chapterId,
    ...(isString(t.entryId) && { entryId: t.entryId }),
    storyId: t.storyId,
    clientId: t.clientId,
    job: j as JobRecord,
    ...(isString(t.instance) && { instance: t.instance }),
    ...(isString(t.session) && { session: t.session }),
    ...(isString(t.base) && { base: t.base }),
  };
}
