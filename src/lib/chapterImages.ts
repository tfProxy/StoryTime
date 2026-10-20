import { db } from "./db";
import { jobPrompts } from "./pictureJobs";
import { checkImage, PostError } from "./stories";
import type { ImageMade, ImageSlot, ImageVersions } from "./imageSlots";

// A chapter's illustrations: at most one picture per slot (see ./imageSlots).

function requireChapter(chapterId: string) {
  if (!db().prepare(`SELECT 1 FROM chapters WHERE id = ?`).get(chapterId)) throw new PostError("That chapter does not exist", 404);
}

/**
 * Sets a slot's picture. `jobId` names the picture job (see ./pictureJobs) that made it: its prompt and
 * negative prompt are kept with the picture, which is left without them when the job is unknown. `index`
 * is which of the job's pictures it is, when given.
 */
export function setChapterImage(chapterId: string, slot: ImageSlot, bytes: Buffer, jobId?: string | null, index?: number | null): { version: number } {
  const type = checkImage(bytes, "picture");
  requireChapter(chapterId);
  const made = jobId ? jobPrompts(jobId) : undefined;
  const at = made && index !== undefined && index !== null && Number.isInteger(index) && index >= 0 && index < made.count ? index : null;
  const prev = db()
    .prepare(`SELECT updated_at AS v FROM chapter_images WHERE chapter_id = ? AND slot = ?`)
    .get(chapterId, slot) as { v: number } | undefined;
  // Two uploads in the same millisecond must still get different versions.
  const version = Math.max(Date.now(), (prev?.v ?? 0) + 1);
  db()
    .prepare(
      `INSERT INTO chapter_images (chapter_id, slot, image, type, updated_at, job_id, prompt, negative, image_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (chapter_id, slot) DO UPDATE SET image = excluded.image, type = excluded.type, updated_at = excluded.updated_at,
         job_id = excluded.job_id, prompt = excluded.prompt, negative = excluded.negative, image_index = excluded.image_index`,
    )
    .run(chapterId, slot, bytes, type, version, made ? jobId : null, made?.prompt ?? null, made?.negative ?? null, at);
  return { version };
}

export function clearChapterImage(chapterId: string, slot: ImageSlot): { ok: true } {
  requireChapter(chapterId);
  db().prepare(`DELETE FROM chapter_images WHERE chapter_id = ? AND slot = ?`).run(chapterId, slot);
  return { ok: true };
}

export function getChapterImage(chapterId: string, slot: ImageSlot): { type: string; bytes: Buffer; version: number } | undefined {
  const row = db()
    .prepare(`SELECT image, type, updated_at FROM chapter_images WHERE chapter_id = ? AND slot = ?`)
    .get(chapterId, slot) as { image: Buffer; type: string; updated_at: number } | undefined;
  return row && { type: row.type, bytes: row.image, version: row.updated_at };
}

/** What each saved picture of a chapter was made from; a slot is null when empty or when the picture was uploaded. */
export function chapterImageMade(chapterId: string): Record<ImageSlot, ImageMade | null> {
  const out: Record<ImageSlot, ImageMade | null> = { header: null, footer: null };
  const rows = db()
    .prepare(
      // A picture saved before its index was kept is still known when its job made only one.
      `SELECT i.slot, i.prompt, i.negative, j.id AS job_id, j.seed, j.checkpoint, j.width, j.height,
         COALESCE(i.image_index, CASE WHEN json_array_length(j.images) = 1 THEN 0 END) AS image_index
       FROM chapter_images i LEFT JOIN picture_jobs j ON j.id = i.job_id
       WHERE i.chapter_id = ? AND i.prompt IS NOT NULL`,
    )
    .all(chapterId) as {
    slot: ImageSlot;
    prompt: string;
    negative: string | null;
    job_id: string | null;
    seed: number | null;
    checkpoint: string | null;
    width: number | null;
    height: number | null;
    image_index: number | null;
  }[];
  for (const r of rows) {
    const job = r.seed === null ? null : { seed: r.seed, checkpoint: r.checkpoint ?? "", width: r.width ?? 0, height: r.height ?? 0 };
    const from = r.job_id !== null && r.image_index !== null ? { jobId: r.job_id, index: r.image_index } : null;
    out[r.slot] = { prompt: r.prompt, negative: r.negative ?? "", job, from };
  }
  return out;
}

/** The image versions of each of the given chapters (chapters without images get nulls). */
export function chapterImageVersions(chapterIds: string[]): Map<string, ImageVersions> {
  const out = new Map<string, ImageVersions>(chapterIds.map((id) => [id, { header: null, footer: null }]));
  if (chapterIds.length === 0) return out;
  const rows = db()
    .prepare(`SELECT chapter_id, slot, updated_at FROM chapter_images WHERE chapter_id IN (${chapterIds.map(() => "?").join(",")})`)
    .all(...chapterIds) as { chapter_id: string; slot: ImageSlot; updated_at: number }[];
  for (const r of rows) out.get(r.chapter_id)![r.slot] = r.updated_at;
  return out;
}
