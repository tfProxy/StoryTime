import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";
import type { StoredReference } from "./comfy/references";

export type Story = {
  id: string;
  title: string;
  premise: string;
  /** Author's style notes (point of view, tense, tone, limits), sent with every drafting prompt. */
  style: string;
  /** The look of the story's pictures (medium, palette, mood), added to every picture prompt. */
  art_style: string;
  /** How its picture prompts are written: tags (SDXL and the like) or sentences (Flux, SD3); null until chosen. */
  image_prompt_style: "tags" | "natural" | null;
  /** The checkpoint chosen before drawing presets (only read to turn it into a preset); "" when none was. */
  checkpoint: string;
  /** The drawing preset (an id from Settings) its chapters' pictures use unless a chapter chooses another; null for the first preset. */
  draw_preset: string | null;
  /** The story's style picture (role "style"), added to its picture jobs as a style reference; null for none. */
  style_ref: StoredReference | null;
  root_chapter_id: string | null;
  created_at: number;
  /** When the cover image was last set (it changes with every upload); null when there is no cover. */
  cover_version: number | null;
};

export type Chapter = {
  id: string;
  story_id: string;
  parent_choice_id: string | null;
  depth: number;
  title: string;
  body: string;
  summary: string | null;
  path_summary: string | null;
  posted_at: number;
  revision: number;
  edited_at: number | null;
  edit_note: string | null;
};

export type Choice = {
  id: string;
  parent_chapter_id: string;
  label: string;
  posted_at: number;
  /** Id of the child chapter, or null if the slot is still unwritten. */
  child_chapter_id: string | null;
};

export type Revision = {
  revision: number;
  title: string;
  body: string;
  edit_note: string | null;
  created_at: number;
};

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1);

const chapterFields = {
  title: required(LIMITS.title),
  body: required(LIMITS.body),
  summary: text(LIMITS.summary).nullish(),
  path_summary: text(LIMITS.summary).nullish(),
  // Labels of choices to declare on this chapter. They start out unwritten.
  choices: z.array(required(LIMITS.label)).max(LIMITS.choices).default([]),
};

// A story starts with its first chapter, or (from the New story form) with none yet: that is written
// afterwards and posted with FirstChapterSchema.
export const NewStorySchema = z.object({
  title: required(LIMITS.title),
  premise: text(LIMITS.premise).default(""),
  style: text(LIMITS.style).default(""),
  chapter: z.object(chapterFields).optional(),
});

export const FirstChapterSchema = z.object(chapterFields);

// Where the new chapter attaches: either fill an existing unwritten choice,
// or add a brand-new choice (with this chapter as its child) to a chapter.
export const NewChapterSchema = z
  .object({
    ...chapterFields,
    choice_id: z.string().min(1).optional(),
    parent_chapter_id: z.string().min(1).optional(),
    new_choice_label: required(LIMITS.label).optional(),
  })
  .refine(
    (v) => (v.choice_id !== undefined) !== (v.parent_chapter_id !== undefined && v.new_choice_label !== undefined),
    { message: "Provide either choice_id, or parent_chapter_id with new_choice_label" },
  );

export const EditChapterSchema = z.object({
  /** The revision the editor started from; a mismatch means it was edited elsewhere meanwhile. */
  base_revision: z.number().int().min(1),
  title: required(LIMITS.title),
  body: required(LIMITS.body),
  summary: text(LIMITS.summary).nullish(),
  path_summary: text(LIMITS.summary).nullish(),
  edit_note: text(LIMITS.label).default(""),
  /** New text for the choice that leads into this chapter. */
  incoming_label: required(LIMITS.label).optional(),
  rename_choices: z.array(z.object({ id: z.string().min(1), label: required(LIMITS.label) })).max(LIMITS.choices).default([]),
  remove_choices: z.array(z.string().min(1)).max(LIMITS.choices).default([]),
  add_choices: z.array(required(LIMITS.label)).max(LIMITS.choices).default([]),
});

export const AddChoiceSchema = z.object({
  label: required(LIMITS.label),
});

// Only the fields sent are changed, so the style notes can be saved on their own.
export const EditStorySchema = z.object({
  title: required(LIMITS.title).optional(),
  premise: text(LIMITS.premise).optional(),
  style: text(LIMITS.style).optional(),
  art_style: text(LIMITS.artStyle).optional(),
  image_prompt_style: z.enum(["tags", "natural"]).nullable().optional(),
  checkpoint: text(LIMITS.label).optional(),
  draw_preset: z.string().trim().min(1).max(100).nullable().optional(),
  style_ref: z
    .object({ source: z.string().trim().min(1).max(300), label: z.string().trim().max(40), role: z.literal("style"), weight: z.number().min(0).max(1) })
    .nullable()
    .optional(),
});

/** A story row as read from the database: its style picture is JSON text. */
function withStyleRef<T extends { style_ref: unknown }>(row: T): Omit<T, "style_ref"> & { style_ref: StoredReference | null } {
  let ref: StoredReference | null = null;
  try {
    const v = typeof row.style_ref === "string" ? JSON.parse(row.style_ref) : null;
    if (v && typeof v.source === "string" && typeof v.weight === "number") ref = { source: v.source, label: String(v.label ?? ""), role: "style", weight: v.weight };
  } catch {
    ref = null;
  }
  return { ...row, style_ref: ref };
}

/** A chapter's own drawing preset (an id from Settings), or null to use its story's. */
export const ChapterPresetSchema = z.object({ draw_preset: z.string().trim().min(1).max(100).nullable() });

export function getChapterPreset(chapterId: string): string | null {
  const row = db().prepare(`SELECT draw_preset FROM chapters WHERE id = ?`).get(chapterId) as { draw_preset: string | null } | undefined;
  return row?.draw_preset ?? null;
}

export function setChapterPreset(chapterId: string, input: z.infer<typeof ChapterPresetSchema>): { draw_preset: string | null } {
  const { changes } = db().prepare(`UPDATE chapters SET draw_preset = ? WHERE id = ?`).run(input.draw_preset, chapterId);
  if (changes === 0) throw new PostError("That chapter does not exist", 404);
  return { draw_preset: input.draw_preset };
}

/** Text always included in the chapter's picture prompts. */
export const ChapterFixedSchema = z.object({ fixed: z.string().max(LIMITS.picturePrompt) });

export function getChapterFixed(chapterId: string): string {
  const row = db().prepare(`SELECT picture_fixed FROM chapters WHERE id = ?`).get(chapterId) as { picture_fixed: string } | undefined;
  return row?.picture_fixed ?? "";
}

export function setChapterFixed(chapterId: string, input: z.infer<typeof ChapterFixedSchema>): { fixed: string } {
  const { changes } = db().prepare(`UPDATE chapters SET picture_fixed = ? WHERE id = ?`).run(input.fixed, chapterId);
  if (changes === 0) throw new PostError("That chapter does not exist", 404);
  return { fixed: input.fixed };
}

export class PostError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const now = () => Date.now();

export function listStories(): (Story & { chapter_count: number })[] {
  const rows = db()
    .prepare(
      `SELECT s.id, s.title, s.premise, s.style, s.art_style, s.image_prompt_style, s.checkpoint, s.draw_preset, s.style_ref, s.root_chapter_id, s.created_at, s.cover_updated_at AS cover_version,
              (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id) AS chapter_count
         FROM stories s ORDER BY s.created_at DESC`,
    )
    .all() as (Omit<Story, "style_ref"> & { style_ref: string | null; chapter_count: number })[];
  return rows.map(withStyleRef) as (Story & { chapter_count: number })[];
}

export function getStory(id: string): Story | undefined {
  const row = db()
    .prepare(
      `SELECT id, title, premise, style, art_style, image_prompt_style, checkpoint, draw_preset, style_ref, root_chapter_id, created_at, cover_updated_at AS cover_version
         FROM stories WHERE id = ?`,
    )
    .get(id) as (Omit<Story, "style_ref"> & { style_ref: string | null }) | undefined;
  return row && (withStyleRef(row) as Story);
}

const CHAPTER_COLS = `c.id, c.story_id, c.parent_choice_id, c.depth, c.title, c.body, c.summary, c.path_summary,
  c.posted_at, c.revision, c.edited_at, c.edit_note`;

export function getChapter(id: string): Chapter | undefined {
  return db()
    .prepare(`SELECT ${CHAPTER_COLS} FROM chapters c WHERE c.id = ?`)
    .get(id) as Chapter | undefined;
}

/** The titles of these chapters and of their stories, by chapter id (unknown ids are left out): what the picture queue's list shows. */
export function chapterLabels(ids: string[]): Record<string, { title: string; story_title: string }> {
  if (ids.length === 0) return {};
  const rows = db()
    .prepare(
      `SELECT c.id, c.title, s.title AS story_title FROM chapters c JOIN stories s ON s.id = c.story_id
        WHERE c.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as { id: string; title: string; story_title: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, { title: r.title, story_title: r.story_title }]));
}

/** The titles of some stories, by id; ids that don't exist are left out. */
export function storyTitles(ids: string[]): Record<string, string> {
  if (ids.length === 0) return {};
  const rows = db()
    .prepare(`SELECT id, title FROM stories WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { id: string; title: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.title]));
}

export function getChoices(chapterId: string): Choice[] {
  return db()
    .prepare(
      `SELECT ch.id, ch.parent_chapter_id, ch.label, ch.posted_at,
              (SELECT c.id FROM chapters c WHERE c.parent_choice_id = ch.id) AS child_chapter_id
         FROM choices ch
        WHERE ch.parent_chapter_id = ?
        ORDER BY ch.posted_at, ch.rowid`,
    )
    .all(chapterId) as Choice[];
}

/** The choice that leads into this chapter (null for a story's first chapter). */
export function getIncomingChoice(chapterId: string): { id: string; label: string } | null {
  const row = db()
    .prepare(
      `SELECT ch.id, ch.label FROM chapters c JOIN choices ch ON ch.id = c.parent_choice_id WHERE c.id = ?`,
    )
    .get(chapterId) as { id: string; label: string } | undefined;
  return row ?? null;
}

/** Chapters from the story root down to (and including) the given chapter. */
export function getPath(chapterId: string): Chapter[] {
  const ids = db()
    .prepare(
      `WITH RECURSIVE path(id, parent_choice_id) AS (
         SELECT id, parent_choice_id FROM chapters WHERE id = ?
         UNION ALL
         SELECT c.id, c.parent_choice_id
           FROM path
           JOIN choices ch ON ch.id = path.parent_choice_id
           JOIN chapters c ON c.id = ch.parent_chapter_id
       )
       SELECT id FROM path`,
    )
    .all(chapterId) as { id: string }[];
  if (ids.length === 0) return [];
  const chapters = db()
    .prepare(`SELECT ${CHAPTER_COLS} FROM chapters c WHERE c.id IN (${ids.map(() => "?").join(",")}) ORDER BY c.depth`)
    .all(...ids.map((r) => r.id)) as Chapter[];
  return chapters;
}

export function countDescendants(chapterId: string): number {
  const row = db()
    .prepare(
      `WITH RECURSIVE d(id) AS (
         SELECT c.id FROM choices ch JOIN chapters c ON c.parent_choice_id = ch.id
          WHERE ch.parent_chapter_id = ?
         UNION ALL
         SELECT c.id FROM d JOIN choices ch ON ch.parent_chapter_id = d.id
           JOIN chapters c ON c.parent_choice_id = ch.id
       )
       SELECT COUNT(*) AS n FROM d`,
    )
    .get(chapterId) as { n: number };
  return row.n;
}

/** Superseded versions of a chapter, newest first. The live version is the chapter itself. */
export function getRevisions(chapterId: string): Revision[] {
  return db()
    .prepare(
      `SELECT revision, title, body, edit_note, created_at
         FROM chapter_revisions WHERE chapter_id = ? ORDER BY revision DESC`,
    )
    .all(chapterId) as Revision[];
}

/** Returns the new choices' ids, in the order given. */
function insertChoices(chapterId: string, labels: string[], t: number): string[] {
  const stmt = db().prepare(`INSERT INTO choices (id, parent_chapter_id, label, posted_at) VALUES (?, ?, ?, ?)`);
  return labels.map((label) => {
    const id = newId();
    stmt.run(id, chapterId, label, t);
    return id;
  });
}

/** What posting a chapter returns; `choice_ids` are its choices, in the order they were given. */
export type Posted = { story_id: string; chapter_id: string; choice_ids: string[] };

/** Adds a story's first chapter and its choices; inside a transaction. */
function insertFirstChapter(storyId: string, c: z.infer<typeof FirstChapterSchema>, t: number): Posted {
  const chapterId = newId();
  db()
    .prepare(
      `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, summary, path_summary, posted_at)
       VALUES (?, ?, NULL, 0, ?, ?, ?, ?, ?)`,
    )
    .run(chapterId, storyId, c.title, c.body, c.summary ?? null, c.path_summary ?? null, t);
  db().prepare(`UPDATE stories SET root_chapter_id = ? WHERE id = ?`).run(chapterId, storyId);
  return { story_id: storyId, chapter_id: chapterId, choice_ids: insertChoices(chapterId, c.choices, t) };
}

/** A new story, with its first chapter when given; without one, `chapter_id` is null. */
export function createStory(input: z.infer<typeof NewStorySchema>): Posted | { story_id: string; chapter_id: null; choice_ids: [] } {
  const storyId = newId();
  const t = now();
  return db().transaction(() => {
    db()
      .prepare(`INSERT INTO stories (id, title, premise, style, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(storyId, input.title, input.premise, input.style, t);
    return input.chapter ? insertFirstChapter(storyId, input.chapter, t) : { story_id: storyId, chapter_id: null, choice_ids: [] as [] };
  })();
}

/** Posts the first chapter of a story that has none yet. */
export function createFirstChapter(storyId: string, input: z.infer<typeof FirstChapterSchema>): Posted {
  return db().transaction(() => {
    const story = getStory(storyId);
    if (!story) throw new PostError("That story does not exist", 404);
    if (story.root_chapter_id) throw new PostError("That story already has its first chapter", 409);
    return insertFirstChapter(storyId, input, now());
  })();
}

export function createChapter(input: z.infer<typeof NewChapterSchema>): Posted {
  const chapterId = newId();
  const t = now();
  return db().transaction(() => {
    let parentChapter: Chapter | undefined;
    let choiceId: string;

    if (input.choice_id !== undefined) {
      const choice = db()
        .prepare(`SELECT id, parent_chapter_id FROM choices WHERE id = ?`)
        .get(input.choice_id) as { id: string; parent_chapter_id: string } | undefined;
      if (!choice) throw new PostError("That choice does not exist", 404);
      parentChapter = getChapter(choice.parent_chapter_id);
      choiceId = choice.id;
    } else {
      parentChapter = getChapter(input.parent_chapter_id!);
      if (!parentChapter) throw new PostError("That chapter does not exist", 404);
      const count = db()
        .prepare(`SELECT COUNT(*) AS n FROM choices WHERE parent_chapter_id = ?`)
        .get(parentChapter.id) as { n: number };
      if (count.n >= LIMITS.choices) throw new PostError("That chapter already has the maximum number of choices", 409);
      choiceId = newId();
      db()
        .prepare(`INSERT INTO choices (id, parent_chapter_id, label, posted_at) VALUES (?, ?, ?, ?)`)
        .run(choiceId, parentChapter.id, input.new_choice_label, t);
    }
    if (!parentChapter) {
      throw new PostError("That chapter does not exist", 404);
    }

    try {
      db()
        .prepare(
          `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, summary, path_summary, posted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chapterId,
          parentChapter.story_id,
          choiceId,
          parentChapter.depth + 1,
          input.title,
          input.body,
          input.summary ?? null,
          input.path_summary ?? null,
          t,
        );
    } catch (e) {
      if (e instanceof Error && "code" in e && String(e.code).startsWith("SQLITE_CONSTRAINT")) {
        throw new PostError("A chapter is already written for that choice", 409);
      }
      throw e;
    }
    const choiceIds = insertChoices(chapterId, input.choices, t);
    return { story_id: parentChapter.story_id, chapter_id: chapterId, choice_ids: choiceIds };
  })();
}

function chapterRevision(chapterId: string) {
  const row = db().prepare(`SELECT revision FROM chapters WHERE id = ?`).get(chapterId) as
    | { revision: number }
    | undefined;
  if (!row) throw new PostError("That chapter does not exist", 404);
  return row;
}

export function editChapter(chapterId: string, input: z.infer<typeof EditChapterSchema>): { revision: number } {
  return db().transaction(() => {
    const row = chapterRevision(chapterId);
    if (row.revision !== input.base_revision) {
      throw new PostError("This chapter was edited somewhere else since you started. Reload it and redo your changes.", 409);
    }
    const current = db()
      .prepare(
        `SELECT title, body, summary, path_summary, edit_note, posted_at, edited_at
           FROM chapters WHERE id = ?`,
      )
      .get(chapterId) as {
      title: string;
      body: string;
      summary: string | null;
      path_summary: string | null;
      edit_note: string | null;
      posted_at: number;
      edited_at: number | null;
    };
    const t = now();

    // Keep the version being replaced.
    db()
      .prepare(
        `INSERT INTO chapter_revisions (id, chapter_id, revision, title, body, summary, path_summary, edit_note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        chapterId,
        row.revision,
        current.title,
        current.body,
        current.summary,
        current.path_summary,
        current.edit_note,
        current.edited_at ?? current.posted_at,
      );

    const revision = row.revision + 1;
    db()
      .prepare(
        `UPDATE chapters SET title = ?, body = ?, summary = ?, path_summary = ?, revision = ?,
                edited_at = ?, edit_note = ? WHERE id = ?`,
      )
      .run(
        input.title,
        input.body,
        input.summary ?? null,
        input.path_summary ?? null,
        revision,
        t,
        input.edit_note || null,
        chapterId,
      );

    // Rolling summaries of everything below this chapter build on this chapter's own. They are only a
    // cache, so when it changes clear them and let clients regenerate them when they next need them.
    // An edit that keeps it (a new title or choices, or text the author chose not to re-summarize) leaves them be.
    if ((input.path_summary ?? null) !== current.path_summary) {
      db()
        .prepare(
          `WITH RECURSIVE d(id) AS (
             SELECT c.id FROM choices ch JOIN chapters c ON c.parent_choice_id = ch.id WHERE ch.parent_chapter_id = ?
             UNION ALL
             SELECT c.id FROM d JOIN choices ch ON ch.parent_chapter_id = d.id JOIN chapters c ON c.parent_choice_id = ch.id
           )
           UPDATE chapters SET path_summary = NULL WHERE id IN (SELECT id FROM d)`,
        )
        .run(chapterId);
    }

    // Choices on this chapter.
    const live = getChoices(chapterId);
    const byId = new Map(live.map((c) => [c.id, c]));
    for (const r of input.rename_choices) {
      if (!byId.has(r.id)) throw new PostError("A choice you renamed isn't on this chapter", 400);
      db().prepare(`UPDATE choices SET label = ? WHERE id = ?`).run(r.label, r.id);
    }
    for (const id of input.remove_choices) {
      const c = byId.get(id);
      if (!c) throw new PostError("A choice you removed isn't on this chapter", 400);
      if (c.child_chapter_id) throw new PostError(`"${c.label}" already has a chapter written for it and can't be removed`, 409);
      db().prepare(`DELETE FROM choices WHERE id = ?`).run(id);
    }
    const remaining = live.length - input.remove_choices.length;
    if (remaining + input.add_choices.length > LIMITS.choices) {
      throw new PostError("That would be more choices than a chapter can have", 409);
    }
    insertChoices(chapterId, input.add_choices, t);

    if (input.incoming_label !== undefined) {
      db()
        .prepare(`UPDATE choices SET label = ? WHERE id = (SELECT parent_choice_id FROM chapters WHERE id = ?)`)
        .run(input.incoming_label, chapterId);
    }
    return { revision };
  })();
}

/** Declares another (unwritten) choice on a chapter when adding a branch. */
export function addChoice(chapterId: string, input: z.infer<typeof AddChoiceSchema>): { ok: true } {
  return db().transaction(() => {
    if (!getChapter(chapterId)) throw new PostError("That chapter does not exist", 404);
    const live = getChoices(chapterId);
    if (live.length >= LIMITS.choices) throw new PostError("That chapter already has as many choices as it can", 409);
    if (live.some((c) => c.label.trim().toLowerCase() === input.label.trim().toLowerCase())) {
      throw new PostError("That choice already exists", 409);
    }
    insertChoices(chapterId, [input.label], now());
    return { ok: true as const };
  })();
}

export function editStory(storyId: string, input: z.infer<typeof EditStorySchema>): { ok: true } {
  return db().transaction(() => {
    const story = getStory(storyId);
    if (!story) throw new PostError("That story does not exist", 404);
    db()
      .prepare(`UPDATE stories SET title = ?, premise = ?, style = ?, art_style = ?, image_prompt_style = ?, checkpoint = ?, draw_preset = ?, style_ref = ? WHERE id = ?`)
      .run(
        input.title ?? story.title, input.premise ?? story.premise, input.style ?? story.style,
        input.art_style ?? story.art_style,
        input.image_prompt_style === undefined ? story.image_prompt_style : input.image_prompt_style,
        input.checkpoint ?? story.checkpoint,
        input.draw_preset === undefined ? story.draw_preset : input.draw_preset,
        (input.style_ref === undefined ? story.style_ref : input.style_ref) === null ? null : JSON.stringify(input.style_ref === undefined ? story.style_ref : input.style_ref),
        storyId,
      );
    return { ok: true as const };
  })();
}

/** Uploaded images (covers, chapter illustrations): checked by the file's first bytes rather than its claimed type. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_SIGNATURES: [type: string, matches: (b: Buffer) => boolean][] = [
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1"))],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];

/** The image's type (PNG, JPEG, GIF or WebP), or a PostError saying why it can't be used. */
export function checkImage(bytes: Buffer, what: string): string {
  if (bytes.length === 0) throw new PostError("No image was sent", 400);
  if (bytes.length > IMAGE_MAX_BYTES) throw new PostError("That image is too large (4 MB at most)", 413);
  const type = IMAGE_SIGNATURES.find(([, matches]) => matches(bytes))?.[0];
  if (!type) throw new PostError(`The ${what} must be a PNG, JPEG, GIF or WebP image`, 415);
  return type;
}

export function setCover(storyId: string, bytes: Buffer): { cover_version: number } {
  const type = checkImage(bytes, "cover");
  // Two uploads in the same millisecond must still get different versions.
  const prev = db().prepare(`SELECT cover_updated_at AS v FROM stories WHERE id = ?`).get(storyId) as { v: number | null } | undefined;
  if (!prev) throw new PostError("That story does not exist", 404);
  const version = Math.max(now(), (prev.v ?? 0) + 1);
  db().prepare(`UPDATE stories SET cover = ?, cover_type = ?, cover_updated_at = ? WHERE id = ?`).run(bytes, type, version, storyId);
  return { cover_version: version };
}

export function clearCover(storyId: string): { ok: true } {
  const r = db()
    .prepare(
      `UPDATE stories SET cover = NULL, cover_type = NULL, cover_updated_at = NULL, cover_job_id = NULL, cover_image_index = NULL,
         cover_prompt = NULL, cover_negative = NULL WHERE id = ?`,
    )
    .run(storyId);
  if (r.changes === 0) throw new PostError("That story does not exist", 404);
  return { ok: true };
}

export function getCover(storyId: string): { type: string; bytes: Buffer; version: number } | undefined {
  const row = db()
    .prepare(`SELECT cover, cover_type, cover_updated_at FROM stories WHERE id = ? AND cover IS NOT NULL`)
    .get(storyId) as { cover: Buffer; cover_type: string; cover_updated_at: number } | undefined;
  return row && { type: row.cover_type, bytes: row.cover, version: row.cover_updated_at };
}

// Summaries are a cache derived from chapter text. There are two write paths on purpose:
// - fillSummaries (POST) is the automatic one, used when drafting or posting generates missing
//   summaries in the background. It only fills a field that is empty, so an unattended save can
//   never overwrite text the user wrote or regenerated by hand.
// - replaceSummaries (PUT) is the deliberate one, used by the Summary page and "Redo summaries".
//   It overwrites both fields.
// Do not merge them without deciding what should happen when a background save races a manual edit.
export const SetSummarySchema = z.object({
  /** The chapter revision the summaries were generated from. */
  revision: z.number().int().min(1),
  summary: text(LIMITS.summary).optional(),
  path_summary: text(LIMITS.summary).optional(),
});

export function fillSummaries(
  chapterId: string,
  input: z.infer<typeof SetSummarySchema>,
): { summary_set: boolean; path_summary_set: boolean } {
  return db().transaction(() => {
    const row = chapterRevision(chapterId);
    if (row.revision !== input.revision) {
      throw new PostError("That chapter was edited since the summary was made", 409);
    }
    const s = input.summary
      ? db().prepare(`UPDATE chapters SET summary = ? WHERE id = ? AND summary IS NULL`).run(input.summary, chapterId)
      : null;
    const p = input.path_summary
      ? db()
          .prepare(`UPDATE chapters SET path_summary = ? WHERE id = ? AND path_summary IS NULL`)
          .run(input.path_summary, chapterId)
      : null;
    return { summary_set: (s?.changes ?? 0) > 0, path_summary_set: (p?.changes ?? 0) > 0 };
  })();
}

// Replace a chapter's summaries by hand (to correct or regenerate them). This doesn't create a revision: summaries are a cache for the AI, not part of the chapter text.
export const ReplaceSummarySchema = z.object({
  revision: z.number().int().min(1),
  summary: required(LIMITS.summary),
  path_summary: required(LIMITS.summary),
});

export function replaceSummaries(chapterId: string, input: z.infer<typeof ReplaceSummarySchema>): { ok: true } {
  return db().transaction(() => {
    const row = chapterRevision(chapterId);
    if (row.revision !== input.revision) {
      throw new PostError("That chapter was edited since you opened this page. Reload it first.", 409);
    }
    db()
      .prepare(`UPDATE chapters SET summary = ?, path_summary = ? WHERE id = ?`)
      .run(input.summary, input.path_summary, chapterId);
    return { ok: true as const };
  })();
}
