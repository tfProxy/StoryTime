import { z } from "zod";
import { db, newId } from "./db";
import { ENTRY_TYPES, FACT_LIMITS, OVERRIDE_FIELDS } from "./codex";
import { CODEX_LIMITS } from "./codexDb";
import { SHARED_LIMITS } from "./sharedCodex";
import { LIMITS } from "./limits";
import { checkImage, IMAGE_MAX_BYTES, PostError } from "./stories";
import { IMAGE_SLOTS } from "./imageSlots";

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
  original: z.boolean().optional(),
});

// A story's own changes to a linked entry (see Overrides in ./codex).
const Overrides = z.object({
  type: z.enum(ENTRY_TYPES).optional(),
  content: str(CODEX_LIMITS.content).optional(),
  always_include: z.boolean().optional(),
  aliases_add: z.array(str(CODEX_LIMITS.alias)).max(CODEX_LIMITS.aliases).optional(),
  aliases_remove: z.array(str(CODEX_LIMITS.alias)).max(CODEX_LIMITS.aliases).optional(),
  reset: z.array(z.enum(OVERRIDE_FIELDS)).optional(),
});

const SharedFact = z.object({
  id,
  aspect: str(FACT_LIMITS.aspect).default(""),
  form: str(FACT_LIMITS.form).default(""),
  text: str(FACT_LIMITS.text).default(""),
});

const SharedEntry = z.object({
  id,
  name: str(SHARED_LIMITS.name).min(1),
  type: z.enum(ENTRY_TYPES).default("note"),
  aliases: z.array(str(SHARED_LIMITS.alias)).max(SHARED_LIMITS.aliases).default([]),
  content: str(SHARED_LIMITS.content).default(""),
  always_include: z.boolean().default(false),
  facts: z.array(SharedFact).max(SHARED_LIMITS.facts).default([]),
});

const CodexOp = z.object({
  // Set when the op belongs to an entry linked to the shared codex; exports made before it have neither.
  shared_entry_id: id.nullish(),
  overrides: Overrides.nullish(),
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

const CodexFact = z.object({
  anchor_chapter_id: id,
  entry_id: id,
  fact_id: id,
  op: z.enum(["set", "retire"]),
  aspect: str(FACT_LIMITS.aspect).default(""),
  form: str(FACT_LIMITS.form).default(""),
  text: str(FACT_LIMITS.text).default(""),
  quote: str(FACT_LIMITS.quote).default(""),
  posted_at: time,
  // Set on a fact the AI applied that the owner hasn't approved. Suggestions aren't exported, so it is only a mark here.
  ai_suggestion_id: id.nullish(),
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

// A picture is at most IMAGE_MAX_BYTES (4 MB), which is about 5.6 million base64 characters.
const IMAGE_MAX_BASE64 = Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 4;
const Image = z.object({
  chapter_id: id,
  slot: z.enum(IMAGE_SLOTS),
  type: z.string().max(100),
  data: z.string().min(1).max(IMAGE_MAX_BASE64),
  // Exports made before pictures remembered their prompts have none.
  prompt: nullableStr(LIMITS.picturePrompt),
  negative: nullableStr(LIMITS.picturePrompt),
});

export const ImportSchema = z.object({
  format: z.literal("storytime-export", { error: "This isn't a StoryTime export file" }),
  version: z.number().int().min(1).max(2, { error: "This export was made by a newer version of StoryTime" }),
  story: z.object({
    title: str(LIMITS.title).min(1),
    premise: str(LIMITS.premise).default(""),
    // Exports made before style notes have none.
    style: str(LIMITS.style).default(""),
    // Exports made before picture prompts have no art style.
    art_style: str(LIMITS.artStyle).default(""),
    // ...and before picture settings were the story's, no prompt style or checkpoint.
    image_prompt_style: z.enum(["tags", "natural"]).nullable().default(null),
    checkpoint: str(LIMITS.label).default(""),
      created_at: time,
  }),
  chapters: z.array(Chapter).min(1).max(5000),
  choices: z.array(Choice).max(60000).default([]),
  codex: z.array(CodexOp).max(20000).default([]),
  // Exports made before codex facts have none.
  codex_facts: z.array(CodexFact).max(50000).default([]),
  // Exports made before shared codex entries have none.
  shared_entries: z.array(SharedEntry).max(5000).default([]),
  // Version 1 exports have no revision history.
  revisions: z.array(Revision).max(20000).default([]),
  // Exports made before chapter pictures have none.
  images: z.array(Image).max(2 * 5000).default([]),
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
  for (const f of input.codex_facts) {
    if (!chaptersById.has(f.anchor_chapter_id)) throw new PostError("A codex fact is attached to a chapter that isn't in the file", 400);
  }
  const seenRevisions = new Set<string>();
  for (const r of input.revisions) {
    const live = chaptersById.get(r.chapter_id);
    if (!live) throw new PostError("A chapter revision belongs to a chapter that isn't in the file", 400);
    const key = `${r.chapter_id}:${r.revision}`;
    if (seenRevisions.has(key) || r.revision >= live.revision) throw new PostError("The chapter revision history is inconsistent", 400);
    seenRevisions.add(key);
  }
  // Decode and check every picture before anything is written.
  const seenImages = new Set<string>();
  const pictures = input.images.map((img) => {
    if (!chaptersById.has(img.chapter_id)) throw new PostError("A picture belongs to a chapter that isn't in the file", 400);
    const key = `${img.chapter_id}:${img.slot}`;
    if (seenImages.has(key)) throw new PostError("The file has two pictures for the same place in a chapter", 400);
    seenImages.add(key);
    const bytes = Buffer.from(img.data, "base64");
    try {
      return {
        chapter_id: img.chapter_id, slot: img.slot, bytes, type: checkImage(bytes, "picture"),
        prompt: img.prompt ?? null, negative: img.negative ?? null,
      };
    } catch (e) {
      if (e instanceof PostError) throw new PostError("A picture in the file isn't a PNG, JPEG, GIF or WebP image, or is over 4 MB", 400);
      throw e;
    }
  });

  const storyId = newId();
  const chapterIds = new Map<string, string>();
  const choiceIds = new Map<string, string>();
  for (const c of input.chapters) chapterIds.set(c.id, newId());
  for (const c of input.choices) choiceIds.set(c.id, newId());

  return db().transaction(() => {
    db()
      .prepare(`INSERT INTO stories (id, title, premise, style, art_style, image_prompt_style, checkpoint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        storyId, input.story.title, input.story.premise, input.story.style, input.story.art_style,
        input.story.image_prompt_style, input.story.checkpoint, input.story.created_at,
      );

    const insertChapter = db().prepare(
      `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, summary, path_summary, posted_at,
                             revision, edited_at, edit_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertChoice = db().prepare(
      `INSERT INTO choices (id, parent_chapter_id, label, posted_at, original) VALUES (?, ?, ?, ?, ?)`,
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
        insertChoice.run(choiceIds.get(ch.id), chapterIds.get(c.id), ch.label, ch.posted_at, ch.original ? 1 : 0);
        const child = childOf.get(ch.id);
        if (child) visit(chaptersById.get(child)!, depth + 1);
      }
    };
    visit(roots[0], 0);
    if (placed.size !== input.chapters.length) throw new PostError("Some chapters in the file can't be reached from the first chapter", 400);

    const rootId = chapterIds.get(roots[0].id)!;
    db().prepare(`UPDATE stories SET root_chapter_id = ? WHERE id = ?`).run(rootId, storyId);

    // Shared entries: one the database already has is used as it is (the owner's current base wins over the
    // file's); one it lacks is made with the file's id and fact ids, so the story's changes to those facts still apply.
    const known = new Set<string>();
    const hasEntry = db().prepare(`SELECT 1 FROM shared_entries WHERE id = ?`);
    const hasFact = db().prepare(`SELECT 1 FROM shared_facts WHERE id = ?`);
    const insertShared = db().prepare(
      `INSERT INTO shared_entries (id, name, type, aliases, content, always_include, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSharedFact = db().prepare(
      `INSERT INTO shared_facts (id, shared_entry_id, aspect, form, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const s of input.shared_entries) {
      if (known.has(s.id)) continue;
      if (!hasEntry.get(s.id)) {
        insertShared.run(s.id, s.name, s.type, JSON.stringify(s.aliases), s.content, s.always_include ? 1 : 0, now, now);
        s.facts.forEach((f, i) => {
          if (hasFact.get(f.id)) throw new PostError(`A fact of the shared entry “${s.name}” clashes with one already in the codex library`, 400);
          insertSharedFact.run(f.id, s.id, f.aspect, f.form, f.text, now + i);
        });
      }
      known.add(s.id);
    }

    const insertOp = db().prepare(
      `INSERT INTO codex_ops (id, story_id, anchor_chapter_id, entry_id, op, name, type, aliases, content, always_include, posted_at,
                              shared_entry_id, overrides)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const o of input.codex) {
      // A link to a shared entry that is neither in the file nor here becomes a plain entry.
      const shared = o.shared_entry_id && (known.has(o.shared_entry_id) || hasEntry.get(o.shared_entry_id)) ? o.shared_entry_id : null;
      insertOp.run(
        newId(), storyId, chapterIds.get(o.anchor_chapter_id), o.entry_id, o.op, o.name, o.type,
        JSON.stringify(o.aliases), o.content, o.always_include ? 1 : 0, o.posted_at,
        shared, shared && o.overrides ? JSON.stringify(o.overrides) : null,
      );
    }

    const insertFact = db().prepare(
      `INSERT INTO codex_facts (id, story_id, anchor_chapter_id, entry_id, fact_id, op, aspect, form, text, quote, posted_at, ai_suggestion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const f of input.codex_facts) {
      insertFact.run(
        newId(), storyId, chapterIds.get(f.anchor_chapter_id), f.entry_id, f.fact_id, f.op, f.aspect, f.form, f.text,
        f.quote, f.posted_at, f.ai_suggestion_id ?? null,
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
    const insertImage = db().prepare(
      `INSERT INTO chapter_images (chapter_id, slot, image, type, updated_at, prompt, negative) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of pictures) insertImage.run(chapterIds.get(p.chapter_id), p.slot, p.bytes, p.type, Date.now(), p.prompt, p.negative);
    return { story_id: storyId, chapter_id: rootId, chapters: input.chapters.length };
  })();
}
