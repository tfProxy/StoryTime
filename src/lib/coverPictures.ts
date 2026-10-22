import { z } from "zod";
import { db } from "./db";
import { LIMITS } from "./limits";
import { jobPrompts, setPictureMark } from "./pictureJobs";
import type { ImageMade } from "./imageSlots";
import { COVER_SOURCES } from "./pictureTarget";
import { PostError, setCover } from "./stories";

// The story's cover made like a chapter's pictures (see migration 20): the job and prompts a saved cover
// came from, the cover page's prompt boxes, and the cover's own drawing preset.

function requireStory(storyId: string) {
  if (!db().prepare(`SELECT 1 FROM stories WHERE id = ?`).get(storyId)) throw new PostError("That story does not exist", 404);
}

/**
 * Sets the story's cover. `jobId` names the picture job that made it: its prompts are kept with the
 * cover, and the picture `index` (when given) is remembered and pinned. An upload has neither.
 */
export function saveCover(storyId: string, bytes: Buffer, jobId?: string | null, index?: number | null): { cover_version: number } {
  return db().transaction(() => {
    const done = setCover(storyId, bytes);
    const made = jobId ? jobPrompts(jobId) : undefined;
    const at = made && index !== undefined && index !== null && Number.isInteger(index) && index >= 0 && index < made.count ? index : null;
    db()
      .prepare(`UPDATE stories SET cover_job_id = ?, cover_image_index = ?, cover_prompt = ?, cover_negative = ? WHERE id = ?`)
      .run(made ? jobId : null, at, made?.prompt ?? null, made?.negative ?? null, storyId);
    // A picture chosen as the cover is worth keeping, so it is pinned (also when it was trashed before).
    if (jobId && at !== null) setPictureMark(jobId, at, "pinned");
    return done;
  })();
}

/** What the saved cover was made from, or null when there is none or it was uploaded. */
export function coverMade(storyId: string): ImageMade | null {
  const r = db()
    .prepare(
      // A cover saved without its index is still known when its job made only one picture.
      `SELECT s.cover_prompt AS prompt, s.cover_negative AS negative, j.id AS job_id, j.seed, j.checkpoint, j.width, j.height,
         COALESCE(s.cover_image_index, CASE WHEN json_array_length(j.images) = 1 THEN 0 END) AS image_index
       FROM stories s LEFT JOIN picture_jobs j ON j.id = s.cover_job_id
       WHERE s.id = ? AND s.cover IS NOT NULL AND s.cover_prompt IS NOT NULL`,
    )
    .get(storyId) as
    | { prompt: string; negative: string | null; job_id: string | null; seed: number | null; checkpoint: string | null; width: number | null; height: number | null; image_index: number | null }
    | undefined;
  if (!r) return null;
  return {
    prompt: r.prompt,
    negative: r.negative ?? "",
    job: r.seed === null ? null : { seed: r.seed, checkpoint: r.checkpoint ?? "", width: r.width ?? 0, height: r.height ?? 0 },
    from: r.job_id !== null && r.image_index !== null ? { jobId: r.job_id, index: r.image_index } : null,
  };
}

/** The cover page's prompt boxes as saved, and what the prompt is written from. */
export const CoverDraftSchema = z.object({
  prompt: z.string().max(LIMITS.picturePrompt).default(""),
  negative: z.string().max(LIMITS.picturePrompt).default(""),
  /** The scene the prompt writer described, shown above the prompt. */
  scene: z.string().max(LIMITS.picturePrompt).default(""),
  /** "What to show". */
  direction: z.string().max(LIMITS.label).default(""),
  source: z.enum(COVER_SOURCES).default("premise"),
  /** For a path: the chapter it ends at. */
  path_chapter_id: z.string().min(1).max(100).nullable().default(null),
});
export type CoverDraft = z.infer<typeof CoverDraftSchema>;

/** The story's saved cover prompt boxes, or null when nothing was saved. */
export function getCoverDraft(storyId: string): CoverDraft | null {
  const row = db()
    .prepare(`SELECT prompt, negative, scene, direction, source, path_chapter_id FROM cover_prompts WHERE story_id = ?`)
    .get(storyId) as CoverDraft | undefined;
  return row ?? null;
}

/** Replaces the cover's saved prompt boxes (the preset stays). */
export function saveCoverDraft(storyId: string, d: CoverDraft): { ok: true } {
  requireStory(storyId);
  db()
    .prepare(
      `INSERT INTO cover_prompts (story_id, prompt, negative, scene, direction, source, path_chapter_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (story_id) DO UPDATE SET prompt = excluded.prompt, negative = excluded.negative, scene = excluded.scene,
         direction = excluded.direction, source = excluded.source, path_chapter_id = excluded.path_chapter_id, updated_at = excluded.updated_at`,
    )
    .run(storyId, d.prompt, d.negative, d.scene, d.direction, d.source, d.path_chapter_id, Date.now());
  return { ok: true };
}

export const CoverPresetSchema = z.object({ draw_preset: z.string().trim().min(1).max(100).nullable() });

/** The drawing preset the cover uses (an id from Settings), or null to use the story's. */
export function getCoverPreset(storyId: string): string | null {
  const row = db().prepare(`SELECT draw_preset FROM cover_prompts WHERE story_id = ?`).get(storyId) as { draw_preset: string | null } | undefined;
  return row?.draw_preset ?? null;
}

export function setCoverPreset(storyId: string, input: z.infer<typeof CoverPresetSchema>): { draw_preset: string | null } {
  requireStory(storyId);
  db()
    .prepare(
      `INSERT INTO cover_prompts (story_id, draw_preset, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (story_id) DO UPDATE SET draw_preset = excluded.draw_preset`,
    )
    .run(storyId, input.draw_preset, Date.now());
  return { draw_preset: input.draw_preset };
}
