import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";
import { jobPrompts, setPictureMark, StoredRefSchema } from "./pictureJobs";
import type { ImageMade } from "./imageSlots";
import { checkImage, getPath, PostError } from "./stories";
import { getCodexState } from "./codexDb";
import type { EntryType } from "./codex";
import type { CodexChoice } from "./comfy/referenceChoices";

// Pictures of codex entries (see migration 25). Like codex text, a picture is anchored at a chapter (or at
// the whole story) and applies to it and its descendants: the picture of an entry at a chapter is the one
// anchored nearest to the chapter on the root->chapter path, a later one winning over an earlier one at the
// same chapter. A removed picture is only hidden, so the one before it shows again.

/** A codex entry's picture, without its bytes (those are at `GET /api/stories/:id/codex-pictures/:pictureId`). */
export type CodexPicture = {
  id: string;
  entry_id: string;
  /** The chapter it starts at (and its descendants), or null for the whole story. */
  anchor_chapter_id: string | null;
  posted_at: number;
  /** What it was made from, when it was saved from a picture job. */
  made: ImageMade | null;
};

type Row = {
  id: string;
  entry_id: string;
  anchor_chapter_id: string | null;
  depth: number;
  posted_at: number;
  prompt: string;
  negative: string;
  job_id: string | null;
  seed: number | null;
  checkpoint: string | null;
  width: number | null;
  height: number | null;
  image_index: number | null;
};

const COLUMNS = `p.id, p.entry_id, p.anchor_chapter_id, COALESCE(c.depth, -1) AS depth, p.posted_at, p.prompt, p.negative, p.job_id,
  j.seed, j.checkpoint, j.width, j.height,
  COALESCE(p.image_index, CASE WHEN json_array_length(j.images) = 1 THEN 0 END) AS image_index`;
const FROM = `codex_pictures p LEFT JOIN chapters c ON c.id = p.anchor_chapter_id LEFT JOIN picture_jobs j ON j.id = p.job_id`;

function toPicture(r: Row): CodexPicture {
  return {
    id: r.id,
    entry_id: r.entry_id,
    anchor_chapter_id: r.anchor_chapter_id,
    posted_at: r.posted_at,
    made:
      r.job_id === null && !r.prompt
        ? null
        : {
            prompt: r.prompt,
            negative: r.negative,
            job: r.seed === null ? null : { seed: r.seed, checkpoint: r.checkpoint ?? "", width: r.width ?? 0, height: r.height ?? 0 },
            from: r.job_id !== null && r.image_index !== null ? { jobId: r.job_id, index: r.image_index } : null,
          },
  };
}

function requireEntry(storyId: string, entryId: string) {
  if (!db().prepare(`SELECT 1 FROM codex_ops WHERE story_id = ? AND entry_id = ?`).get(storyId, entryId)) {
    throw new PostError("That codex entry does not exist", 404);
  }
}

/** The ids of the chapters from the story's first one to this one; throws when the chapter isn't in the story. */
function pathIds(storyId: string, chapterId: string): string[] {
  const path = getPath(chapterId);
  if (path.length === 0 || path[0].story_id !== storyId) throw new PostError("That chapter does not exist in this story", 404);
  return path.map((c) => c.id);
}

/**
 * Saves a picture for an entry, from the chapter `anchor` on (and its descendants), or null for the whole
 * story. `jobId` names the picture job that made it: its prompts are kept with the picture, and the picture
 * `index` (when given) is remembered and pinned.
 */
export function saveCodexPicture(storyId: string, entryId: string, anchor: string | null, bytes: Buffer, jobId?: string | null, index?: number | null): { id: string } {
  const type = checkImage(bytes, "picture");
  if (!db().prepare(`SELECT 1 FROM stories WHERE id = ?`).get(storyId)) throw new PostError("That story does not exist", 404);
  requireEntry(storyId, entryId);
  if (anchor !== null) pathIds(storyId, anchor);
  const made = jobId ? jobPrompts(jobId) : undefined;
  const at = made && index !== undefined && index !== null && Number.isInteger(index) && index >= 0 && index < made.count ? index : null;
  const id = newId();
  // Two saves in the same millisecond must still order: the later one wins.
  const last = db().prepare(`SELECT MAX(posted_at) AS t FROM codex_pictures WHERE story_id = ? AND entry_id = ?`).get(storyId, entryId) as { t: number | null };
  const postedAt = Math.max(Date.now(), (last.t ?? 0) + 1);
  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO codex_pictures (id, story_id, entry_id, anchor_chapter_id, job_id, image_index, image, type, prompt, negative, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, storyId, entryId, anchor, made ? jobId : null, at, bytes, type, made?.prompt ?? "", made?.negative ?? "", postedAt);
    // A picture chosen for the codex is worth keeping, so it is pinned (also when it was trashed before).
    if (jobId && at !== null) setPictureMark(jobId, at, "pinned");
  })();
  return { id };
}

/** Hides a picture, so the one before it (if any) shows again. */
export function removeCodexPicture(storyId: string, pictureId: string): { ok: true } {
  const done = db().prepare(`UPDATE codex_pictures SET removed_at = ? WHERE id = ? AND story_id = ? AND removed_at IS NULL`).run(Date.now(), pictureId, storyId);
  if (done.changes === 0) throw new PostError("That picture does not exist", 404);
  return { ok: true };
}

/** The picture's bytes, or undefined when there is none (or it was removed). */
export function getCodexPictureImage(storyId: string, pictureId: string): { type: string; bytes: Buffer; version: number } | undefined {
  const row = db()
    .prepare(`SELECT image, type, posted_at FROM codex_pictures WHERE id = ? AND story_id = ? AND removed_at IS NULL`)
    .get(pictureId, storyId) as { image: Buffer; type: string; posted_at: number } | undefined;
  return row && { type: row.type, bytes: row.image, version: row.posted_at };
}

/** Every picture an entry has had on any branch, newest first (removed ones left out). */
export function listCodexPictures(storyId: string, entryId: string): CodexPicture[] {
  const rows = db()
    .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.story_id = ? AND p.entry_id = ? AND p.removed_at IS NULL ORDER BY p.posted_at DESC`)
    .all(storyId, entryId) as Row[];
  return rows.map(toPicture);
}

/** The ids of every picture in the story (removed ones left out), which a kept `codex:` reference may point to. */
export function codexPictureIds(storyId: string): string[] {
  return (db().prepare(`SELECT id FROM codex_pictures WHERE story_id = ? AND removed_at IS NULL`).all(storyId) as { id: string }[]).map((r) => r.id);
}

/**
 * Each entry's picture at a chapter, by entry id: among the pictures anchored at the whole story or on the
 * path to the chapter, the deepest anchor wins, then the latest. With no chapter, only whole-story pictures count.
 */
export function codexPicturesAt(storyId: string, chapterId: string | null): Record<string, CodexPicture> {
  const ids = chapterId === null ? [] : pathIds(storyId, chapterId);
  const rows = db()
    .prepare(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE p.story_id = ? AND p.removed_at IS NULL AND (p.anchor_chapter_id IS NULL${ids.length ? ` OR p.anchor_chapter_id IN (${ids.map(() => "?").join(",")})` : ""})
        ORDER BY COALESCE(c.depth, -1), p.posted_at, p.rowid`,
    )
    .all(storyId, ...ids) as Row[];
  // Oldest to newest in the order they take effect, so a later one replaces an earlier one.
  const out: Record<string, CodexPicture> = {};
  for (const r of rows) out[r.entry_id] = toPicture(r);
  return out;
}

/** One entry's picture at a chapter (see `codexPicturesAt`), or null. */
export function codexPictureAt(storyId: string, entryId: string, chapterId: string | null): CodexPicture | null {
  return codexPicturesAt(storyId, chapterId)[entryId] ?? null;
}

/**
 * The entries a picture page can offer as references: those that have a picture at the chapter (the live
 * entries there, with their names and aliases at that point in the story). With no chapter, the entries that
 * have a whole-story picture, named as they were last written anywhere.
 */
export function codexRefChoices(storyId: string, chapterId: string | null): CodexChoice[] {
  const pictures = codexPicturesAt(storyId, chapterId);
  const ids = Object.keys(pictures);
  if (ids.length === 0) return [];
  let entries: { entry_id: string; name: string; type: EntryType; aliases: string[] }[];
  if (chapterId !== null) {
    entries = getCodexState(chapterId);
  } else {
    const rows = db()
      .prepare(
        `SELECT entry_id, name, type, aliases FROM codex_ops WHERE story_id = ? AND op != 'retire' AND entry_id IN (${ids.map(() => "?").join(",")}) ORDER BY posted_at, rowid`,
      )
      .all(storyId, ...ids) as { entry_id: string; name: string; type: EntryType; aliases: string }[];
    entries = [...new Map(rows.map((r) => [r.entry_id, { ...r, aliases: JSON.parse(r.aliases) as string[] }])).values()];
  }
  return entries.flatMap((e) =>
    pictures[e.entry_id] ? [{ entryId: e.entry_id, pictureId: pictures[e.entry_id].id, name: e.name, type: e.type, aliases: e.aliases }] : [],
  );
}

/** The codex page's prompt boxes as saved. */
export const CodexDraftSchema = z.object({
  prompt: z.string().max(LIMITS.picturePrompt).default(""),
  negative: z.string().max(LIMITS.picturePrompt).default(""),
  /** The scene the prompt writer described, shown above the prompt. */
  scene: z.string().max(LIMITS.picturePrompt).default(""),
  /** "What to show". */
  direction: z.string().max(LIMITS.label).default(""),
  /** The reference pictures chosen (at most 4; uploads are never kept). */
  refs: z.array(StoredRefSchema).max(4).default([]),
});
export type CodexDraft = z.infer<typeof CodexDraftSchema>;

/** The entry's saved prompt boxes, or null when nothing was saved. */
export function getCodexDraft(storyId: string, entryId: string): CodexDraft | null {
  const row = db()
    .prepare(`SELECT prompt, negative, scene, direction, refs FROM codex_picture_prompts WHERE story_id = ? AND entry_id = ?`)
    .get(storyId, entryId) as (Omit<CodexDraft, "refs"> & { refs: string | null }) | undefined;
  return row ? { ...row, refs: row.refs ? (JSON.parse(row.refs) as CodexDraft["refs"]) : [] } : null;
}

/** Replaces the entry's saved prompt boxes (the preset stays). */
export function saveCodexDraft(storyId: string, entryId: string, d: CodexDraft): { ok: true } {
  requireEntry(storyId, entryId);
  db()
    .prepare(
      `INSERT INTO codex_picture_prompts (story_id, entry_id, prompt, negative, scene, direction, refs, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (story_id, entry_id) DO UPDATE SET prompt = excluded.prompt, negative = excluded.negative, scene = excluded.scene,
         direction = excluded.direction, refs = excluded.refs, updated_at = excluded.updated_at`,
    )
    .run(storyId, entryId, d.prompt, d.negative, d.scene, d.direction, d.refs.length ? JSON.stringify(d.refs) : null, Date.now());
  return { ok: true };
}

export const CodexPresetSchema = z.object({ draw_preset: z.string().trim().min(1).max(100).nullable() });

/** The drawing preset the entry's pictures use (an id from Settings), or null to use the story's. */
export function getCodexPreset(storyId: string, entryId: string): string | null {
  const row = db().prepare(`SELECT draw_preset FROM codex_picture_prompts WHERE story_id = ? AND entry_id = ?`).get(storyId, entryId) as { draw_preset: string | null } | undefined;
  return row?.draw_preset ?? null;
}

export function setCodexPreset(storyId: string, entryId: string, input: z.infer<typeof CodexPresetSchema>): { draw_preset: string | null } {
  requireEntry(storyId, entryId);
  db()
    .prepare(
      `INSERT INTO codex_picture_prompts (story_id, entry_id, draw_preset, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (story_id, entry_id) DO UPDATE SET draw_preset = excluded.draw_preset`,
    )
    .run(storyId, entryId, input.draw_preset, Date.now());
  return { draw_preset: input.draw_preset };
}
