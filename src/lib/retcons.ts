// Retcons: the owner changes a detail from a chapter on, as if it had always been so, and the AI reads the chapters
// below for passages that no longer fit. Two kinds: "codex" changes one codex fact (in place, where it was set, or as a
// new version from the chosen chapter) and "note" is a change described in words. Either way a review run (check
// "retcon", one task per chapter) leaves proposed replacements in retcon_changes; nothing in a chapter changes until the
// owner accepts it. Undo puts back the chapters (those not edited since) and the codex fact.
import { z } from "zod";
import { db, newId } from "./db";
import { foldCodex, FACT_LIMITS, type CodexEntry, type LiveFact } from "./codex";
import { createFactOp, getCodexFacts, getCodexOps } from "./codexDb";
import { mentions } from "./ai/prompts";
import { applyEdits, findPassage, type RetconEdit } from "./retconText";
import { LIMITS } from "./limits";
import { editChapter, getChapter, getStory, PostError } from "./stories";
import { getStoryChapters, type StoryChapter } from "./tree";

export const RETCON_INSTRUCTION_MAX = 2000;

const id = z.string().min(1).max(100);

export const NewRetconSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("codex"),
    /** The chapter the fact is viewed at. */
    chapter_id: id,
    entry_id: id,
    fact_id: id,
    /** The fact's new text. */
    text: z.string().trim().min(1).max(FACT_LIMITS.text),
    /** "set": change the fact where it was set (every chapter since then); "here": from `chapter_id` on. */
    from: z.enum(["set", "here"]),
    /** Read every chapter in scope, not just those that name the entry. */
    all: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("note"),
    chapter_id: id,
    instruction: z.string().trim().min(1).max(RETCON_INSTRUCTION_MAX),
    /** Read only chapters with one of these words or names (comma-separated); every chapter below when empty. */
    only: z.string().trim().max(500).default(""),
  }),
]);
export type NewRetcon = z.input<typeof NewRetconSchema>;

type Brief = { id: string; title: string };
const brief = (c: { id: string; title: string }): Brief => ({ id: c.id, title: c.title });

export type RetconPreview = {
  /** The chapter the retcon starts from: where the fact was set, or the chapter chosen. */
  start: Brief;
  /** The chapters the AI will read, in story order. */
  chapters: Brief[];
  /** Chapters below where the fact is changed again: they and everything below them are left alone. */
  stops: Brief[];
  /** For a codex retcon: where the fact was set, and its text now. */
  setAt?: Brief;
  before?: string;
  /** For a codex retcon: whether "where it was set" is possible (not for a fact from the shared codex). */
  canSet?: boolean;
  entryName?: string;
  /** The chapters in scope that the filter left out (they don't name the entry or the words). */
  skipped: number;
};

function factAt(chapterId: string, entryId: string, factId: string): { entry: CodexEntry; fact: LiveFact } {
  const entry = foldCodex(getCodexOps(chapterId), getCodexFacts(chapterId)).find((e) => e.entry_id === entryId);
  if (!entry) throw new PostError("That entry isn't in the codex at this chapter", 404);
  const fact = entry.facts.find((f) => f.fact_id === factId);
  if (!fact) throw new PostError("That fact isn't in the codex at this chapter", 404);
  return { entry, fact };
}

const ownRow = (opId: string) => !!db().prepare(`SELECT 1 FROM codex_facts WHERE id = ?`).get(opId);

/** Chapters below (and including) `rootId`, leaving out `stopAt` chapters and everything below them. */
function subtree(chapters: StoryChapter[], rootId: string, stopAt: Set<string>): { inside: StoryChapter[]; stops: StoryChapter[] } {
  const inside = new Set<string>();
  const stops: StoryChapter[] = [];
  for (const c of chapters) {
    // getStoryChapters lists parents before children.
    if (c.id === rootId) inside.add(c.id);
    else if (c.parent_id && inside.has(c.parent_id)) {
      if (stopAt.has(c.id)) stops.push(c);
      else inside.add(c.id);
    }
  }
  return { inside: chapters.filter((c) => inside.has(c.id)), stops };
}

const words = (only: string) =>
  only
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

/** What a retcon would read, without changing anything. */
export function previewRetcon(storyId: string, raw: NewRetcon): RetconPreview {
  const input = NewRetconSchema.parse(raw);
  const chapter = getChapter(input.chapter_id);
  if (!chapter || chapter.story_id !== storyId) throw new PostError("That chapter is not in this story", 404);
  if (chapter.trashed_at !== null) throw new PostError("That chapter is in the trash", 409);
  const chapters = getStoryChapters(storyId);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  if (input.kind === "codex") {
    const { entry, fact } = factAt(input.chapter_id, input.entry_id, input.fact_id);
    const canSet = ownRow(fact.op.id);
    const setAt = byId.get(fact.op.anchor_chapter_id) ?? byId.get(input.chapter_id)!;
    const rootId = input.from === "set" && canSet ? setAt.id : input.chapter_id;
    // A later version of the fact (set or removed) below the start is a change the story makes: stop there.
    const later = db().prepare(`SELECT DISTINCT anchor_chapter_id AS id FROM codex_facts WHERE story_id = ? AND fact_id = ? AND id != ?`).all(storyId, fact.fact_id, fact.op.id) as { id: string }[];
    const { inside, stops } = subtree(chapters, rootId, new Set(later.map((r) => r.id)));
    const named = input.all ? inside : inside.filter((c) => mentions(entry, c.body));
    return {
      start: brief(byId.get(rootId)!),
      chapters: named.map(brief),
      stops: stops.map(brief),
      setAt: brief(setAt),
      before: fact.text,
      canSet,
      entryName: entry.name,
      skipped: inside.length - named.length,
    };
  }
  const { inside } = subtree(chapters, input.chapter_id, new Set());
  const only = words(input.only);
  const picked = only.length ? inside.filter((c) => mentions({ name: only[0], aliases: only.slice(1), type: "note", content: "", always_include: false },`${c.title}\n${c.body}`)) : inside;
  return { start: brief(byId.get(input.chapter_id)!), chapters: picked.map(brief), stops: [], skipped: inside.length - picked.length };
}

type CodexUndo = { kind: "edit"; id: string; before: string } | { kind: "add"; id: string };

type RetconRow = {
  id: string;
  story_id: string;
  chapter_id: string;
  kind: "codex" | "note";
  entry_id: string | null;
  title: string;
  instruction: string;
  codex: string | null;
  chapter_ids: string;
  run_id: string | null;
  created_at: number;
  undone_at: number | null;
};

function retconRow(retconId: string): RetconRow {
  const row = db().prepare(`SELECT * FROM retcons WHERE id = ?`).get(retconId) as RetconRow | undefined;
  if (!row) throw new PostError("That retcon does not exist", 404);
  return row;
}

/**
 * Starts a retcon: makes the codex change (for a codex retcon) and records what to read. The caller makes the run
 * (`retconRunOptions`) and sets it with `setRetconRun`.
 */
export function createRetcon(storyId: string, raw: NewRetcon): { id: string; preview: RetconPreview } {
  if (!getStory(storyId)) throw new PostError("That story does not exist", 404);
  const input = NewRetconSchema.parse(raw);
  return db().transaction(() => {
    const preview = previewRetcon(storyId, input);
    if (preview.chapters.length > LIMITS.runTasks) throw new PostError(`A retcon can read at most ${LIMITS.runTasks} chapters`, 400);
    let title: string;
    let instruction: string;
    let codex: CodexUndo | null = null;
    if (input.kind === "codex") {
      const { entry, fact } = factAt(input.chapter_id, input.entry_id, input.fact_id);
      if (fact.text.trim() === input.text.trim()) throw new PostError("The new text is the same as the fact's text now", 400);
      const what = `${entry.name}, ${fact.aspect.trim() || "a detail"}${fact.form.trim() ? ` (in ${fact.form.trim()} form)` : ""}`;
      title = `${entry.name}: ${fact.aspect.trim() || "a fact"}`;
      instruction = `${what}\nNow: ${input.text}\nBefore: ${fact.text}\nTreat the new version as always having been true.`;
      // Where it was set, or set at this very chapter: change that version. Otherwise a new version from this chapter on.
      const inPlace = ownRow(fact.op.id) && (input.from === "set" || fact.op.anchor_chapter_id === input.chapter_id);
      if (inPlace) {
        db().prepare(`UPDATE codex_facts SET text = ? WHERE id = ?`).run(input.text, fact.op.id);
        codex = { kind: "edit", id: fact.op.id, before: fact.text };
      } else {
        const added = createFactOp({ anchor_chapter_id: input.chapter_id, entry_id: entry.entry_id, op: "set", aspect: fact.aspect, form: fact.form, text: input.text, quote: "", fact_id: fact.fact_id });
        codex = { kind: "add", id: added.id };
      }
    } else {
      instruction = input.instruction;
      title = input.instruction.replace(/\s+/g, " ").slice(0, 80) + (input.instruction.length > 80 ? "…" : "");
    }
    const retconId = newId();
    db()
      .prepare(
        `INSERT INTO retcons (id, story_id, chapter_id, kind, entry_id, title, instruction, codex, chapter_ids, run_id, created_at, undone_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(retconId, storyId, preview.start.id, input.kind, input.kind === "codex" ? input.entry_id : null, title, instruction, codex ? JSON.stringify(codex) : null, JSON.stringify(preview.chapters.map((c) => c.id)), Date.now());
    return { id: retconId, preview };
  })();
}

export function setRetconRun(retconId: string, runId: string) {
  db().prepare(`UPDATE retcons SET run_id = ? WHERE id = ?`).run(runId, retconId);
}

/** The chapters a retcon's run reads (still in the story, in story order) with their revisions now. */
export function retconChapters(retconId: string): StoryChapter[] {
  const row = retconRow(retconId);
  const wanted = new Set(JSON.parse(row.chapter_ids) as string[]);
  return getStoryChapters(row.story_id).filter((c) => wanted.has(c.id));
}

/** What the run needs to read a chapter for the retcon. */
export function getRetcon(retconId: string): { id: string; story_id: string; title: string; instruction: string; undone: boolean } {
  const row = retconRow(retconId);
  return { id: row.id, story_id: row.story_id, title: row.title, instruction: row.instruction, undone: row.undone_at !== null };
}

export const ProposalSchema = z.object({
  chapter_id: id,
  revision: z.number().int().min(1),
  edits: z.array(z.object({ old: z.string().min(1).max(5000), new: z.string().max(5000) })).max(50),
  note: z.string().max(2000).default(""),
});

/** Saves what the AI proposes for one chapter. Edits whose passage isn't in the chapter are dropped. 409 when the chapter was edited since it was read. */
export function saveProposal(retconId: string, input: z.infer<typeof ProposalSchema>): { saved: number } {
  return db().transaction(() => {
    const row = retconRow(retconId);
    if (row.undone_at !== null) throw new PostError("That retcon was undone", 409);
    const chapter = getChapter(input.chapter_id);
    if (!chapter || chapter.story_id !== row.story_id) throw new PostError("That chapter is not in this story", 404);
    if (chapter.revision !== input.revision) throw new PostError("The chapter was edited meanwhile", 409);
    const texts = [chapter.body, chapter.summary ?? ""];
    const edits: RetconEdit[] = [];
    for (const e of input.edits) {
      const found = texts.map((t) => findPassage(e.old, t)).find((p): p is string => p !== null);
      if (found && found !== e.new && !edits.some((x) => x.old === found)) edits.push({ old: found, new: e.new });
    }
    const note = input.note.trim();
    const existing = db().prepare(`SELECT status FROM retcon_changes WHERE retcon_id = ? AND chapter_id = ?`).get(retconId, input.chapter_id) as { status: string } | undefined;
    if (existing && existing.status !== "open") return { saved: 0 };
    if (edits.length === 0 && !note) {
      db().prepare(`DELETE FROM retcon_changes WHERE retcon_id = ? AND chapter_id = ?`).run(retconId, input.chapter_id);
      return { saved: 0 };
    }
    db()
      .prepare(
        `INSERT INTO retcon_changes (id, retcon_id, chapter_id, revision, edits, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
         ON CONFLICT (retcon_id, chapter_id) DO UPDATE SET revision = excluded.revision, edits = excluded.edits, note = excluded.note, created_at = excluded.created_at`,
      )
      .run(newId(), retconId, input.chapter_id, input.revision, JSON.stringify(edits), note, Date.now());
    return { saved: edits.length };
  })();
}

export type RetconChangeView = {
  id: string;
  chapter_id: string;
  chapter_title: string;
  edits: RetconEdit[];
  note: string;
  status: "open" | "applied" | "skipped" | "undone";
  /** Open: the chapter was edited since the AI read it. Applied: edited since the change was made (Undo leaves it). */
  edited_since: boolean;
  /** The chapter has pictures, which may show the old detail. */
  has_pictures: boolean;
};

export type RetconView = {
  id: string;
  kind: "codex" | "note";
  title: string;
  instruction: string;
  chapter_id: string;
  chapter_title: string;
  entry_id: string | null;
  run_id: string | null;
  reads: number;
  created_at: number;
  undone_at: number | null;
  changes: RetconChangeView[];
};

/** A story's retcons, newest first, with their proposed changes in story order. */
export function listRetcons(storyId: string): RetconView[] {
  const rows = db().prepare(`SELECT * FROM retcons WHERE story_id = ? ORDER BY created_at DESC, rowid DESC`).all(storyId) as RetconRow[];
  if (rows.length === 0) return [];
  const chapters = db().prepare(`SELECT id, title, revision, depth, posted_at FROM chapters WHERE story_id = ?`).all(storyId) as { id: string; title: string; revision: number; depth: number; posted_at: number }[];
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const pictured = new Set((db().prepare(`SELECT DISTINCT i.chapter_id AS id FROM chapter_images i JOIN chapters c ON c.id = i.chapter_id WHERE c.story_id = ?`).all(storyId) as { id: string }[]).map((r) => r.id));
  const changes = db()
    .prepare(`SELECT x.* FROM retcon_changes x JOIN retcons r ON r.id = x.retcon_id WHERE r.story_id = ?`)
    .all(storyId) as { id: string; retcon_id: string; chapter_id: string; revision: number; edits: string; note: string; status: RetconChangeView["status"]; applied_revision: number | null }[];
  const order = (cid: string) => {
    const c = byId.get(cid);
    return c ? [c.depth, c.posted_at] : [Infinity, 0];
  };
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    instruction: r.instruction,
    chapter_id: r.chapter_id,
    chapter_title: byId.get(r.chapter_id)?.title ?? "A chapter",
    entry_id: r.entry_id,
    run_id: r.run_id,
    reads: (JSON.parse(r.chapter_ids) as string[]).length,
    created_at: r.created_at,
    undone_at: r.undone_at,
    changes: changes
      .filter((x) => x.retcon_id === r.id && byId.has(x.chapter_id))
      .sort((a, b) => {
        const [da, pa] = order(a.chapter_id);
        const [dbb, pb] = order(b.chapter_id);
        return da - dbb || pa - pb;
      })
      .map((x) => {
        const c = byId.get(x.chapter_id)!;
        return {
          id: x.id,
          chapter_id: x.chapter_id,
          chapter_title: c.title,
          edits: JSON.parse(x.edits) as RetconEdit[],
          note: x.note,
          status: x.status,
          edited_since: x.status === "open" ? c.revision !== x.revision : x.status === "applied" ? c.revision !== x.applied_revision : false,
          has_pictures: pictured.has(x.chapter_id),
        };
      }),
  }));
}

type ChangeRow = { id: string; retcon_id: string; chapter_id: string; revision: number; edits: string; status: string; before_body: string | null; before_summary: string | null; applied_revision: number | null };

function changeRow(changeId: string): ChangeRow {
  const row = db().prepare(`SELECT * FROM retcon_changes WHERE id = ?`).get(changeId) as ChangeRow | undefined;
  if (!row) throw new PostError("That change does not exist", 404);
  return row;
}

/** Saves new text for a chapter as an ordinary edit (kept as a revision), leaving its title, choices and path summary as they are. */
function rewrite(chapterId: string, body: string, summary: string | null, note: string): number {
  const chapter = getChapter(chapterId)!;
  const { revision } = editChapter(chapterId, {
    base_revision: chapter.revision,
    title: chapter.title,
    body,
    summary,
    path_summary: chapter.path_summary,
    edit_note: note.slice(0, LIMITS.label),
    rename_choices: [],
    remove_choices: [],
    add_choices: [],
  });
  // A wording fix doesn't need a new summary: don't list it as out of date.
  if (summary === chapter.summary && body !== chapter.body) {
    db()
      .prepare(
        `INSERT INTO review_items (id, chapter_id, kind, fingerprint, status, revision, note, decided_at) VALUES (?, ?, 'summary-stale', '', 'dismissed', ?, NULL, ?)
         ON CONFLICT (chapter_id, kind, fingerprint) DO UPDATE SET status = 'dismissed', revision = excluded.revision, note = NULL, decided_at = excluded.decided_at`,
      )
      .run(newId(), chapterId, revision, Date.now());
  }
  return revision;
}

export const ApplyChangeSchema = z.object({
  /** The edits to make, as the owner left them (some taken out, some reworded); the AI's when absent. */
  edits: z.array(z.object({ old: z.string().min(1).max(5000), new: z.string().max(5000) })).max(50).optional(),
});

/** Makes a proposed change in its chapter. 409 when a passage isn't in the chapter any more. */
export function applyChange(changeId: string, input: z.infer<typeof ApplyChangeSchema> = {}): { revision: number | null } {
  return db().transaction(() => {
    const row = changeRow(changeId);
    if (row.status !== "open") throw new PostError("That change was already decided", 409);
    const retcon = retconRow(row.retcon_id);
    if (retcon.undone_at !== null) throw new PostError("That retcon was undone", 409);
    const chapter = getChapter(row.chapter_id);
    if (!chapter || chapter.trashed_at !== null) throw new PostError("That chapter is in the trash", 409);
    const edits = (input.edits ?? (JSON.parse(row.edits) as RetconEdit[])).filter((e) => e.old !== e.new);
    const t = Date.now();
    if (edits.length === 0) {
      db().prepare(`UPDATE retcon_changes SET status = 'skipped', decided_at = ? WHERE id = ?`).run(t, changeId);
      return { revision: null };
    }
    const { texts, missing } = applyEdits([chapter.body, chapter.summary ?? ""], edits);
    if (missing.length > 0) {
      throw new PostError(
        `The chapter changed since the AI read it: ${missing.length === 1 ? "a passage isn't" : `${missing.length} passages aren't`} there any more. Edit the chapter yourself, or skip this one.`,
        409,
      );
    }
    const summary = chapter.summary === null ? null : texts[1];
    const revision = rewrite(chapter.id, texts[0], summary, `Retcon: ${retcon.title}`);
    db()
      .prepare(`UPDATE retcon_changes SET status = 'applied', edits = ?, before_body = ?, before_summary = ?, applied_revision = ?, decided_at = ? WHERE id = ?`)
      .run(JSON.stringify(edits), chapter.body, chapter.summary, revision, t, changeId);
    return { revision };
  })();
}

export function skipChange(changeId: string): { ok: true } {
  const row = changeRow(changeId);
  if (row.status !== "open") throw new PostError("That change was already decided", 409);
  db().prepare(`UPDATE retcon_changes SET status = 'skipped', decided_at = ? WHERE id = ?`).run(Date.now(), changeId);
  return { ok: true };
}

/** Accepts every open change of a retcon that still applies; the others stay open. */
export function applyAll(retconId: string): { applied: number; failed: string[] } {
  retconRow(retconId);
  const open = db()
    .prepare(`SELECT x.id, c.title FROM retcon_changes x JOIN chapters c ON c.id = x.chapter_id WHERE x.retcon_id = ? AND x.status = 'open' AND x.edits != '[]'`)
    .all(retconId) as { id: string; title: string }[];
  let applied = 0;
  const failed: string[] = [];
  for (const x of open) {
    try {
      if (applyChange(x.id).revision !== null) applied++;
    } catch (e) {
      if (!(e instanceof PostError)) throw e;
      failed.push(x.title);
    }
  }
  return { applied, failed };
}

/**
 * Takes a retcon back: each changed chapter not edited since gets its text back (as a new revision), open changes are
 * dropped and the codex fact is put back. Chapters edited since keep their text; their titles are returned.
 */
export function undoRetcon(retconId: string): { restored: number; kept: string[] } {
  return db().transaction(() => {
    const row = retconRow(retconId);
    if (row.undone_at !== null) throw new PostError("That retcon was already undone", 409);
    const t = Date.now();
    let restored = 0;
    const kept: string[] = [];
    const applied = db().prepare(`SELECT * FROM retcon_changes WHERE retcon_id = ? AND status = 'applied'`).all(retconId) as ChangeRow[];
    for (const x of applied) {
      const chapter = getChapter(x.chapter_id);
      if (!chapter || chapter.trashed_at !== null || chapter.revision !== x.applied_revision || x.before_body === null) {
        if (chapter) kept.push(chapter.title);
        continue;
      }
      rewrite(chapter.id, x.before_body, x.before_summary, `Undo retcon: ${row.title}`);
      db().prepare(`UPDATE retcon_changes SET status = 'undone', decided_at = ? WHERE id = ?`).run(t, x.id);
      restored++;
    }
    db().prepare(`UPDATE retcon_changes SET status = 'skipped', decided_at = ? WHERE retcon_id = ? AND status = 'open'`).run(t, retconId);
    if (row.codex) {
      const codex = JSON.parse(row.codex) as CodexUndo;
      if (codex.kind === "edit") db().prepare(`UPDATE codex_facts SET text = ? WHERE id = ?`).run(codex.before, codex.id);
      else db().prepare(`DELETE FROM codex_facts WHERE id = ?`).run(codex.id);
    }
    db().prepare(`UPDATE retcons SET undone_at = ? WHERE id = ?`).run(t, retconId);
    return { restored, kept };
  })();
}

/** The run of a retcon, if it has one (for Undo to stop it first). */
export function retconRunId(retconId: string): string | null {
  return retconRow(retconId).run_id;
}
