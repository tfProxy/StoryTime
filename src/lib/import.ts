import { z } from "zod";
import { db, newId } from "./db";
import { ENTRY_TYPES } from "./codex";
import { CODEX_LIMITS } from "./codexDb";
import { LIMITS } from "./limits";
import { PostError } from "./stories";

// Brings back a story from the "everything" JSON export (see toJson in ./export). The story gets
// fresh ids, so importing never overwrites anything, and importing twice makes two copies.

const str = (max: number) => z.string().max(max);
const nullableStr = (max: number) => z.string().max(max).nullish();
const time = z.number().int().nonnegative();
const id = z.string().min(1).max(100);

const Chapter = z.object({
  id,
  parent_choice_id: id.nullable(),
  title: str(LIMITS.title).min(1),
  body: str(LIMITS.body).min(1),
  summary: nullableStr(LIMITS.summary),
  path_summary: nullableStr(LIMITS.summary),
  posted_at: time,
  edited_at: time.nullish(),
  edit_note: nullableStr(LIMITS.label),
  revision: z.number().int().min(1).default(1),
});

const Choice = z.object({
  id,
  parent_chapter_id: id,
  label: str(LIMITS.label).min(1),
  posted_at: time,
});

const CodexOp = z.object({
  anchor_chapter_id: id,
  entry_id: id,
  op: z.enum(["create", "replace", "retire"]),
  name: str(CODEX_LIMITS.name).default(""),
  type: z.enum(ENTRY_TYPES).default("note"),
  aliases: z.array(str(CODEX_LIMITS.alias)).max(CODEX_LIMITS.aliases).default([]),
  content: str(CODEX_LIMITS.content).default(""),
  always_include: z.boolean().default(false),
  posted_at: time,
});

const Revision = z.object({
  chapter_id: id,
  revision: z.number().int().min(1),
  title: str(LIMITS.title),
  body: str(LIMITS.body),
  summary: nullableStr(LIMITS.summary),
  path_summary: nullableStr(LIMITS.summary),
  edit_note: nullableStr(LIMITS.label),
  created_at: time,
});

export const ImportSchema = z.object({
  format: z.literal("storytime-export", { error: "This isn't a StoryTime export file" }),
  version: z.number().int().min(1).max(2, { error: "This export was made by a newer version of StoryTime" }),
  story: z.object({
    title: str(LIMITS.title).min(1),
    premise: str(LIMITS.premise).default(""),
    // Exports made before style notes have none.
    style: str(LIMITS.style).default(""),
      created_at: time,
  }),
  chapters: z.array(Chapter).min(1).max(5000),
  choices: z.array(Choice).max(60000).default([]),
  codex: z.array(CodexOp).max(20000).default([]),
  // Version 1 exports have no revision history.
  revisions: z.array(Revision).max(20000).default([]),
});

export type ImportInput = z.infer<typeof ImportSchema>;

export function importStory(input: ImportInput): { story_id: string; chapter_id: string; chapters: number } {
  const chaptersById = new Map(input.chapters.map((c) => [c.id, c]));
  if (chaptersById.size !== input.chapters.length) throw new PostError("The file has two chapters with the same id", 400);
  const choicesById = new Map(input.choices.map((c) => [c.id, c]));
  if (choicesById.size !== input.choices.length) throw new PostError("The file has two choices with the same id", 400);

  const roots = input.chapters.filter((c) => c.parent_choice_id === null);
  if (roots.length !== 1) throw new PostError("The file must have exactly one first chapter", 400);
  const choicesByParent = new Map<string, typeof input.choices>();
  for (const ch of input.choices) {
    if (!chaptersById.has(ch.parent_chapter_id)) throw new PostError(`Choice "${ch.label}" belongs to a chapter that isn't in the file`, 400);
    choicesByParent.set(ch.parent_chapter_id, [...(choicesByParent.get(ch.parent_chapter_id) ?? []), ch]);
  }
  const childOf = new Map<string, string>(); // choice id -> chapter id
  for (const c of input.chapters) {
    if (c.parent_choice_id === null) continue;
    if (!choicesById.has(c.parent_choice_id)) throw new PostError(`Chapter "${c.title}" follows a choice that isn't in the file`, 400);
    if (childOf.has(c.parent_choice_id)) throw new PostError("Two chapters follow the same choice", 400);
    childOf.set(c.parent_choice_id, c.id);
  }
  for (const [parent, list] of choicesByParent) {
    if (list.length > LIMITS.choices) throw new PostError(`Chapter "${chaptersById.get(parent)!.title}" has too many choices`, 400);
  }
  for (const o of input.codex) {
    if (!chaptersById.has(o.anchor_chapter_id)) throw new PostError("A codex change is attached to a chapter that isn't in the file", 400);
  }
  const seenRevisions = new Set<string>();
  for (const r of input.revisions) {
    const live = chaptersById.get(r.chapter_id);
    if (!live) throw new PostError("A chapter revision belongs to a chapter that isn't in the file", 400);
    const key = `${r.chapter_id}:${r.revision}`;
    if (seenRevisions.has(key) || r.revision >= live.revision) throw new PostError("The chapter revision history is inconsistent", 400);
    seenRevisions.add(key);
  }

  const storyId = newId();
  const chapterIds = new Map<string, string>();
  const choiceIds = new Map<string, string>();
  for (const c of input.chapters) chapterIds.set(c.id, newId());
  for (const c of input.choices) choiceIds.set(c.id, newId());

  return db().transaction(() => {
    db()
      .prepare(`INSERT INTO stories (id, title, premise, style, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(storyId, input.story.title, input.story.premise, input.story.style, input.story.created_at);

    const insertChapter = db().prepare(
      `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, summary, path_summary, posted_at,
                             revision, edited_at, edit_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertChoice = db().prepare(
      `INSERT INTO choices (id, parent_chapter_id, label, posted_at) VALUES (?, ?, ?, ?)`,
    );

    // Parents before children (a chapter points at a choice, a choice at its chapter), so walk
    // down from the first chapter; this also recomputes depths and drops anything unreachable.
    const placed = new Set<string>();
    const visit = (c: (typeof input.chapters)[number], depth: number) => {
      if (placed.has(c.id)) throw new PostError("The chapters in the file loop back on themselves", 400);
      placed.add(c.id);
      insertChapter.run(
        chapterIds.get(c.id), storyId, c.parent_choice_id === null ? null : choiceIds.get(c.parent_choice_id), depth,
        c.title, c.body, c.summary ?? null, c.path_summary ?? null, c.posted_at,
        c.revision, c.edited_at ?? null, c.edit_note ?? null,
      );
      for (const ch of choicesByParent.get(c.id) ?? []) {
        insertChoice.run(choiceIds.get(ch.id), chapterIds.get(c.id), ch.label, ch.posted_at);
        const child = childOf.get(ch.id);
        if (child) visit(chaptersById.get(child)!, depth + 1);
      }
    };
    visit(roots[0], 0);
    if (placed.size !== input.chapters.length) throw new PostError("Some chapters in the file can't be reached from the first chapter", 400);

    const rootId = chapterIds.get(roots[0].id)!;
    db().prepare(`UPDATE stories SET root_chapter_id = ? WHERE id = ?`).run(rootId, storyId);

    const insertOp = db().prepare(
      `INSERT INTO codex_ops (id, story_id, anchor_chapter_id, entry_id, op, name, type, aliases, content, always_include, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const o of input.codex) {
      insertOp.run(
        newId(), storyId, chapterIds.get(o.anchor_chapter_id), o.entry_id, o.op, o.name, o.type,
        JSON.stringify(o.aliases), o.content, o.always_include ? 1 : 0, o.posted_at,
      );
    }

    const insertRevision = db().prepare(
      `INSERT INTO chapter_revisions (id, chapter_id, revision, title, body, summary, path_summary, edit_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of input.revisions) {
      insertRevision.run(
        newId(), chapterIds.get(r.chapter_id), r.revision, r.title, r.body, r.summary ?? null, r.path_summary ?? null,
        r.edit_note ?? null, r.created_at,
      );
    }
    return { story_id: storyId, chapter_id: rootId, chapters: input.chapters.length };
  })();
}
