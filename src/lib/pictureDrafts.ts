import { z } from "zod";
import { db } from "./db";
import { LIMITS } from "./limits";
import { StoredRefSchema } from "./pictureJobs";
import { PostError } from "./stories";

// What was in the Illustrate page's prompt boxes for a chapter (see migration 14), one set per moment
// (chapter start, chapter end), so the page opens with them again, on any device.

/** One moment's prompt boxes, as saved: the moment saved last is the one the page opens on. */
export const PictureDraftSchema = z.object({
  prompt: z.string().max(LIMITS.picturePrompt).default(""),
  negative: z.string().max(LIMITS.picturePrompt).default(""),
  /** The scene the prompt writer described, shown above the prompt. */
  scene: z.string().max(LIMITS.picturePrompt).default(""),
  /** "What to show". */
  direction: z.string().max(LIMITS.label).default(""),
  /** The reference pictures chosen for this moment (at most 4; uploads are never kept). */
  refs: z.array(StoredRefSchema).max(4).default([]),
  moment: z.enum(["start", "end"]).default("start"),
});
export type PictureDraftInput = z.infer<typeof PictureDraftSchema>;

export type PictureMoment = PictureDraftInput["moment"];
export type PictureBoxes = Omit<PictureDraftInput, "moment">;

/** A chapter's saved prompt boxes: the moment last worked on, and each moment's boxes. */
export type PictureDraft = { moment: PictureMoment } & Record<PictureMoment, PictureBoxes>;

const EMPTY_BOXES: PictureBoxes = { prompt: "", negative: "", scene: "", direction: "", refs: [] };

/** The chapter's saved prompt boxes, or null when nothing was saved for it. */
export function getPictureDraft(chapterId: string): PictureDraft | null {
  const rows = db()
    .prepare(`SELECT moment, prompt, negative, scene, direction, refs FROM picture_prompts WHERE chapter_id = ? ORDER BY updated_at DESC`)
    .all(chapterId) as (Omit<PictureBoxes, "refs"> & { moment: PictureMoment; refs: string | null })[];
  if (rows.length === 0) return null;
  const draft: PictureDraft = { moment: rows[0].moment, start: { ...EMPTY_BOXES }, end: { ...EMPTY_BOXES } };
  for (const { moment, refs, ...boxes } of rows) draft[moment] = { ...boxes, refs: refs ? (JSON.parse(refs) as PictureBoxes["refs"]) : [] };
  return draft;
}

/** Replaces one moment's saved prompt boxes, and makes it the moment the page opens on. */
export function savePictureDraft(chapterId: string, draft: PictureDraftInput): { ok: true } {
  if (!db().prepare(`SELECT 1 FROM chapters WHERE id = ?`).get(chapterId)) throw new PostError("That chapter does not exist", 404);
  // Later than the other moment's, even within the same millisecond.
  const last = db().prepare(`SELECT MAX(updated_at) AS v FROM picture_prompts WHERE chapter_id = ?`).get(chapterId) as { v: number | null };
  const at = Math.max(Date.now(), (last.v ?? 0) + 1);
  db()
    .prepare(
      `INSERT INTO picture_prompts (chapter_id, moment, prompt, negative, scene, direction, refs, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (chapter_id, moment) DO UPDATE SET prompt = excluded.prompt, negative = excluded.negative, scene = excluded.scene,
         direction = excluded.direction, refs = excluded.refs, updated_at = excluded.updated_at`,
    )
    .run(chapterId, draft.moment, draft.prompt, draft.negative, draft.scene, draft.direction, draft.refs.length ? JSON.stringify(draft.refs) : null, at);
  return { ok: true };
}
