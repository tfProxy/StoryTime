import { z } from "zod";
import { db, newId } from "./db";
import {
  ENTRY_TYPES,
  FACT_LIMITS,
  FORM_ASPECT,
  entryHistory,
  foldCodex,
  isDraftEntry,
  isFormAspect,
  OVERRIDE_FIELDS,
  overridesFor,
  resolveShared,
  sameAspect,
  sharedFactOps,
  storyEntrySummaries,
  type CodexEntry,
  type CodexOp,
  type FactOp,
  type FoldOptions,
  type OverrideField,
  type Overrides,
  type StoryEntrySummary,
} from "./codex";
import { alwaysIncludedLoad, hintCount, staleAlong, staleInTree } from "./codexHints";
import { getStoryChapters } from "./tree";
import { createSharedEntryFrom, getSharedEntry, loadSharedBases } from "./sharedCodex";
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
  /** On a create: link this shared entry instead of making a plain entry (the other fields are then ignored). */
  shared_entry_id: z.string().min(1).optional(),
};

const checkChange = <T extends z.ZodType<{ op: string; entry_id?: string; name: string }>>(schema: T) =>
  schema
    .refine((v) => v.op === "create" || v.entry_id !== undefined, { message: "entry_id is required for replace and retire" })
    .refine((v) => v.op === "retire" || v.name.length > 0, { message: "name is required" });

export const NewCodexOpSchema = checkChange(
  z.object({ anchor_chapter_id: z.string().min(1), ...changeFields }),
);

const factFields = {
  entry_id: z.string().min(1),
  /** Omit to add a fact (or to set the same aspect again, which updates the live one). Required to retire. */
  fact_id: z.string().min(1).optional(),
  op: z.enum(["set", "retire"]),
  aspect: text(FACT_LIMITS.aspect).default(""),
  form: text(FACT_LIMITS.form).default(""),
  text: text(FACT_LIMITS.text).default(""),
  quote: text(FACT_LIMITS.quote).default(""),
};

const checkFact = <T extends z.ZodType<{ op: string; fact_id?: string; aspect: string; form: string; text: string }>>(schema: T) =>
  schema
    .refine((v) => v.op !== "retire" || v.fact_id !== undefined, { message: "fact_id is required to retire a fact" })
    .refine((v) => v.op !== "set" || (isFormAspect(v.aspect) ? v.form.length > 0 || v.text.length > 0 : v.text.length > 0), {
      message: "text is required",
    });

/**
 * Codex changes sent along with a chapter; they are anchored at that chapter when it is saved. A "create"
 * may carry the draft's local entry id (`draft-…`), so fact changes for that new entry can name it.
 */
export const CodexChangesSchema = z.object({
  codex_changes: z.array(checkChange(z.object(changeFields))).max(50).default([]),
  codex_fact_changes: z.array(checkFact(z.object(factFields))).max(200).default([]),
});

/** Runs `save` (which posts or edits a chapter) and anchors the codex changes at that chapter, all or nothing. */
export function saveWithCodexChanges<R>(input: z.infer<typeof CodexChangesSchema>, save: () => R, anchorOf: (r: R) => string): R {
  return db().transaction(() => {
    const result = save();
    const anchor = anchorOf(result);
    const created = new Map<string, string>();
    for (const c of input.codex_changes) {
      // A shared entry added while writing is linked at the chapter, not copied.
      const op = c.op === "create" && c.shared_entry_id ? linkSharedEntry({ anchor_chapter_id: anchor, shared_entry_id: c.shared_entry_id }) : createCodexOp({ ...c, anchor_chapter_id: anchor });
      if (c.op === "create" && c.entry_id) created.set(c.entry_id, op.entry_id);
    }
    for (const f of input.codex_fact_changes) {
      const entryId = created.get(f.entry_id) ?? f.entry_id;
      if (isDraftEntry(entryId)) throw new PostError("A fact belongs to a new entry that isn't in this chapter's changes", 400);
      createFactOp({ ...f, entry_id: entryId, anchor_chapter_id: anchor });
    }
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
  shared_entry_id: string | null;
  overrides: string | null;
};

function toOp(r: Row): CodexOp {
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(r.aliases);
    if (Array.isArray(parsed)) aliases = parsed.map(String);
  } catch {
    // leave empty
  }
  let overrides: Overrides | null = null;
  try {
    if (r.overrides) overrides = JSON.parse(r.overrides) as Overrides;
  } catch {
    // no overrides
  }
  return { ...r, aliases, always_include: r.always_include === 1, overrides };
}

/** Ops as the fold reads them: a linked (shared) entry's ops carry the base's fields with the story's changes laid over. */
function withSharedBases(ops: CodexOp[]): CodexOp[] {
  const ids = ops.flatMap((o) => (o.shared_entry_id ? [o.shared_entry_id] : []));
  return ids.length ? resolveShared(ops, loadSharedBases(ids)) : ops;
}

/** Ops that apply at a chapter: those anchored on the path from the root to it, in effect order. */
export function getCodexOps(chapterId: string): CodexOp[] {
  const path = getPath(chapterId);
  if (path.length === 0) return [];
  const rows = db()
    .prepare(
      `SELECT o.id, o.anchor_chapter_id, c.depth AS anchor_depth, o.entry_id, o.op, o.name, o.type, o.aliases,
              o.content, o.always_include, o.posted_at, o.shared_entry_id, o.overrides
         FROM codex_ops o JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE o.anchor_chapter_id IN (${path.map(() => "?").join(",")})
        ORDER BY c.depth, o.posted_at, o.rowid`,
    )
    .all(...path.map((c) => c.id)) as Row[];
  return withSharedBases(rows.map(toOp));
}

/** Every op the story has, on any branch, in the order they were written, as the fold reads them (linked entries resolved). */
export function getStoryCodexOps(storyId: string): CodexOp[] {
  const rows = db()
    .prepare(
      `SELECT o.id, o.anchor_chapter_id, c.depth AS anchor_depth, o.entry_id, o.op, o.name, o.type, o.aliases,
              o.content, o.always_include, o.posted_at, o.shared_entry_id, o.overrides
         FROM codex_ops o JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE o.story_id = ?
        ORDER BY o.posted_at, o.rowid`,
    )
    .all(storyId) as Row[];
  return withSharedBases(rows.map(toOp));
}

/** Facts that apply at a chapter: those anchored on the path from the root to it, in effect order. */
export function getCodexFacts(chapterId: string): FactOp[] {
  const path = getPath(chapterId);
  if (path.length === 0) return [];
  const marks = path.map(() => "?").join(",");
  const own = db()
    .prepare(
      `SELECT f.id, f.anchor_chapter_id, c.depth AS anchor_depth, f.entry_id, f.fact_id, f.op, f.aspect, f.form,
              f.text, f.quote, f.posted_at, f.ai_suggestion_id
         FROM codex_facts f JOIN chapters c ON c.id = f.anchor_chapter_id
        WHERE f.anchor_chapter_id IN (${marks})
        ORDER BY c.depth, f.posted_at, f.rowid`,
    )
    .all(...path.map((c) => c.id)) as FactOp[];
  // A linked entry's base facts come first, so the story's own facts on the same ids change or hide them.
  const links = db()
    .prepare(
      `SELECT o.id, o.anchor_chapter_id, c.depth AS anchor_depth, o.entry_id, o.op, o.name, o.type, o.aliases,
              o.content, o.always_include, o.posted_at, o.shared_entry_id, o.overrides
         FROM codex_ops o JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE o.anchor_chapter_id IN (${marks}) AND o.shared_entry_id IS NOT NULL
        ORDER BY c.depth, o.posted_at, o.rowid`,
    )
    .all(...path.map((c) => c.id)) as Row[];
  if (links.length === 0) return own;
  const bases = loadSharedBases(links.map((r) => r.shared_entry_id!));
  return [...sharedFactOps(links.map(toOp), bases), ...own];
}

/**
 * What the Story Bible's codex warns about: how many hints each entry's page shows (the ⚠ count on its card), and the
 * always-included entries when they crowd the prompt. At a chapter, each entry as of that chapter; for the whole story,
 * each entry as of the chapter its card opens at (its page's default), with that chapter's path as the text it is checked against.
 */
export function codexHintsFor(
  storyId: string,
  chapterId: string | null,
  contextTokens: number,
): { counts: Record<string, number>; stale: Record<string, number>; always: ReturnType<typeof alwaysIncludedLoad> } {
  const at = (id: string) => ({ entries: foldCodex(getCodexOps(id), getCodexFacts(id)), path: getPath(id) });
  const counts: Record<string, number> = {};
  let checked: CodexEntry[] = [];
  let shownPath: { id: string; body: string }[] | null = null;
  if (chapterId) {
    const { entries, path } = at(chapterId);
    for (const e of entries) counts[e.entry_id] = hintCount(e, { chapterTexts: path.map((c) => c.body), contextTokens });
    checked = entries;
    shownPath = path;
  } else {
    const byChapter = new Map<string, string[]>();
    for (const s of storyCodexEntries(storyId)) if (!s.retired) byChapter.set(s.last_chapter_id, [...(byChapter.get(s.last_chapter_id) ?? []), s.entry_id]);
    for (const [id, entryIds] of byChapter) {
      const { entries, path } = at(id);
      for (const e of entries.filter((x) => entryIds.includes(x.entry_id))) {
        counts[e.entry_id] = hintCount(e, { chapterTexts: path.map((c) => c.body), contextTokens });
        checked.push(e);
      }
    }
  }

  // Out of date: chapters that mention an entry since it last changed (on the path shown, or the worst branch).
  const changes = entryChangeChapters(storyId);
  const read = new Set(
    (db().prepare(`SELECT k.chapter_id FROM codex_checks k JOIN chapters c ON c.id = k.chapter_id AND c.revision = k.revision WHERE c.story_id = ?`).all(storyId) as { chapter_id: string }[]).map((r) => r.chapter_id),
  );
  const tree = shownPath ? [] : getStoryChapters(storyId);
  const stale: Record<string, number> = {};
  for (const e of checked) {
    const input = { who: e, changes: changes.get(e.entry_id) ?? new Set<string>(), checked: read };
    stale[e.entry_id] = shownPath ? staleAlong(shownPath, input) : staleInTree(tree, input);
  }
  return { counts, stale, always: alwaysIncludedLoad(checked, contextTokens) };
}

/** For each entry of a story, the chapters where it changed: an entry op or a fact op anchored there, on any branch. */
export function entryChangeChapters(storyId: string): Map<string, Set<string>> {
  const changes = new Map<string, Set<string>>();
  const anchors = db()
    .prepare(`SELECT entry_id, anchor_chapter_id FROM codex_ops WHERE story_id = ? UNION SELECT entry_id, anchor_chapter_id FROM codex_facts WHERE story_id = ?`)
    .all(storyId, storyId) as { entry_id: string; anchor_chapter_id: string }[];
  for (const a of anchors) changes.set(a.entry_id, (changes.get(a.entry_id) ?? new Set()).add(a.anchor_chapter_id));
  return changes;
}

/** Every entry in a story, across all branches, one row each. */
export function storyCodexEntries(storyId: string): StoryEntrySummary[] {
  const rows = db()
    .prepare(
      `SELECT o.id, o.anchor_chapter_id, c.depth AS anchor_depth, o.entry_id, o.op, o.name, o.type, o.aliases,
              o.content, o.always_include, o.posted_at, o.shared_entry_id, o.overrides
         FROM codex_ops o JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE c.story_id = ? AND c.trashed_at IS NULL
        ORDER BY c.depth, o.posted_at, o.rowid`,
    )
    .all(storyId) as Row[];
  if (rows.length === 0) return [];
  const titles = db().prepare(`SELECT id, title FROM chapters WHERE story_id = ?`).all(storyId) as { id: string; title: string }[];
  return storyEntrySummaries(withSharedBases(rows.map(toOp)), new Map(titles.map((t) => [t.id, t.title])));
}

export function getCodexState(chapterId: string, options?: FoldOptions): CodexEntry[] {
  return foldCodex(getCodexOps(chapterId), getCodexFacts(chapterId), options);
}

export const NewFactOpSchema = checkFact(z.object({ anchor_chapter_id: z.string().min(1), ...factFields }));

/**
 * Appends a fact change anchored at a chapter. Setting an aspect that is already live on the entry updates that fact.
 * `aiSuggestionId` marks a change the AI applied on its own (never taken from a request).
 */
export function createFactOp(input: z.infer<typeof NewFactOpSchema>, aiSuggestionId: string | null = null): { id: string; fact_id: string } {
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
      // (A fact of a linked entry's shared entry counts: the story changes it for itself under the same id.)
      const ownFact = db().prepare(`SELECT 1 FROM codex_facts WHERE fact_id = ? AND entry_id = ? AND story_id = ?`).get(factId, input.entry_id, anchor.story_id);
      const sharedFact = entry.shared_entry_id && getSharedEntry(entry.shared_entry_id)?.facts.some((f) => f.id === factId);
      if (!ownFact && !sharedFact) throw new PostError("That fact doesn't belong to this entry", 409);
    } else {
      const same = aspect
        ? entry.facts.find((f) => sameAspect(f.aspect, aspect) && (isFormAspect(aspect) || sameAspect(f.form, input.form)))
        : undefined;
      factId = same ? same.fact_id : newId();
    }

    const id = newId();
    db()
      .prepare(
        `INSERT INTO codex_facts (id, story_id, anchor_chapter_id, entry_id, fact_id, op, aspect, form, text, quote, posted_at, ai_suggestion_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, anchor.story_id, anchor.id, input.entry_id, factId, input.op, aspect, input.form, input.text, input.quote, Date.now(), aiSuggestionId);
    return { id, fact_id: factId };
  })();
}

export const ApproveFactsSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

/** The owner approves facts the AI wrote (by fact-change id): they become the owner's, and a new reading leaves them alone. */
export function approveAiFacts(input: z.infer<typeof ApproveFactsSchema>): { approved: number } {
  const marks = input.ids.map(() => "?").join(",");
  const r = db().prepare(`UPDATE codex_facts SET ai_suggestion_id = NULL WHERE id IN (${marks}) AND ai_suggestion_id IS NOT NULL`).run(...input.ids);
  return { approved: r.changes };
}

export const FormChangeSchema = z
  .object({
    /** The chapter whose codex is shown: the entry and its facts are read as they are there. */
    chapter_id: z.string().min(1),
    entry_id: z.string().min(1),
    /** The new form and where it starts. Left out when the writing drawer holds it in the draft (only the moves are saved). */
    form: z.object({ name: text(FACT_LIMITS.form).min(1), stage: text(FACT_LIMITS.text).default(""), anchor_chapter_id: z.string().min(1) }).optional(),
    /** The entry's form until now, for an entry that has never had one: set from where the entry starts, so it is its normal form. */
    base_form: text(FACT_LIMITS.form).default(""),
    /** Every-form facts that are only true of the old form: moved to it, from where each was set. */
    move: z.array(z.string().min(1)).max(200).default([]),
    /** Facts of the new form, set where it starts. */
    add: z.array(z.object({ aspect: text(FACT_LIMITS.aspect).min(1), text: text(FACT_LIMITS.text).min(1) })).max(200).default([]),
  })
  .refine((v) => v.form !== undefined || v.add.length === 0, { message: "facts of a new form need the form" });

/**
 * Changes an entry's form and sorts its facts in one go, all or nothing: names its old form (from where the entry starts,
 * when it never had one), moves the chosen every-form facts to the old form (each at the chapter its current version was
 * set, so they count as the old form's from the start), then sets the new form and its facts from the chosen chapter.
 */
export function changeForm(input: z.infer<typeof FormChangeSchema>): { moved: number } {
  return db().transaction(() => {
    if (getPath(input.chapter_id).length === 0) throw new PostError("That chapter does not exist", 404);
    const ops = getCodexOps(input.chapter_id);
    const entry = foldCodex(ops, getCodexFacts(input.chapter_id)).find((e) => e.entry_id === input.entry_id);
    if (!entry) throw new PostError("That entry doesn't exist at this point in the story", 409);

    let old = entry.form?.name.trim() || entry.baseForm || "";
    if (!old && input.base_form) {
      // The entry's start on this path: its last "create" (an entry removed and added again starts at the new one).
      const start = ops.filter((o) => o.entry_id === entry.entry_id && o.op === "create").at(-1) ?? ops.find((o) => o.entry_id === entry.entry_id)!;
      createFactOp({ anchor_chapter_id: start.anchor_chapter_id, entry_id: entry.entry_id, op: "set", aspect: FORM_ASPECT, form: input.base_form, text: "", quote: "" });
      old = input.base_form;
    }
    if (input.move.length && !old) throw new PostError("Name the form those facts belong to", 400);
    if (input.form && input.move.length && sameAspect(old, input.form.name)) throw new PostError("The facts would move to the form being set", 400);

    for (const id of new Set(input.move)) {
      const f = entry.facts.find((x) => x.fact_id === id && !isFormAspect(x.aspect) && x.form === "");
      if (!f) throw new PostError("That fact isn't an every-form fact of this entry here", 409);
      createFactOp({ anchor_chapter_id: f.op.anchor_chapter_id, entry_id: entry.entry_id, fact_id: id, op: "set", aspect: f.aspect, form: old, text: f.text, quote: f.quote });
    }

    if (input.form) {
      const { name, stage, anchor_chapter_id } = input.form;
      createFactOp({ anchor_chapter_id, entry_id: entry.entry_id, op: "set", aspect: FORM_ASPECT, form: name, text: stage, quote: "" });
      for (const a of input.add) createFactOp({ anchor_chapter_id, entry_id: entry.entry_id, op: "set", aspect: a.aspect, form: name, text: a.text, quote: "" });
    }
    return { moved: new Set(input.move).size };
  })();
}

/**
 * A linked entry reads its details from the shared base, so a plain "replace" can't change them (it would be ignored).
 * A replace that repeats what the entry reads now is fine: bringing it back, or keeping it in the chapters after one.
 */
function assertSharedUnchanged(chapterId: string, entryId: string, input: z.infer<typeof NewCodexOpSchema>) {
  const ops = getCodexOps(chapterId);
  if (!ops.some((o) => o.entry_id === entryId && o.shared_entry_id)) return;
  const last = entryHistory(ops, entryId).at(-1);
  if (!last) return;
  const same =
    last.name === input.name &&
    last.type === input.type &&
    last.content === input.content &&
    last.always_include === input.always_include &&
    last.aliases.join("\n") === input.aliases.join("\n");
  if (!same) throw new PostError("This entry is shared, so its details are changed in the Shared codex, which changes them in every story.", 409);
}

export const LinkSharedSchema = z.object({ anchor_chapter_id: z.string().min(1), shared_entry_id: z.string().min(1) });

/**
 * Adds a shared entry to a story from a chapter on: a "create" op that names the base. From there the entry (and its
 * facts) read from the shared entry, so a change to it reaches every story that links to it.
 */
export function linkSharedEntry(input: z.infer<typeof LinkSharedSchema>): { id: string; entry_id: string } {
  return db().transaction(() => {
    const path = getPath(input.anchor_chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];
    const base = getSharedEntry(input.shared_entry_id);
    if (!base) throw new PostError("That shared entry doesn't exist", 404);
    const live = getCodexState(anchor.id);
    if (live.some((e) => e.shared_entry_id === base.id)) throw new PostError(`“${base.name}” is already in the codex at this point in the story`, 409);
    if (live.some((e) => e.name.trim().toLowerCase() === base.name.trim().toLowerCase())) {
      throw new PostError(`This branch already has an entry called “${base.name}”. Remove or rename it first.`, 409);
    }
    const id = newId();
    const entryId = newId();
    db()
      .prepare(
        `INSERT INTO codex_ops (id, story_id, anchor_chapter_id, entry_id, op, name, type, aliases, content, always_include, posted_at, shared_entry_id)
         VALUES (?, ?, ?, ?, 'create', ?, ?, ?, ?, ?, ?, ?)`,
      )
      // The columns keep the base as it is now; the fold reads the live base (see `resolveShared`).
      .run(id, anchor.story_id, anchor.id, entryId, base.name, base.type, JSON.stringify(base.aliases), base.content, base.always_include ? 1 : 0, Date.now(), base.id);
    return { id, entry_id: entryId };
  })();
}

export const OverrideSharedSchema = z
  .object({
    anchor_chapter_id: z.string().min(1),
    entry_id: z.string().min(1),
    type: z.enum(ENTRY_TYPES).optional(),
    content: text(CODEX_LIMITS.content).optional(),
    always_include: z.boolean().optional(),
    aliases: z.array(text(CODEX_LIMITS.alias).min(1)).max(CODEX_LIMITS.aliases).optional(),
    /** Fields to take back from the shared entry. */
    reset: z.array(z.enum(OVERRIDE_FIELDS)).max(OVERRIDE_FIELDS.length).optional(),
  })
  .refine((v) => [v.type, v.content, v.always_include, v.aliases, v.reset].some((x) => x !== undefined), { message: "nothing to change" });

/** The shared entry a linked entry reads from, and whether the entry is live at the chapter; throws when it isn't linked. */
function linkedBase(chapterId: string, entryId: string) {
  const ops = getCodexOps(chapterId);
  const sharedId = ops.find((o) => o.entry_id === entryId && o.shared_entry_id)?.shared_entry_id;
  const base = sharedId ? getSharedEntry(sharedId) : null;
  if (!base) throw new PostError("That entry isn't linked to a shared entry", 409);
  const entry = foldCodex(ops).find((e) => e.entry_id === entryId);
  if (!entry) throw new PostError("That entry doesn't exist at this point in the story", 409);
  return { base, entry };
}

/**
 * Changes a linked entry's type, notes, keywords or "always include" for this story only, from a chapter on (a field
 * that matches the shared entry again is taken back from it). The name and the shared entry itself are not touched.
 */
export function overrideSharedEntry(input: z.infer<typeof OverrideSharedSchema>): { id: string } {
  return db().transaction(() => {
    const path = getPath(input.anchor_chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];
    const { base, entry } = linkedBase(anchor.id, input.entry_id);
    const reset = new Set(input.reset ?? []);
    const want = {
      type: input.type,
      content: input.content,
      always_include: input.always_include,
      aliases: input.aliases,
    };
    const patch = overridesFor(base, want);
    const resets = new Set<OverrideField>([...(patch.reset ?? []), ...reset]);
    // A field given and also reset: the reset wins.
    for (const f of reset) {
      if (f === "aliases") {
        delete patch.aliases_add;
        delete patch.aliases_remove;
      } else delete patch[f];
    }
    patch.reset = [...resets];
    if (patch.reset.length === 0) delete patch.reset;
    // The columns keep what the entry will read; the fold takes the fields from the shared entry and these overrides.
    const next = {
      type: reset.has("type") ? base.type : (input.type ?? entry.type),
      content: reset.has("content") ? base.content : (input.content ?? entry.content),
      always_include: reset.has("always_include") ? base.always_include : (input.always_include ?? entry.always_include),
      aliases: reset.has("aliases") ? base.aliases : (input.aliases ?? entry.aliases),
    };
    const id = newId();
    db()
      .prepare(
        `INSERT INTO codex_ops (id, story_id, anchor_chapter_id, entry_id, op, name, type, aliases, content, always_include, posted_at, shared_entry_id, overrides)
         VALUES (?, ?, ?, ?, 'replace', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, anchor.story_id, anchor.id, input.entry_id, base.name, next.type, JSON.stringify(next.aliases), next.content, next.always_include ? 1 : 0, Date.now(), base.id, JSON.stringify(patch));
    return { id };
  })();
}

export const ResetSharedFactSchema = z.object({ anchor_chapter_id: z.string().min(1), entry_id: z.string().min(1), fact_id: z.string().min(1) });

/**
 * Takes this story's changes to a shared entry's fact back: its versions anchored on the way to this chapter are
 * dropped, so the fact reads as the shared entry has it (also when this story hid it).
 */
export function resetSharedFact(input: z.infer<typeof ResetSharedFactSchema>): { reset: number } {
  return db().transaction(() => {
    const path = getPath(input.anchor_chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];
    const { base } = linkedBase(anchor.id, input.entry_id);
    if (!base.facts.some((f) => f.id === input.fact_id)) throw new PostError("That isn't a fact of the shared entry", 409);
    const r = db()
      .prepare(`DELETE FROM codex_facts WHERE story_id = ? AND entry_id = ? AND fact_id = ? AND anchor_chapter_id IN (${path.map(() => "?").join(",")})`)
      .run(anchor.story_id, input.entry_id, input.fact_id, ...path.map((c) => c.id));
    return { reset: r.changes };
  })();
}

export const ShareEntrySchema = z.object({ anchor_chapter_id: z.string().min(1), entry_id: z.string().min(1) });

/**
 * Turns a story's own entry into a shared one: the entry as it reads at this chapter (and its facts) becomes the
 * shared entry, and the story's entry is linked to it. What the entry's earlier and later ops said that differs from
 * that becomes this story's overrides, so the story reads the same as before.
 */
export function shareEntry(input: z.infer<typeof ShareEntrySchema>): { shared_entry_id: string } {
  return db().transaction(() => {
    const path = getPath(input.anchor_chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];
    const entry = getCodexState(anchor.id).find((e) => e.entry_id === input.entry_id);
    if (!entry) throw new PostError("That entry doesn't exist at this point in the story", 409);
    if (entry.shared_entry_id) throw new PostError("That entry is already shared", 409);
    const base = createSharedEntryFrom(
      { name: entry.name, type: entry.type, aliases: entry.aliases, content: entry.content, always_include: entry.always_include },
      entry.facts.map((f) => ({ fact_id: f.fact_id, aspect: f.aspect, form: f.form, text: f.text })),
    );
    const rows = db().prepare(`SELECT id, op, name, type, aliases, content, always_include FROM codex_ops WHERE story_id = ? AND entry_id = ?`).all(anchor.story_id, input.entry_id) as Row[];
    const update = db().prepare(`UPDATE codex_ops SET shared_entry_id = ?, overrides = ? WHERE id = ?`);
    for (const r of rows) {
      const o = toOp(r);
      // The name stays the shared entry's; a retire carries nothing.
      const patch = o.op === "retire" ? null : overridesFor(base, { type: o.type, content: o.content, always_include: o.always_include, aliases: o.aliases });
      update.run(base.id, patch ? JSON.stringify(patch) : null, r.id);
    }
    return { shared_entry_id: base.id };
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
      if (input.op === "replace") assertSharedUnchanged(anchor.id, entryId, input);
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
    .prepare(`SELECT anchor_chapter_id FROM codex_ops WHERE story_id = ? AND entry_id = ? AND op != 'retire' AND anchor_chapter_id NOT IN (SELECT id FROM chapters WHERE trashed_at IS NOT NULL) ORDER BY posted_at DESC, rowid DESC LIMIT 1`)
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
