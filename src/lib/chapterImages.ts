import { db } from "./db";
import { checkImage, PostError } from "./stories";
import type { ImageSlot, ImageVersions } from "./imageSlots";

// A chapter's illustrations: at most one picture per slot (see ./imageSlots).

function requireChapter(chapterId: string) {
  if (!db().prepare(`SELECT 1 FROM chapters WHERE id = ?`).get(chapterId)) throw new PostError("That chapter does not exist", 404);
}

export function setChapterImage(chapterId: string, slot: ImageSlot, bytes: Buffer): { version: number } {
  const type = checkImage(bytes, "picture");
  requireChapter(chapterId);
  const prev = db()
    .prepare(`SELECT updated_at AS v FROM chapter_images WHERE chapter_id = ? AND slot = ?`)
    .get(chapterId, slot) as { v: number } | undefined;
  // Two uploads in the same millisecond must still get different versions.
  const version = Math.max(Date.now(), (prev?.v ?? 0) + 1);
  db()
    .prepare(
      `INSERT INTO chapter_images (chapter_id, slot, image, type, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (chapter_id, slot) DO UPDATE SET image = excluded.image, type = excluded.type, updated_at = excluded.updated_at`,
    )
    .run(chapterId, slot, bytes, type, version);
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
