import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";

export type Story = {
  id: string;
  title: string;
  premise: string;
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

export const NewStorySchema = z.object({
  title: required(LIMITS.title),
  premise: text(LIMITS.premise).default(""),
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

export const EditStorySchema = z.object({
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

export function listStories(): (Story & { chapter_count: number })[] {
  return db()
    .prepare(
      `SELECT s.id, s.title, s.premise, s.root_chapter_id, s.created_at,
              (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id) AS chapter_count
         FROM stories s ORDER BY s.created_at DESC`,
    )
    .all() as (Story & { chapter_count: number })[];
}

export function getStory(id: string): Story | undefined {
  return db()
    .prepare(
      `SELECT id, title, premise, root_chapter_id, created_at
         FROM stories WHERE id = ?`,
    )
    .get(id) as Story | undefined;
}

const CHAPTER_COLS = `c.id, c.story_id, c.parent_choice_id, c.depth, c.title, c.body, c.summary, c.path_summary,
  c.posted_at, c.revision, c.edited_at, c.edit_note`;

export function getChapter(id: string): Chapter | undefined {
  return db()
    .prepare(`SELECT ${CHAPTER_COLS} FROM chapters c WHERE c.id = ?`)
    .get(id) as Chapter | undefined;
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

function insertChoices(chapterId: string, labels: string[], t: number) {
  const stmt = db().prepare(`INSERT INTO choices (id, parent_chapter_id, label, posted_at) VALUES (?, ?, ?, ?)`);
  for (const label of labels) stmt.run(newId(), chapterId, label, t);
}

export function createStory(input: z.infer<typeof NewStorySchema>): { story_id: string; chapter_id: string } {
  const storyId = newId();
  const chapterId = newId();
  const t = now();
  const c = input.chapter;
  db().transaction(() => {
    db()
      .prepare(`INSERT INTO stories (id, title, premise, created_at) VALUES (?, ?, ?, ?)`)
      .run(storyId, input.title, input.premise, t);
    db()
      .prepare(
        `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, summary, path_summary, posted_at)
         VALUES (?, ?, NULL, 0, ?, ?, ?, ?, ?)`,
      )
      .run(chapterId, storyId, c.title, c.body, c.summary ?? null, c.path_summary ?? null, t);
    db().prepare(`UPDATE stories SET root_chapter_id = ? WHERE id = ?`).run(chapterId, storyId);
    insertChoices(chapterId, c.choices, t);
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
    insertChoices(chapterId, input.choices, t);
    return { story_id: parentChapter.story_id, chapter_id: chapterId };
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
    if (!story?.root_chapter_id) throw new PostError("That story does not exist", 404);
    db().prepare(`UPDATE stories SET title = ?, premise = ? WHERE id = ?`).run(input.title, input.premise, storyId);
    return { ok: true as const };
  })();
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
