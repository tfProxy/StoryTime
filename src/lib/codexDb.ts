import { z } from "zod";
import { db, newId } from "./db";
import {
  ENTRY_TYPES,
  FACT_LIMITS,
  FORM_ASPECT,
  foldCodex,
  isFormAspect,
  sameAspect,
  storyEntrySummaries,
  type CodexEntry,
  type CodexOp,
  type FactOp,
  type FoldOptions,
  type StoryEntrySummary,
} from "./codex";
import { getChoices, getPath, PostError } from "./stories";

const text = (max: number) => z.string().trim().max(max);

export const CODEX_LIMITS = { name: 100, content: 8000, alias: 60, aliases: 10 };

const changeFields = {
  op: z.enum(["create", "replace", "retire"]),
  /** Required for replace and retire; ignored for create (the server assigns one). */
  entry_id: z.string().min(1).optional(),
  name: text(CODEX_LIMITS.name).default(""),
  type: z.enum(ENTRY_TYPES).default("note"),
  aliases: z.array(text(CODEX_LIMITS.alias).min(1)).max(CODEX_LIMITS.aliases).default([]),
  content: text(CODEX_LIMITS.content).default(""),
  always_include: z.boolean().default(false),
};

const checkChange = <T extends z.ZodType<{ op: string; entry_id?: string; name: string }>>(schema: T) =>
  schema
    .refine((v) => v.op === "create" || v.entry_id !== undefined, { message: "entry_id is required for replace and retire" })
    .refine((v) => v.op === "retire" || v.name.length > 0, { message: "name is required" });

export const NewCodexOpSchema = checkChange(
  z.object({ anchor_chapter_id: z.string().min(1), ...changeFields }),
);

/** Codex changes sent along with a chapter; they are anchored at that chapter when it is saved. */
export const CodexChangesSchema = z.object({
  codex_changes: z.array(checkChange(z.object(changeFields))).max(50).default([]),
});

/** Runs `save` (which posts or edits a chapter) and anchors the codex changes at that chapter, all or nothing. */
export function saveWithCodexChanges<R>(
  changes: z.infer<typeof CodexChangesSchema>["codex_changes"],
  save: () => R,
  anchorOf: (r: R) => string,
): R {
  return db().transaction(() => {
    const result = save();
    for (const c of changes) createCodexOp({ ...c, anchor_chapter_id: anchorOf(result) });
    return result;
  })();
}

type Row = {
  id: string;
  anchor_chapter_id: string;
  anchor_depth: number;
  entry_id: string;
  op: CodexOp["op"];
  name: string;
  type: CodexOp["type"];
  aliases: string;
  content: string;
  always_include: number;
  posted_at: number;
};

function toOp(r: Row): CodexOp {
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(r.aliases);
    if (Array.isArray(parsed)) aliases = parsed.map(String);
  } catch {
    // leave empty
  }
  return { ...r, aliases, always_include: r.always_include === 1 };
}

/** Ops that apply at a chapter: those anchored on the path from the root to it, in effect order. */
export function getCodexOps(chapterId: string): CodexOp[] {
  const path = getPath(chapterId);
  if (path.length === 0) return [];
  const rows = db()
    .prepare(
      `SELECT o.id, o.anchor_chapter_id, c.depth AS anchor_depth, o.entry_id, o.op, o.name, o.type, o.aliases,
              o.content, o.always_include, o.posted_at
         FROM codex_ops o JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE o.anchor_chapter_id IN (${path.map(() => "?").join(",")})
        ORDER BY c.depth, o.posted_at, o.rowid`,
    )
    .all(...path.map((c) => c.id)) as Row[];
  return rows.map(toOp);
}

/** Facts that apply at a chapter: those anchored on the path from the root to it, in effect order. */
export function getCodexFacts(chapterId: string): FactOp[] {
  const path = getPath(chapterId);
  if (path.length === 0) return [];
  return db()
    .prepare(
      `SELECT f.id, f.anchor_chapter_id, c.depth AS anchor_depth, f.entry_id, f.fact_id, f.op, f.aspect, f.form,
              f.text, f.quote, f.posted_at
         FROM codex_facts f JOIN chapters c ON c.id = f.anchor_chapter_id
        WHERE f.anchor_chapter_id IN (${path.map(() => "?").join(",")})
        ORDER BY c.depth, f.posted_at, f.rowid`,
    )
    .all(...path.map((c) => c.id)) as FactOp[];
}

/** Every entry in a story, across all branches, one row each. */
export function storyCodexEntries(storyId: string): StoryEntrySummary[] {
  const rows = db()
    .prepare(
      `SELECT o.id, o.anchor_chapter_id, c.depth AS anchor_depth, o.entry_id, o.op, o.name, o.type, o.aliases,
              o.content, o.always_include, o.posted_at
         FROM codex_ops o JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE c.story_id = ?
        ORDER BY c.depth, o.posted_at, o.rowid`,
    )
    .all(storyId) as Row[];
  if (rows.length === 0) return [];
  const titles = db().prepare(`SELECT id, title FROM chapters WHERE story_id = ?`).all(storyId) as { id: string; title: string }[];
  return storyEntrySummaries(rows.map(toOp), new Map(titles.map((t) => [t.id, t.title])));
}

export function getCodexState(chapterId: string, options?: FoldOptions): CodexEntry[] {
  return foldCodex(getCodexOps(chapterId), getCodexFacts(chapterId), options);
}

export const NewFactOpSchema = z
  .object({
    anchor_chapter_id: z.string().min(1),
    entry_id: z.string().min(1),
    /** Omit to add a fact (or to set the same aspect again, which updates the live one). Required to retire. */
    fact_id: z.string().min(1).optional(),
    op: z.enum(["set", "retire"]),
    aspect: text(FACT_LIMITS.aspect).default(""),
    form: text(FACT_LIMITS.form).default(""),
    text: text(FACT_LIMITS.text).default(""),
    quote: text(FACT_LIMITS.quote).default(""),
  })
  .refine((v) => v.op !== "retire" || v.fact_id !== undefined, { message: "fact_id is required to retire a fact" })
  .refine((v) => v.op !== "set" || (isFormAspect(v.aspect) ? v.form.length > 0 || v.text.length > 0 : v.text.length > 0), {
    message: "text is required",
  });

/** Appends a fact change anchored at a chapter. Setting an aspect that is already live on the entry updates that fact. */
export function createFactOp(input: z.infer<typeof NewFactOpSchema>): { id: string; fact_id: string } {
  return db().transaction(() => {
    const path = getPath(input.anchor_chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];

    const entry = foldCodex(getCodexOps(anchor.id), getCodexFacts(anchor.id)).find((e) => e.entry_id === input.entry_id);
    if (!entry) throw new PostError("That entry doesn't exist at this point in the story", 409);

    const aspect = isFormAspect(input.aspect) ? FORM_ASPECT : input.aspect;
    let factId: string;
    if (input.op === "retire") {
      factId = input.fact_id!;
      if (!entry.facts.some((f) => f.fact_id === factId)) throw new PostError("That fact doesn't exist at this point in the story", 409);
    } else if (input.fact_id !== undefined) {
      factId = input.fact_id;
      // A retired fact may be set again, but only on the entry it belongs to.
      if (!db().prepare(`SELECT 1 FROM codex_facts WHERE fact_id = ? AND entry_id = ? AND story_id = ?`).get(factId, input.entry_id, anchor.story_id)) {
        throw new PostError("That fact doesn't belong to this entry", 409);
      }
    } else {
      const same = aspect
        ? entry.facts.find((f) => sameAspect(f.aspect, aspect) && (isFormAspect(aspect) || sameAspect(f.form, input.form)))
        : undefined;
      factId = same ? same.fact_id : newId();
    }

    const id = newId();
    db()
      .prepare(
        `INSERT INTO codex_facts (id, story_id, anchor_chapter_id, entry_id, fact_id, op, aspect, form, text, quote, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, anchor.story_id, anchor.id, input.entry_id, factId, input.op, aspect, input.form, input.text, input.quote, Date.now());
    return { id, fact_id: factId };
  })();
}

export function createCodexOp(input: z.infer<typeof NewCodexOpSchema>): { id: string; entry_id: string } {
  return db().transaction(() => {
    const path = getPath(input.anchor_chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];

    let entryId: string;
    if (input.op === "create") {
      entryId = newId();
    } else {
      entryId = input.entry_id!;
      if (input.op === "retire" && !foldCodex(getCodexOps(anchor.id)).some((e) => e.entry_id === entryId)) {
        throw new PostError("That entry doesn't exist at this point in the story", 409);
      }
    }

    const id = newId();
    db()
      .prepare(
        `INSERT INTO codex_ops (id, story_id, anchor_chapter_id, entry_id, op, name, type, aliases, content, always_include, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        anchor.story_id,
        anchor.id,
        entryId,
        input.op,
        input.name,
        input.type,
        JSON.stringify(input.aliases),
        input.content,
        input.always_include ? 1 : 0,
        Date.now(),
      );
    return { id, entry_id: entryId };
  })();
}

/**
 * Takes an entry out of one chapter only: it is retired at the chapter and brought back, unchanged, at each chapter
 * written after it, so the chapters below keep it (with its facts). For an entry added a chapter too early.
 */
export function removeEntryAtChapter(input: { entry_id: string; chapter_id: string }): { retired: string; kept_in: string[] } {
  return db().transaction(() => {
    const path = getPath(input.chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];
    const entry = getCodexState(anchor.id).find((e) => e.entry_id === input.entry_id);
    if (!entry) throw new PostError("That entry doesn't exist at this point in the story", 409);
    const fields = { name: entry.name, type: entry.type, aliases: entry.aliases, content: entry.content, always_include: entry.always_include };
    const retired = createCodexOp({ anchor_chapter_id: anchor.id, op: "retire", entry_id: entry.entry_id, ...fields });
    const children = getChoices(anchor.id).flatMap((c) => (c.child_chapter_id ? [c.child_chapter_id] : []));
    for (const child of children) createCodexOp({ anchor_chapter_id: child, op: "replace", entry_id: entry.entry_id, ...fields });
    return { retired: retired.id, kept_in: children };
  })();
}

export const RemoveEntryAtChapterSchema = z.object({ entry_id: z.string().min(1), chapter_id: z.string().min(1) });

/** The codex in the shape the AI prompt builder takes. */
export function getContextCodex(chapterId: string | null) {
  if (!chapterId) return [];
  return getCodexState(chapterId, { recentAnchor: chapterId }).map((e) => ({
    id: e.entry_id,
    name: e.name,
    type: e.type,
    aliases: e.aliases,
    content: e.description,
    always_include: e.always_include,
  }));
}

/**
 * A codex entry as it reads at a chapter; with no chapter (or when the entry isn't live there), as it was last
 * written on any branch. Null when the story has no such entry.
 */
export function codexEntryAt(storyId: string, entryId: string, chapterId: string | null): { name: string; type: CodexEntry["type"]; aliases: string[]; content: string } | null {
  const asDescribed = (e: CodexEntry) => ({ name: e.name, type: e.type, aliases: e.aliases, content: e.description });
  const live = chapterId ? getCodexState(chapterId).find((e) => e.entry_id === entryId) : undefined;
  if (live) return asDescribed(live);
  const row = db()
    .prepare(`SELECT name, type, aliases, content, anchor_chapter_id FROM codex_ops WHERE story_id = ? AND entry_id = ? AND op != 'retire' ORDER BY posted_at DESC, rowid DESC LIMIT 1`)
    .get(storyId, entryId) as { name: string; type: CodexEntry["type"]; aliases: string; content: string; anchor_chapter_id: string } | undefined;
  if (!row) return null;
  // As it read where it was last written, facts included, if it is live there.
  const there = getCodexState(row.anchor_chapter_id).find((e) => e.entry_id === entryId);
  if (there) return asDescribed(there);
  return { name: row.name, type: row.type, aliases: JSON.parse(row.aliases) as string[], content: row.content };
}

/** The chapter where an entry was last written (the anchor of its latest op that isn't a retirement); null if it has none. */
export function entryLastAnchor(storyId: string, entryId: string): string | null {
  const row = db()
    .prepare(`SELECT anchor_chapter_id FROM codex_ops WHERE story_id = ? AND entry_id = ? AND op != 'retire' ORDER BY posted_at DESC, rowid DESC LIMIT 1`)
    .get(storyId, entryId) as { anchor_chapter_id: string } | undefined;
  return row?.anchor_chapter_id ?? null;
}

/** The latest name of each of these codex entries (any branch) and its story's title, by entry id; entries that don't exist are left out. */
export function codexEntryLabels(entryIds: string[]): Record<string, { name: string; story_title: string }> {
  if (entryIds.length === 0) return {};
  const rows = db()
    .prepare(
      `SELECT o.entry_id, o.name, s.title AS story_title FROM codex_ops o JOIN stories s ON s.id = o.story_id
        WHERE o.entry_id IN (${entryIds.map(() => "?").join(",")}) AND o.op != 'retire' ORDER BY o.posted_at, o.rowid`,
    )
    .all(...entryIds) as { entry_id: string; name: string; story_title: string }[];
  return Object.fromEntries(rows.map((r) => [r.entry_id, { name: r.name, story_title: r.story_title }]));
}
