import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";
import { jobPrompts, setPictureMark, StoredRefSchema } from "./pictureJobs";
import type { ImageMade } from "./imageSlots";
import { checkImage, getPath, PostError } from "./stories";
import { getCodexState, getStoryCodexOps } from "./codexDb";
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
  /** True for a picture of a shared entry, which every story that links the entry shows. */
  shared: boolean;
};

type Row = {
  id: string;
  shared_id: string | null;
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

const COLUMNS = `p.id, p.shared_entry_id AS shared_id, p.entry_id, p.anchor_chapter_id, COALESCE(c.depth, -1) AS depth, p.posted_at, p.prompt, p.negative, p.job_id,
  j.seed, j.checkpoint, j.width, j.height,
  COALESCE(p.image_index, CASE WHEN json_array_length(j.images) = 1 THEN 0 END) AS image_index`;
const FROM = `codex_pictures p LEFT JOIN chapters c ON c.id = p.anchor_chapter_id LEFT JOIN picture_jobs j ON j.id = p.job_id`;

/** `entryId` is the entry as the reading story knows it (a shared picture was made under another story's entry id). */
function toPicture(r: Row, entryId = r.entry_id): CodexPicture {
  return {
    id: r.id,
    entry_id: entryId,
    anchor_chapter_id: r.anchor_chapter_id,
    posted_at: r.posted_at,
    shared: r.shared_id !== null,
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

/** The shared entries the story links to, each with the story's own entry id(s) for it. */
function sharedLinks(storyId: string): Map<string, string[]> {
  const rows = db()
    .prepare(`SELECT DISTINCT shared_entry_id, entry_id FROM codex_ops WHERE story_id = ? AND shared_entry_id IS NOT NULL`)
    .all(storyId) as { shared_entry_id: string; entry_id: string }[];
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.shared_entry_id, [...(out.get(r.shared_entry_id) ?? []), r.entry_id]);
  return out;
}

/** The shared entry this story's entry is linked to, or null. */
export function sharedIdOfEntry(storyId: string, entryId: string): string | null {
  const row = db().prepare(`SELECT shared_entry_id FROM codex_ops WHERE story_id = ? AND entry_id = ? AND shared_entry_id IS NOT NULL LIMIT 1`).get(storyId, entryId) as
    | { shared_entry_id: string }
    | undefined;
  return row?.shared_entry_id ?? null;
}

/** SQL that is true for a picture row this story may read or remove: its own, or a shared one of an entry it links. Takes the story id twice. */
const VISIBLE = `((p.story_id = ? AND p.shared_entry_id IS NULL) OR p.shared_entry_id IN (SELECT shared_entry_id FROM codex_ops WHERE story_id = ? AND shared_entry_id IS NOT NULL))`;

/** The shared pictures the story's linked entries have (removed ones left out), oldest first, as [story's entry id, picture]. */
function sharedPicturesOf(storyId: string, only?: string): [string, CodexPicture][] {
  const links = sharedLinks(storyId);
  const ids = [...links.keys()];
  if (ids.length === 0) return [];
  const rows = db()
    .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.removed_at IS NULL AND p.shared_entry_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.posted_at, p.rowid`)
    .all(...ids) as Row[];
  return rows.flatMap((r) => (links.get(r.shared_id!) ?? []).filter((e) => only === undefined || e === only).map((e): [string, CodexPicture] => [e, toPicture(r, e)]));
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
 * `index` (when given) is remembered and pinned. With `shared`, the entry must be linked to a shared entry and the
 * picture is the shared entry's, shown in every story that links it (it has no anchor).
 */
export function saveCodexPicture(
  storyId: string,
  entryId: string,
  anchor: string | null,
  bytes: Buffer,
  jobId?: string | null,
  index?: number | null,
  shared = false,
): { id: string } {
  const type = checkImage(bytes, "picture");
  if (!db().prepare(`SELECT 1 FROM stories WHERE id = ?`).get(storyId)) throw new PostError("That story does not exist", 404);
  requireEntry(storyId, entryId);
  const sharedId = shared ? sharedIdOfEntry(storyId, entryId) : null;
  if (shared && !sharedId) throw new PostError("Only an entry linked to a shared entry can have a shared picture", 400);
  if (shared) anchor = null;
  if (anchor !== null) pathIds(storyId, anchor);
  const made = jobId ? jobPrompts(jobId) : undefined;
  const at = made && index !== undefined && index !== null && Number.isInteger(index) && index >= 0 && index < made.count ? index : null;
  const id = newId();
  // Two saves in the same millisecond must still order: the later one wins.
  const last = db()
    .prepare(`SELECT MAX(posted_at) AS t FROM codex_pictures WHERE (story_id = ? AND entry_id = ?) OR (? IS NOT NULL AND shared_entry_id = ?)`)
    .get(storyId, entryId, sharedId, sharedId) as { t: number | null };
  const postedAt = Math.max(Date.now(), (last.t ?? 0) + 1);
  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO codex_pictures (id, story_id, entry_id, anchor_chapter_id, job_id, image_index, image, type, prompt, negative, posted_at, shared_entry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, storyId, entryId, anchor, made ? jobId : null, at, bytes, type, made?.prompt ?? "", made?.negative ?? "", postedAt, sharedId);
    // A picture chosen for the codex is worth keeping, so it is pinned (also when it was trashed before).
    if (jobId && at !== null) setPictureMark(jobId, at, "pinned");
  })();
  return { id };
}

/**
 * Hides a picture, so the one before it (if any) shows again. A shared picture is hidden for every story that
 * links its entry.
 */
export function removeCodexPicture(storyId: string, pictureId: string): { ok: true } {
  const done = db()
    .prepare(`UPDATE codex_pictures AS p SET removed_at = ? WHERE p.id = ? AND p.removed_at IS NULL AND ${VISIBLE}`)
    .run(Date.now(), pictureId, storyId, storyId);
  if (done.changes === 0) throw new PostError("That picture does not exist", 404);
  return { ok: true };
}

/** The picture's bytes, or undefined when there is none (or it was removed, or it is another story's and not shared with this one). */
export function getCodexPictureImage(storyId: string, pictureId: string): { type: string; bytes: Buffer; version: number } | undefined {
  const row = db()
    .prepare(`SELECT p.image, p.type, p.posted_at FROM codex_pictures p WHERE p.id = ? AND p.removed_at IS NULL AND ${VISIBLE}`)
    .get(pictureId, storyId, storyId) as { image: Buffer; type: string; posted_at: number } | undefined;
  return row && { type: row.type, bytes: row.image, version: row.posted_at };
}

/** Every picture an entry has had on any branch, newest first (removed ones left out), the shared entry's pictures among them. */
export function listCodexPictures(storyId: string, entryId: string): CodexPicture[] {
  const own = (
    db()
      .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.story_id = ? AND p.entry_id = ? AND p.shared_entry_id IS NULL AND p.removed_at IS NULL`)
      .all(storyId, entryId) as Row[]
  ).map((r) => toPicture(r));
  const shared = sharedPicturesOf(storyId, entryId).map(([, p]) => p);
  return [...own, ...shared].sort((a, b) => b.posted_at - a.posted_at);
}

/** The ids of every picture the story can show (removed ones left out), which a kept `codex:` reference may point to. */
export function codexPictureIds(storyId: string): string[] {
  const own = (db().prepare(`SELECT id FROM codex_pictures WHERE story_id = ? AND shared_entry_id IS NULL AND removed_at IS NULL`).all(storyId) as { id: string }[]).map((r) => r.id);
  return [...own, ...new Set(sharedPicturesOf(storyId).map(([, p]) => p.id))];
}

/**
 * Each entry's picture at a chapter, by entry id: among the pictures anchored at the whole story or on the
 * path to the chapter, the deepest anchor wins, then the latest. With no chapter, only whole-story pictures count.
 * An entry linked to a shared entry falls back to the shared picture (the latest) when the story has none of its own here.
 */
export function codexPicturesAt(storyId: string, chapterId: string | null): Record<string, CodexPicture> {
  const ids = chapterId === null ? [] : pathIds(storyId, chapterId);
  const rows = db()
    .prepare(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE p.story_id = ? AND p.shared_entry_id IS NULL AND p.removed_at IS NULL AND (p.anchor_chapter_id IS NULL${ids.length ? ` OR p.anchor_chapter_id IN (${ids.map(() => "?").join(",")})` : ""})
        ORDER BY COALESCE(c.depth, -1), p.posted_at, p.rowid`,
    )
    .all(storyId, ...ids) as Row[];
  // Oldest to newest in the order they take effect, so a later one replaces an earlier one.
  const out: Record<string, CodexPicture> = {};
  for (const r of rows) out[r.entry_id] = toPicture(r);
  const shared: Record<string, CodexPicture> = {};
  for (const [entryId, p] of sharedPicturesOf(storyId)) shared[entryId] = p;
  for (const [entryId, p] of Object.entries(shared)) if (!(entryId in out)) out[entryId] = p;
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
    // The story's ops with linked entries read from their shared entry, as the story reads them.
    const rows = getStoryCodexOps(storyId).filter((o) => o.op !== "retire" && ids.includes(o.entry_id));
    entries = [...new Map(rows.map((r) => [r.entry_id, { entry_id: r.entry_id, name: r.name, type: r.type, aliases: r.aliases }])).values()];
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
