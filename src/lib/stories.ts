import crypto from "node:crypto";
import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";

export type Story = {
  id: string;
  title: string;
  premise: string;
  author_name: string;
  root_chapter_id: string | null;
  created_at: number;
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
  author_name: string;
  posted_at: number;
  revision: number;
  edited_at: number | null;
  edited_by: string;
  edit_note: string | null;
};

export type Choice = {
  id: string;
  parent_chapter_id: string;
  label: string;
  author_name: string;
  posted_at: number;
  /** Id of the live child chapter, or null if the slot is still unwritten. */
  child_chapter_id: string | null;
};

export type Revision = {
  revision: number;
  title: string;
  body: string;
  author_name: string;
  edited_by: string;
  edit_note: string | null;
  created_at: number;
};

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1);
// A random secret generated in the browser when a chapter is posted. Only its hash is stored.
const editKey = z.string().min(16).max(128);

const chapterFields = {
  title: required(LIMITS.title),
  body: required(LIMITS.body),
  summary: text(LIMITS.summary).nullish(),
  path_summary: text(LIMITS.summary).nullish(),
  author_name: text(LIMITS.author).default(""),
  edit_key: editKey.optional(),
  // Labels of choices to declare on this chapter. They start out unwritten.
  choices: z.array(required(LIMITS.label)).max(LIMITS.choices).default([]),
};

export const NewStorySchema = z.object({
  title: required(LIMITS.title),
  premise: text(LIMITS.premise).default(""),
  author_name: text(LIMITS.author).default(""),
  chapter: z.object(chapterFields),
});

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
  edit_key: editKey,
  /** The revision the editor started from; a mismatch means it was edited elsewhere meanwhile. */
  base_revision: z.number().int().min(1),
  title: required(LIMITS.title),
  body: required(LIMITS.body),
  summary: text(LIMITS.summary).nullish(),
  path_summary: text(LIMITS.summary).nullish(),
  edited_by: text(LIMITS.author).default(""),
  edit_note: text(LIMITS.label).default(""),
  /** New text for the choice that leads into this chapter. */
  incoming_label: required(LIMITS.label).optional(),
  rename_choices: z.array(z.object({ id: z.string().min(1), label: required(LIMITS.label) })).max(LIMITS.choices).default([]),
  remove_choices: z.array(z.string().min(1)).max(LIMITS.choices).default([]),
  add_choices: z.array(required(LIMITS.label)).max(LIMITS.choices).default([]),
});

export const AddChoiceSchema = z.object({
  label: required(LIMITS.label),
  author_name: text(LIMITS.author).default(""),
});

export const EditStorySchema = z.object({
  /** The edit key of the story's first chapter. */
  edit_key: editKey,
  title: required(LIMITS.title),
  premise: text(LIMITS.premise).default(""),
});

export class PostError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const now = () => Date.now();

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function keyMatches(stored: string | null, presented: string): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(hashKey(presented), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function listStories(): (Story & { chapter_count: number })[] {
  return db()
    .prepare(
      `SELECT s.id, s.title, s.premise, s.author_name, s.root_chapter_id, s.created_at,
              (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.removed_at IS NULL) AS chapter_count
         FROM stories s WHERE s.removed_at IS NULL ORDER BY s.created_at DESC`,
    )
    .all() as (Story & { chapter_count: number })[];
}

export function getStory(id: string): Story | undefined {
  return db()
    .prepare(
      `SELECT id, title, premise, author_name, root_chapter_id, created_at
         FROM stories WHERE id = ? AND removed_at IS NULL`,
    )
    .get(id) as Story | undefined;
}

// Never includes edit_key_hash.
const CHAPTER_COLS = `c.id, c.story_id, c.parent_choice_id, c.depth, c.title, c.body, c.summary, c.path_summary,
  c.author_name, c.posted_at, c.revision, c.edited_at, c.edited_by, c.edit_note`;

export function getChapter(id: string): Chapter | undefined {
  return db()
    .prepare(`SELECT ${CHAPTER_COLS} FROM chapters c WHERE c.id = ? AND c.removed_at IS NULL`)
    .get(id) as Chapter | undefined;
}

export function getChoices(chapterId: string): Choice[] {
  return db()
    .prepare(
      `SELECT ch.id, ch.parent_chapter_id, ch.label, ch.author_name, ch.posted_at,
              (SELECT c.id FROM chapters c WHERE c.parent_choice_id = ch.id AND c.removed_at IS NULL) AS child_chapter_id
         FROM choices ch
        WHERE ch.parent_chapter_id = ? AND ch.removed_at IS NULL
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
      `WITH RECURSIVE path(id, parent_choice_id, removed_at) AS (
         SELECT id, parent_choice_id, removed_at FROM chapters WHERE id = ?
         UNION ALL
         SELECT c.id, c.parent_choice_id, c.removed_at
           FROM path
           JOIN choices ch ON ch.id = path.parent_choice_id
           JOIN chapters c ON c.id = ch.parent_chapter_id
       )
       SELECT id, removed_at FROM path`,
    )
    .all(chapterId) as { id: string; removed_at: number | null }[];
  // A removed ancestor hides the whole branch below it.
  if (ids.length === 0 || ids.some((r) => r.removed_at !== null)) return [];
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
          WHERE ch.parent_chapter_id = ? AND c.removed_at IS NULL
         UNION ALL
         SELECT c.id FROM d JOIN choices ch ON ch.parent_chapter_id = d.id
           JOIN chapters c ON c.parent_choice_id = ch.id WHERE c.removed_at IS NULL
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
      `SELECT revision, title, body, author_name, edited_by, edit_note, created_at
         FROM chapter_revisions WHERE chapter_id = ? ORDER BY revision DESC`,
    )
    .all(chapterId) as Revision[];
}

function insertChoices(chapterId: string, labels: string[], author: string, t: number) {
  const stmt = db().prepare(
    `INSERT INTO choices (id, parent_chapter_id, label, author_name, posted_at) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const label of labels) stmt.run(newId(), chapterId, label, author, t);
}

export function createStory(input: z.infer<typeof NewStorySchema>): { story_id: string; chapter_id: string } {
  const storyId = newId();
  const chapterId = newId();
  const t = now();
  const c = input.chapter;
  db().transaction(() => {
    db()
      .prepare(`INSERT INTO stories (id, title, premise, author_name, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(storyId, input.title, input.premise, input.author_name, t);
    db()
      .prepare(
        `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, summary, path_summary, author_name, posted_at, edit_key_hash)
         VALUES (?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chapterId,
        storyId,
        c.title,
        c.body,
        c.summary ?? null,
        c.path_summary ?? null,
        c.author_name,
        t,
        c.edit_key ? hashKey(c.edit_key) : null,
      );
    db().prepare(`UPDATE stories SET root_chapter_id = ? WHERE id = ?`).run(chapterId, storyId);
    insertChoices(chapterId, c.choices, c.author_name, t);
  })();
  return { story_id: storyId, chapter_id: chapterId };
}

export function createChapter(input: z.infer<typeof NewChapterSchema>): { story_id: string; chapter_id: string } {
  const chapterId = newId();
  const t = now();
  return db().transaction(() => {
    let parentChapter: Chapter | undefined;
    let choiceId: string;

    if (input.choice_id !== undefined) {
      const choice = db()
        .prepare(`SELECT id, parent_chapter_id FROM choices WHERE id = ? AND removed_at IS NULL`)
        .get(input.choice_id) as { id: string; parent_chapter_id: string } | undefined;
      if (!choice) throw new PostError("That choice does not exist", 404);
      parentChapter = getChapter(choice.parent_chapter_id);
      choiceId = choice.id;
    } else {
      parentChapter = getChapter(input.parent_chapter_id!);
      if (!parentChapter) throw new PostError("That chapter does not exist", 404);
      const count = db()
        .prepare(`SELECT COUNT(*) AS n FROM choices WHERE parent_chapter_id = ? AND removed_at IS NULL`)
        .get(parentChapter.id) as { n: number };
      if (count.n >= LIMITS.choices) throw new PostError("That chapter already has the maximum number of choices", 409);
      choiceId = newId();
      db()
        .prepare(`INSERT INTO choices (id, parent_chapter_id, label, author_name, posted_at) VALUES (?, ?, ?, ?, ?)`)
        .run(choiceId, parentChapter.id, input.new_choice_label, input.author_name, t);
    }
    // getChapter only checks the chapter itself; getPath also rejects a removed ancestor.
    if (!parentChapter || getPath(parentChapter.id).length === 0) {
      throw new PostError("That chapter does not exist", 404);
    }

    try {
      db()
        .prepare(
          `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, summary, path_summary, author_name, posted_at, edit_key_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.author_name,
          t,
          input.edit_key ? hashKey(input.edit_key) : null,
        );
    } catch (e) {
      if (e instanceof Error && "code" in e && String(e.code).startsWith("SQLITE_CONSTRAINT")) {
        throw new PostError("Someone already wrote a chapter for that choice", 409);
      }
      throw e;
    }
    insertChoices(chapterId, input.choices, input.author_name, t);
    return { story_id: parentChapter.story_id, chapter_id: chapterId };
  })();
}

function requireKey(chapterId: string, key: string) {
  const row = db()
    .prepare(`SELECT edit_key_hash, revision, removed_at FROM chapters WHERE id = ?`)
    .get(chapterId) as { edit_key_hash: string | null; revision: number; removed_at: number | null } | undefined;
  if (!row || row.removed_at !== null) throw new PostError("That chapter does not exist", 404);
  if (!keyMatches(row.edit_key_hash, key)) throw new PostError("This browser doesn't have the edit key for that chapter", 403);
  return row;
}

export function editChapter(chapterId: string, input: z.infer<typeof EditChapterSchema>): { revision: number } {
  return db().transaction(() => {
    const row = requireKey(chapterId, input.edit_key);
    if (row.revision !== input.base_revision) {
      throw new PostError("This chapter was edited somewhere else since you started. Reload it and redo your changes.", 409);
    }
    const current = db()
      .prepare(
        `SELECT title, body, summary, path_summary, author_name, edited_by, edit_note, posted_at, edited_at
           FROM chapters WHERE id = ?`,
      )
      .get(chapterId) as {
      title: string;
      body: string;
      summary: string | null;
      path_summary: string | null;
      author_name: string;
      edited_by: string;
      edit_note: string | null;
      posted_at: number;
      edited_at: number | null;
    };
    const t = now();

    // Keep the version being replaced.
    db()
      .prepare(
        `INSERT INTO chapter_revisions (id, chapter_id, revision, title, body, summary, path_summary, author_name, edited_by, edit_note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        chapterId,
        row.revision,
        current.title,
        current.body,
        current.summary,
        current.path_summary,
        current.author_name,
        current.edited_by,
        current.edit_note,
        current.edited_at ?? current.posted_at,
      );

    const revision = row.revision + 1;
    db()
      .prepare(
        `UPDATE chapters SET title = ?, body = ?, summary = ?, path_summary = ?, revision = ?,
                edited_at = ?, edited_by = ?, edit_note = ? WHERE id = ?`,
      )
      .run(
        input.title,
        input.body,
        input.summary ?? null,
        input.path_summary ?? null,
        revision,
        t,
        input.edited_by,
        input.edit_note || null,
        chapterId,
      );

    // Rolling summaries of everything below this chapter were built from the old text. They are
    // only a cache, so clear them; clients regenerate them when they next need them.
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
      db().prepare(`UPDATE choices SET removed_at = ? WHERE id = ?`).run(t, id);
    }
    const remaining = live.length - input.remove_choices.length;
    if (remaining + input.add_choices.length > LIMITS.choices) {
      throw new PostError("That would be more choices than a chapter can have", 409);
    }
    insertChoices(chapterId, input.add_choices, input.edited_by, t);

    if (input.incoming_label !== undefined) {
      db()
        .prepare(`UPDATE choices SET label = ? WHERE id = (SELECT parent_choice_id FROM chapters WHERE id = ?)`)
        .run(input.incoming_label, chapterId);
    }
    return { revision };
  })();
}

/** Declares another (unwritten) choice on a chapter, as anyone may when adding a branch. */
export function addChoice(chapterId: string, input: z.infer<typeof AddChoiceSchema>): { ok: true } {
  return db().transaction(() => {
    if (!getChapter(chapterId)) throw new PostError("That chapter does not exist", 404);
    const live = getChoices(chapterId);
    if (live.length >= LIMITS.choices) throw new PostError("That chapter already has as many choices as it can", 409);
    if (live.some((c) => c.label.trim().toLowerCase() === input.label.trim().toLowerCase())) {
      throw new PostError("That choice already exists", 409);
    }
    insertChoices(chapterId, [input.label], input.author_name, now());
    return { ok: true as const };
  })();
}

export function editStory(storyId: string, input: z.infer<typeof EditStorySchema>): { ok: true } {
  return db().transaction(() => {
    const story = getStory(storyId);
    if (!story?.root_chapter_id) throw new PostError("That story does not exist", 404);
    requireKey(story.root_chapter_id, input.edit_key);
    db().prepare(`UPDATE stories SET title = ?, premise = ? WHERE id = ?`).run(input.title, input.premise, storyId);
    return { ok: true as const };
  })();
}

// Summaries are a cache derived from chapter text. Anyone may fill one that is missing (for
// example after an edit cleared it), but nobody can overwrite an existing one except the
// chapter's author through an edit.
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
    const row = db()
      .prepare(`SELECT revision, removed_at FROM chapters WHERE id = ?`)
      .get(chapterId) as { revision: number; removed_at: number | null } | undefined;
    if (!row || row.removed_at !== null) throw new PostError("That chapter does not exist", 404);
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

// The chapter's author can replace its summaries by hand (to correct or regenerate them). This
// doesn't create a revision: summaries are a cache for the AI, not part of the chapter text.
export const ReplaceSummarySchema = z.object({
  edit_key: editKey,
  revision: z.number().int().min(1),
  summary: required(LIMITS.summary),
  path_summary: required(LIMITS.summary),
});

export function replaceSummaries(chapterId: string, input: z.infer<typeof ReplaceSummarySchema>): { ok: true } {
  return db().transaction(() => {
    const row = requireKey(chapterId, input.edit_key);
    if (row.revision !== input.revision) {
      throw new PostError("That chapter was edited since you opened this page. Reload it first.", 409);
    }
    db()
      .prepare(`UPDATE chapters SET summary = ?, path_summary = ? WHERE id = ?`)
      .run(input.summary, input.path_summary, chapterId);
    return { ok: true as const };
  })();
}
