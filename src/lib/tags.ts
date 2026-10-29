import { z } from "zod";
import { db, newId } from "./db";
import { PostError } from "./stories";

// A shared library of tag definitions (set up in Settings), switched on per story. The AI suggests event
// tags on chapters; the author approves or rejects them.

const text = (max: number) => z.string().trim().max(max);

export const TAG_LIMITS = { name: 60, rule: 2000, choice: 40, choices: 12, example: 1000, note: 500, examples: 40, quote: 1000, reason: 1000 };

export const TagExampleSchema = z.object({
  text: text(TAG_LIMITS.example).min(1),
  applies: z.boolean(),
  note: text(TAG_LIMITS.note).optional(),
});
export type TagExample = z.infer<typeof TagExampleSchema>;

const tagFields = {
  name: text(TAG_LIMITS.name).min(1),
  applies: text(TAG_LIMITS.rule),
  not_applies: text(TAG_LIMITS.rule),
  kind: z.enum(["event", "state"]),
  choices: z.array(text(TAG_LIMITS.choice).min(1)).max(TAG_LIMITS.choices),
  examples: z.array(TagExampleSchema).max(TAG_LIMITS.examples),
  show_readers: z.boolean(),
};

export const NewTagSchema = z.object({
  name: tagFields.name,
  applies: tagFields.applies.default(""),
  not_applies: tagFields.not_applies.default(""),
  kind: tagFields.kind.default("event"),
  choices: tagFields.choices.default([]),
  examples: tagFields.examples.default([]),
  show_readers: tagFields.show_readers.default(false),
});
export const UpdateTagSchema = z.object(tagFields).partial();

export type Tag = {
  id: string;
  name: string;
  applies: string;
  not_applies: string;
  kind: "event" | "state";
  choices: string[];
  examples: TagExample[];
  /** Readers see the tag in the notes under each choice (if content notes are on). */
  show_readers: boolean;
  created_at: number;
};

type TagRow = Omit<Tag, "choices" | "examples" | "show_readers"> & { choices: string; examples: string; show_readers: number };

function parseList<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const TAG_COLUMNS = `id, name, applies, not_applies, kind, choices, examples, show_readers, created_at`;

function toTag(r: TagRow): Tag {
  return { ...r, choices: parseList<string>(r.choices), examples: parseList<TagExample>(r.examples), show_readers: r.show_readers === 1 };
}

function liveTag(id: string): Tag | undefined {
  const r = db().prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE id = ? AND removed_at IS NULL`).get(id) as TagRow | undefined;
  return r && toTag(r);
}

function needTag(id: string): Tag {
  const t = liveTag(id);
  if (!t) throw new PostError("That tag does not exist", 404);
  return t;
}

function checkNameFree(name: string, exceptId?: string) {
  const clash = db()
    .prepare(`SELECT id FROM tags WHERE removed_at IS NULL AND lower(name) = lower(?) AND id <> ?`)
    .get(name, exceptId ?? "");
  if (clash) throw new PostError("There is already a tag with that name", 400);
}

/** Live tags, by name. */
export function listTags(): Tag[] {
  const rows = db().prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE removed_at IS NULL ORDER BY lower(name), created_at`).all() as TagRow[];
  return rows.map(toTag);
}

export function createTag(input: z.infer<typeof NewTagSchema>): Tag {
  return db().transaction(() => {
    checkNameFree(input.name);
    const id = newId();
    db()
      .prepare(
        `INSERT INTO tags (id, name, applies, not_applies, kind, choices, examples, show_readers, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.applies, input.not_applies, input.kind, JSON.stringify(input.choices), JSON.stringify(input.examples), input.show_readers ? 1 : 0, Date.now());
    return needTag(id);
  })();
}

export function updateTag(id: string, input: z.infer<typeof UpdateTagSchema>): Tag {
  return db().transaction(() => {
    const tag = needTag(id);
    if (input.name !== undefined) checkNameFree(input.name, id);
    const next = { ...tag, ...input };
    // A changed rule means chapters should be checked for the tag again: forget the checks that included it.
    if (next.applies !== tag.applies || next.not_applies !== tag.not_applies || JSON.stringify(next.choices) !== JSON.stringify(tag.choices)) {
      db().prepare(`DELETE FROM chapter_tag_checks WHERE EXISTS (SELECT 1 FROM json_each(tag_ids) WHERE value = ?)`).run(id);
    }
    db()
      .prepare(`UPDATE tags SET name = ?, applies = ?, not_applies = ?, kind = ?, choices = ?, examples = ?, show_readers = ? WHERE id = ?`)
      .run(next.name, next.applies, next.not_applies, next.kind, JSON.stringify(next.choices), JSON.stringify(next.examples), next.show_readers ? 1 : 0, id);
    return needTag(id);
  })();
}

/** Removes a tag from the library. Its chapter tags stay in the database but are hidden. */
export function removeTag(id: string): void {
  needTag(id);
  db().prepare(`UPDATE tags SET removed_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function addTagExample(id: string, example: TagExample): Tag {
  return db().transaction(() => {
    const tag = needTag(id);
    if (tag.examples.length >= TAG_LIMITS.examples) throw new PostError("This tag has too many examples", 400);
    db().prepare(`UPDATE tags SET examples = ? WHERE id = ?`).run(JSON.stringify([...tag.examples, example]), id);
    return needTag(id);
  })();
}

/** Ids of the live tags that are on for a story: all of them, except those the author switched off. */
export function storyTags(storyId: string): string[] {
  const off = new Set(
    (db().prepare(`SELECT tag_id FROM story_tags WHERE story_id = ? AND enabled = 0`).all(storyId) as { tag_id: string }[]).map((r) => r.tag_id),
  );
  return listTags()
    .filter((t) => !off.has(t.id))
    .map((t) => t.id);
}

export function setStoryTag(storyId: string, tagId: string, on: boolean): void {
  db().transaction(() => {
    if (!db().prepare(`SELECT 1 FROM stories WHERE id = ?`).get(storyId)) throw new PostError("That story does not exist", 404);
    needTag(tagId);
    db()
      .prepare(`INSERT INTO story_tags (story_id, tag_id, enabled) VALUES (?, ?, ?) ON CONFLICT (story_id, tag_id) DO UPDATE SET enabled = excluded.enabled`)
      .run(storyId, tagId, on ? 1 : 0);
  })();
}

/** A chapter's story has not switched the tag off. */
const TAG_ON = `NOT EXISTS (SELECT 1 FROM story_tags st WHERE st.story_id = c.story_id AND st.tag_id = ct.tag_id AND st.enabled = 0)`;

export type ChapterTag = {
  id: string;
  chapter_id: string;
  chapter_title: string;
  tag_id: string;
  tag_name: string;
  value: string | null;
  status: "suggested" | "approved" | "rejected";
  source: "ai" | "author";
  quote: string;
  reason: string;
  revision: number;
  /** Made from an older revision than the chapter's current one. */
  stale: boolean;
};

const CHAPTER_TAG_SELECT = `SELECT ct.id, ct.chapter_id, c.title AS chapter_title, ct.tag_id, t.name AS tag_name, ct.value,
       ct.status, ct.source, ct.quote, ct.reason, ct.revision, (ct.revision < c.revision) AS stale
  FROM chapter_tags ct
  JOIN chapters c ON c.id = ct.chapter_id AND ${TAG_ON}
  JOIN tags t ON t.id = ct.tag_id AND t.removed_at IS NULL`;

type ChapterTagRow = Omit<ChapterTag, "stale"> & { stale: number };
const toChapterTag = (r: ChapterTagRow): ChapterTag => ({ ...r, stale: r.stale === 1 });

/** Chapter tags of a story (only live tags that are switched on for it), by chapter depth and posting time, then tag name. */
export function chapterTags(storyId: string, opts: { chapterId?: string } = {}): ChapterTag[] {
  const where = opts.chapterId ? ` AND ct.chapter_id = ?` : "";
  const rows = db()
    .prepare(`${CHAPTER_TAG_SELECT} WHERE c.story_id = ? AND c.trashed_at IS NULL${where} ORDER BY c.depth, c.posted_at, lower(t.name)`)
    .all(...(opts.chapterId ? [storyId, opts.chapterId] : [storyId])) as ChapterTagRow[];
  return rows.map(toChapterTag);
}

/** The names of the tags each chapter has approved (not suggested or rejected), keyed by chapter id, in chapterTags' order. */
export function appliedTagNames(storyId: string, chapterId?: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const t of chapterTags(storyId, { chapterId })) {
    if (t.status === "approved") names.set(t.chapter_id, [...(names.get(t.chapter_id) ?? []), t.tag_name]);
  }
  return names;
}

function chapterTagRow(id: string): ChapterTag | undefined {
  const r = db().prepare(`${CHAPTER_TAG_SELECT} WHERE ct.id = ?`).get(id) as ChapterTagRow | undefined;
  return r && toChapterTag(r);
}

function getChapterInfo(chapterId: string): { story_id: string; revision: number } {
  const c = db().prepare(`SELECT story_id, revision FROM chapters WHERE id = ?`).get(chapterId) as { story_id: string; revision: number } | undefined;
  if (!c) throw new PostError("That chapter does not exist", 404);
  return c;
}

/** A value must be one of the tag's choices; a tag without choices has no value. */
function cleanValue(tag: Tag, value: string | null | undefined, strict: boolean): string | null {
  const v = value?.trim() || null;
  if (v === null) return null;
  if (tag.choices.includes(v)) return v;
  if (strict) throw new PostError(`"${v}" is not one of this tag's values`, 400);
  return null;
}

export const SuggestTagsSchema = z.object({
  /** The chapter revision the AI read. */
  revision: z.number().int().min(1),
  /** The tags the AI was asked about; its earlier, undecided suggestions for them are dropped unless it suggests them again. */
  checked_tag_ids: z.array(z.string().min(1)).max(200).default([]),
  suggestions: z
    .array(
      z.object({
        tag_id: z.string().min(1),
        value: text(TAG_LIMITS.choice).nullable().default(null),
        quote: text(TAG_LIMITS.quote).default(""),
        reason: text(TAG_LIMITS.reason).default(""),
      }),
    )
    .max(200),
});

export function suggestTags(chapterId: string, revision: number, suggestions: z.infer<typeof SuggestTagsSchema>["suggestions"], checkedTagIds: string[] = []): { added: number; kept: number } {
  return db().transaction(() => {
    const chapter = getChapterInfo(chapterId);
    if (chapter.revision !== revision) throw new PostError("The chapter was edited meanwhile", 409);
    const enabled = new Set(storyTags(chapter.story_id));
    const tags = new Map(listTags().map((t) => [t.id, t]));
    const existing = new Map(
      (db().prepare(`SELECT id, tag_id, status, revision FROM chapter_tags WHERE chapter_id = ?`).all(chapterId) as { id: string; tag_id: string; status: string; revision: number }[]).map((r) => [r.tag_id, r]),
    );
    const now = Date.now();
    const raised = new Set<string>();
    let added = 0;
    let kept = 0;
    for (const s of suggestions) {
      const tag = tags.get(s.tag_id);
      if (!tag || !enabled.has(s.tag_id)) continue;
      const row = existing.get(s.tag_id);
      if (row && (row.status === "approved" || (row.status === "rejected" && row.revision === revision))) {
        kept++;
        continue;
      }
      const value = cleanValue(tag, s.value, false);
      raised.add(s.tag_id);
      if (row) {
        db()
          .prepare(`UPDATE chapter_tags SET value = ?, status = 'suggested', source = 'ai', quote = ?, reason = ?, revision = ?, created_at = ?, decided_at = NULL WHERE id = ?`)
          .run(value, s.quote, s.reason, revision, now, row.id);
      } else {
        db()
          .prepare(
            `INSERT INTO chapter_tags (id, chapter_id, tag_id, value, status, source, quote, reason, revision, created_at)
             VALUES (?, ?, ?, ?, 'suggested', 'ai', ?, ?, ?, ?)`,
          )
          .run(newId(), chapterId, s.tag_id, value, s.quote, s.reason, revision, now);
      }
      added++;
    }
    for (const tagId of new Set(checkedTagIds)) {
      const row = existing.get(tagId);
      if (row && row.status === "suggested" && !raised.has(tagId)) db().prepare(`DELETE FROM chapter_tags WHERE id = ?`).run(row.id);
    }
    db()
      .prepare(
        `INSERT INTO chapter_tag_checks (chapter_id, revision, tag_ids, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (chapter_id) DO UPDATE SET revision = excluded.revision, tag_ids = excluded.tag_ids, checked_at = excluded.checked_at`,
      )
      .run(chapterId, revision, JSON.stringify([...new Set(checkedTagIds)]), now);
    return { added, kept };
  })();
}

/** The tag ids each chapter of a story was last checked for, at the chapter's current revision, keyed by chapter id. */
export function checkedTagIdsByChapter(storyId: string): Map<string, string[]> {
  const rows = db()
    .prepare(
      `SELECT k.chapter_id, k.tag_ids FROM chapter_tag_checks k JOIN chapters c ON c.id = k.chapter_id
        WHERE c.story_id = ? AND c.trashed_at IS NULL AND k.revision = c.revision`,
    )
    .all(storyId) as { chapter_id: string; tag_ids: string }[];
  return new Map(rows.map((r) => [r.chapter_id, JSON.parse(r.tag_ids) as string[]]));
}

/**
 * The tag ids already decided for each chapter of a story at its current revision, keyed by chapter id: approved tags,
 * tags rejected at the current revision, and the tags the AI last checked the chapter for. Find tags leaves a chapter
 * out when every tag that is on for the story is in its list.
 */
export function decidedTagIdsByChapter(storyId: string): Map<string, string[]> {
  const revisionOf = new Map(
    (db().prepare(`SELECT id, revision FROM chapters WHERE story_id = ?`).all(storyId) as { id: string; revision: number }[]).map((r) => [r.id, r.revision]),
  );
  const decided = new Map<string, string[]>();
  for (const t of chapterTags(storyId)) {
    if (t.status === "approved" || (t.status === "rejected" && t.revision === revisionOf.get(t.chapter_id))) {
      decided.set(t.chapter_id, [...(decided.get(t.chapter_id) ?? []), t.tag_id]);
    }
  }
  for (const [chapterId, tagIds] of checkedTagIdsByChapter(storyId)) {
    const have = decided.get(chapterId) ?? [];
    decided.set(chapterId, [...have, ...tagIds.filter((tid) => !have.includes(tid))]);
  }
  return decided;
}

export const DecideChapterTagSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  value: text(TAG_LIMITS.choice).nullable().optional(),
  /** On a rejection: remember the quote as an example of where the tag does not apply. */
  add_example: z.boolean().optional(),
});

export function decideChapterTag(id: string, input: z.infer<typeof DecideChapterTagSchema>): ChapterTag {
  return db().transaction(() => {
    const ct = chapterTagRow(id);
    if (!ct) throw new PostError("That chapter tag does not exist", 404);
    const tag = needTag(ct.tag_id);
    const value = input.value === undefined ? ct.value : cleanValue(tag, input.value, true);
    db().prepare(`UPDATE chapter_tags SET status = ?, value = ?, decided_at = ? WHERE id = ?`).run(input.status, value, Date.now(), id);
    if (input.status === "rejected" && input.add_example && ct.quote) {
      addTagExample(tag.id, { text: ct.quote, applies: false, ...(ct.reason ? { note: ct.reason } : {}) });
    }
    return chapterTagRow(id)!;
  })();
}

export const AddChapterTagSchema = z.object({
  tag_id: z.string().min(1),
  value: text(TAG_LIMITS.choice).nullable().default(null),
});

/** The author tags a chapter by hand: approved at once. */
export function addChapterTag(chapterId: string, tagId: string, value: string | null): ChapterTag {
  return db().transaction(() => {
    const chapter = getChapterInfo(chapterId);
    const tag = needTag(tagId);
    if (!storyTags(chapter.story_id).includes(tagId)) throw new PostError("That tag is not switched on for this story", 400);
    const v = cleanValue(tag, value, true);
    const now = Date.now();
    const row = db().prepare(`SELECT id FROM chapter_tags WHERE chapter_id = ? AND tag_id = ?`).get(chapterId, tagId) as { id: string } | undefined;
    let id: string;
    if (row) {
      id = row.id;
      db()
        .prepare(`UPDATE chapter_tags SET value = ?, status = 'approved', source = 'author', revision = ?, created_at = ?, decided_at = ? WHERE id = ?`)
        .run(v, chapter.revision, now, now, id);
    } else {
      id = newId();
      db()
        .prepare(
          `INSERT INTO chapter_tags (id, chapter_id, tag_id, value, status, source, revision, created_at, decided_at)
           VALUES (?, ?, ?, ?, 'approved', 'author', ?, ?, ?)`,
        )
        .run(id, chapterId, tagId, v, chapter.revision, now, now);
    }
    return chapterTagRow(id)!;
  })();
}

export function removeChapterTag(id: string): void {
  if (db().prepare(`DELETE FROM chapter_tags WHERE id = ?`).run(id).changes === 0) throw new PostError("That chapter tag does not exist", 404);
}

/** How many suggestions wait for a decision, by chapter (for the outline marker). */
export function pendingTagCounts(storyId: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT ct.chapter_id, COUNT(*) AS n
         FROM chapter_tags ct
         JOIN chapters c ON c.id = ct.chapter_id AND ${TAG_ON}
         JOIN tags t ON t.id = ct.tag_id AND t.removed_at IS NULL
        WHERE c.story_id = ? AND c.trashed_at IS NULL AND ct.status = 'suggested'
        GROUP BY ct.chapter_id`,
    )
    .all(storyId) as { chapter_id: string; n: number }[];
  return new Map(rows.map((r) => [r.chapter_id, r.n]));
}
