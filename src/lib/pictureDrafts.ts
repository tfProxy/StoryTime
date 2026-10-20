import { z } from "zod";
import { db } from "./db";
import { LIMITS } from "./limits";
import { PostError } from "./stories";

// What was in the Illustrate page's prompt boxes for a chapter (see migration 12), so the page opens
// with them again, on any device.

export const PictureDraftSchema = z.object({
  prompt: z.string().max(LIMITS.picturePrompt).default(""),
  negative: z.string().max(LIMITS.picturePrompt).default(""),
  /** The scene the prompt writer described, shown above the prompt. */
  scene: z.string().max(LIMITS.picturePrompt).default(""),
  /** "What to show". */
  direction: z.string().max(LIMITS.label).default(""),
  moment: z.enum(["start", "end"]).default("start"),
});
export type PictureDraft = z.infer<typeof PictureDraftSchema>;

/** The chapter's saved prompt boxes, or null when nothing was saved for it. */
export function getPictureDraft(chapterId: string): PictureDraft | null {
  const row = db()
    .prepare(`SELECT prompt, negative, scene, direction, moment FROM picture_drafts WHERE chapter_id = ?`)
    .get(chapterId) as PictureDraft | undefined;
  return row ?? null;
}

/** Replaces the chapter's saved prompt boxes. */
export function savePictureDraft(chapterId: string, draft: PictureDraft): { ok: true } {
  if (!db().prepare(`SELECT 1 FROM chapters WHERE id = ?`).get(chapterId)) throw new PostError("That chapter does not exist", 404);
  db()
    .prepare(
      `INSERT INTO picture_drafts (chapter_id, prompt, negative, scene, direction, moment, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (chapter_id) DO UPDATE SET prompt = excluded.prompt, negative = excluded.negative, scene = excluded.scene,
         direction = excluded.direction, moment = excluded.moment, updated_at = excluded.updated_at`,
    )
    .run(chapterId, draft.prompt, draft.negative, draft.scene, draft.direction, draft.moment, Date.now());
  return { ok: true };
}
