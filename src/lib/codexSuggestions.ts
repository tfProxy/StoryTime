// The codex inbox: after a chapter is posted the AI reads it (a "codex" task of a review run) and leaves suggestions,
// each one fact-sized and with a quote from the chapter as evidence. The owner accepts (which writes the codex change
// at that chapter), edits or dismisses each. A suggestion belongs to the chapter revision it was made for: once the
// chapter is edited its open suggestions are stale and are not listed.
import { z } from "zod";
import { db, newId } from "./db";
import { ENTRY_TYPES, FACT_LIMITS, FORM_ASPECT, isFormAspect, sameAspect, type CodexEntry } from "./codex";
import { codexEntryLabels, createCodexOp, createFactOp, getCodexState } from "./codexDb";
import { PostError } from "./stories";
import { SUGGESTION_KINDS, type SuggestionInput, type SuggestionKind } from "./ai/codexCheckAi";

export type SuggestionStatus = "open" | "accepted" | "dismissed";

const text = (max: number) => z.string().trim().max(max);

const SuggestedEntrySchema = z.object({
  name: text(100).min(1),
  type: z.enum(ENTRY_TYPES).default("character"),
  aliases: z.array(text(60).min(1)).max(10).default([]),
  notes: text(8000).default(""),
  facts: z
    .array(z.object({ aspect: text(FACT_LIMITS.aspect).default(""), form: text(FACT_LIMITS.form).default(""), text: text(FACT_LIMITS.text).min(1) }))
    .max(10)
    .default([]),
});

export const SuggestionInputSchema = z
  .object({
    kind: z.enum(SUGGESTION_KINDS),
    entry_id: z.string().min(1).optional(),
    aspect: text(FACT_LIMITS.aspect).default(""),
    form: text(FACT_LIMITS.form).default(""),
    after: text(FACT_LIMITS.text).default(""),
    quote: text(FACT_LIMITS.quote).default(""),
    entry: SuggestedEntrySchema.optional(),
  })
  .refine((v) => (v.kind === "entry" ? v.entry !== undefined : v.entry_id !== undefined), { message: "an entry suggestion needs entry; the others need entry_id" });

/** Where a suggestion came from: reading a chapter, or turning an entry's notes into facts. */
export const SUGGESTION_SOURCES = ["chapter", "notes"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export const SaveSuggestionsSchema = z
  .object({
    revision: z.number().int().min(1),
    suggestions: z.array(SuggestionInputSchema).max(50),
    source: z.enum(SUGGESTION_SOURCES).default("chapter"),
    /** For source "notes": the entry whose notes were read (so its earlier open suggestions are replaced even when none are new). */
    entry_id: z.string().min(1).optional(),
  })
  .refine((v) => v.source !== "notes" || v.entry_id !== undefined, { message: "a notes reading needs entry_id" });

export const AcceptEditsSchema = z.object({
  aspect: text(FACT_LIMITS.aspect).optional(),
  form: text(FACT_LIMITS.form).optional(),
  text: text(FACT_LIMITS.text).optional(),
});

type Row = {
  id: string;
  story_id: string;
  chapter_id: string;
  revision: number;
  kind: SuggestionKind;
  entry_id: string | null;
  aspect: string;
  form: string;
  before: string;
  after: string;
  quote: string;
  entry: string;
  source: SuggestionSource;
  status: SuggestionStatus;
  created_at: number;
  decided_at: number | null;
};

const lc = (s: string) => s.trim().toLowerCase();
const formLabel = (e: CodexEntry) => (e.form ? [e.form.name, e.form.note].map((s) => s.trim()).filter(Boolean).join(", ") : "");
const liveFact = (e: CodexEntry, aspect: string, form: string) => e.facts.find((f) => !isFormAspect(f.aspect) && sameAspect(f.aspect, aspect) && sameAspect(f.form, form));

function parseEntry(json: string): (z.infer<typeof SuggestedEntrySchema>) | null {
  try {
    const parsed = SuggestedEntrySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Saves what the AI read from a chapter revision: replaces the chapter's open suggestions (an earlier reading), keeps
 * out any the owner dismissed before, and records that the chapter was read. 404 / 409 as saveFacts.
 * With source "notes" (the AI turned the notes of entry `notesEntryId` into facts, anchored at this chapter) only the
 * open "notes" suggestions for that entry at this chapter are replaced, the chapter is not marked as read, and only
 * earlier "notes" dismissals count.
 */
export function saveSuggestions(chapterId: string, revision: number, list: SuggestionInput[], source: SuggestionSource = "chapter", notesEntryId?: string): { saved: number } {
  return db().transaction(() => {
    const chapter = db().prepare(`SELECT story_id, revision FROM chapters WHERE id = ?`).get(chapterId) as { story_id: string; revision: number } | undefined;
    if (!chapter) throw new PostError("That chapter does not exist", 404);
    if (chapter.revision !== revision) throw new PostError("The chapter was edited meanwhile", 409);
    if (source === "notes") {
      if (!notesEntryId) throw new PostError("A notes reading needs the entry", 400);
      db().prepare(`DELETE FROM codex_suggestions WHERE chapter_id = ? AND status = 'open' AND source = 'notes' AND entry_id = ?`).run(chapterId, notesEntryId);
    } else {
      db().prepare(`DELETE FROM codex_suggestions WHERE chapter_id = ? AND status = 'open' AND source = 'chapter'`).run(chapterId);
    }

    const entries = getCodexState(chapterId);
    const dismissed = (db().prepare(`SELECT kind, entry_id, aspect, form, after, entry FROM codex_suggestions WHERE chapter_id = ? AND status = 'dismissed' AND source = ?`).all(chapterId, source) as Pick<Row, "kind" | "entry_id" | "aspect" | "form" | "after" | "entry">[]).map((d) => ({
      ...d,
      who: d.kind === "entry" ? lc(parseEntry(d.entry)?.name ?? "") : (d.entry_id ?? ""),
    }));
    const insert = db().prepare(
      `INSERT INTO codex_suggestions (id, story_id, chapter_id, revision, kind, entry_id, aspect, form, before, after, quote, entry, source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    );
    const now = Date.now();
    let saved = 0;
    for (const s of list) {
      if (source === "notes" && (s.kind === "entry" || s.entry_id !== notesEntryId)) continue; // notes only ever suggest facts for their own entry
      let before = "";
      let who: string;
      if (s.kind === "entry") {
        if (!s.entry) continue;
        const name = lc(s.entry.name);
        if (entries.some((e) => [e.name, ...e.aliases].some((n) => lc(n) === name))) continue;
        who = name;
      } else {
        const entry = entries.find((e) => e.entry_id === s.entry_id);
        if (!entry) continue;
        who = entry.entry_id;
        if (s.kind === "form") {
          before = formLabel(entry);
          if (entry.form && sameAspect(entry.form.name, s.form) && lc(entry.form.note) === lc(s.after)) continue;
        } else {
          const fact = liveFact(entry, s.aspect, s.form);
          if (s.kind === "retire" && !fact) continue;
          if (s.kind !== "retire" && fact && lc(fact.text) === lc(s.after)) continue;
          before = fact?.text ?? "";
        }
      }
      if (dismissed.some((d) => d.kind === s.kind && d.who === who && sameAspect(d.aspect, s.aspect) && sameAspect(d.form, s.form) && lc(d.after) === lc(s.after))) continue;
      insert.run(newId(), chapter.story_id, chapterId, revision, s.kind, s.kind === "entry" ? null : s.entry_id, s.aspect, s.form, before, s.kind === "retire" ? "" : s.after, s.quote, s.kind === "entry" ? JSON.stringify(s.entry) : "{}", source, now);
      saved += 1;
    }
    if (source === "chapter") {
      db()
        .prepare(
          `INSERT INTO codex_checks (chapter_id, revision, checked_at) VALUES (?, ?, ?)
           ON CONFLICT (chapter_id) DO UPDATE SET revision = excluded.revision, checked_at = excluded.checked_at`,
        )
        .run(chapterId, revision, now);
    }
    return { saved };
  })();
}

export type CodexSuggestion = {
  id: string;
  story_id: string;
  chapter_id: string;
  chapter_title: string;
  revision: number;
  kind: SuggestionKind;
  entry_id: string | null;
  /** The entry's name; for a new entry, the proposed name. */
  entry_name: string;
  aspect: string;
  form: string;
  /** The fact's text when the suggestion was made ("form, note" for a form), "" if there was none. */
  before: string;
  after: string;
  quote: string;
  /** The proposed entry, for kind "entry". */
  entry: z.infer<typeof SuggestedEntrySchema> | null;
  /** "chapter": from reading the chapter (`quote` is from its text); "notes": from the entry's notes (`quote` is from the notes). */
  source: SuggestionSource;
  /** The fact's text at the chapter now (so the page can see it moved since); "" if there is none. */
  current: string;
  status: SuggestionStatus;
  created_at: number;
  decided_at: number | null;
};

/**
 * A story's suggestions, by chapter depth then time. Open ones whose chapter was edited since are left out (stale).
 * `current` is read from the codex at each chapter as it is now.
 */
export function listSuggestions(storyId: string, filter: { status?: SuggestionStatus; chapterId?: string } = {}): CodexSuggestion[] {
  const rows = db()
    .prepare(
      `SELECT s.id, s.story_id, s.chapter_id, s.revision, s.kind, s.entry_id, s.aspect, s.form, s.before, s.after, s.quote, s.entry, s.source, s.status,
              s.created_at, s.decided_at, c.title AS chapter_title, c.revision AS chapter_revision
         FROM codex_suggestions s JOIN chapters c ON c.id = s.chapter_id
        WHERE s.story_id = ? ${filter.status ? "AND s.status = ?" : ""} ${filter.chapterId ? "AND s.chapter_id = ?" : ""}
        ORDER BY c.depth, s.created_at, s.rowid`,
    )
    .all(storyId, ...(filter.status ? [filter.status] : []), ...(filter.chapterId ? [filter.chapterId] : [])) as (Row & { chapter_title: string; chapter_revision: number })[];
  const live = rows.filter((r) => r.status !== "open" || r.revision === r.chapter_revision);
  const states = new Map<string, CodexEntry[]>();
  const stateAt = (chapterId: string) => {
    let s = states.get(chapterId);
    if (!s) states.set(chapterId, (s = getCodexState(chapterId)));
    return s;
  };
  const missing = live.filter((r) => r.entry_id && !stateAt(r.chapter_id).some((e) => e.entry_id === r.entry_id)).map((r) => r.entry_id!);
  const labels = codexEntryLabels([...new Set(missing)]);
  return live.map((r) => {
    const entry = r.entry_id ? stateAt(r.chapter_id).find((e) => e.entry_id === r.entry_id) : undefined;
    const proposed = r.kind === "entry" ? parseEntry(r.entry) : null;
    let current = "";
    if (entry) current = r.kind === "form" ? formLabel(entry) : (liveFact(entry, r.aspect, r.form)?.text ?? "");
    return {
      id: r.id,
      story_id: r.story_id,
      chapter_id: r.chapter_id,
      chapter_title: r.chapter_title,
      revision: r.revision,
      kind: r.kind,
      entry_id: r.entry_id,
      entry_name: proposed ? proposed.name : (entry?.name ?? (r.entry_id ? (labels[r.entry_id]?.name ?? "") : "")),
      aspect: r.aspect,
      form: r.form,
      before: r.before,
      after: r.after,
      quote: r.quote,
      entry: proposed,
      source: r.source,
      current,
      status: r.status,
      created_at: r.created_at,
      decided_at: r.decided_at,
    };
  });
}

/** How many suggestions wait in a story's inbox (open and not stale), in all and per chapter. */
export function openSuggestionCounts(storyId: string): { total: number; byChapter: Record<string, number> } {
  const rows = db()
    .prepare(
      `SELECT s.chapter_id, COUNT(*) AS n FROM codex_suggestions s JOIN chapters c ON c.id = s.chapter_id AND c.revision = s.revision
        WHERE s.story_id = ? AND s.status = 'open' GROUP BY s.chapter_id`,
    )
    .all(storyId) as { chapter_id: string; n: number }[];
  return { total: rows.reduce((sum, r) => sum + r.n, 0), byChapter: Object.fromEntries(rows.map((r) => [r.chapter_id, r.n])) };
}

/** The chapters of a story read for codex changes at their current revision, by id. */
export function codexCheckedChapterIds(storyId: string): Set<string> {
  const rows = db()
    .prepare(`SELECT k.chapter_id FROM codex_checks k JOIN chapters c ON c.id = k.chapter_id AND c.revision = k.revision WHERE c.story_id = ?`)
    .all(storyId) as { chapter_id: string }[];
  return new Set(rows.map((r) => r.chapter_id));
}

function openRow(id: string): Row & { chapter_revision: number } {
  const row = db()
    .prepare(
      `SELECT s.id, s.story_id, s.chapter_id, s.revision, s.kind, s.entry_id, s.aspect, s.form, s.before, s.after, s.quote, s.entry, s.source, s.status,
              s.created_at, s.decided_at, c.revision AS chapter_revision
         FROM codex_suggestions s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?`,
    )
    .get(id) as (Row & { chapter_revision: number }) | undefined;
  if (!row) throw new PostError("That suggestion does not exist", 404);
  return row;
}

/**
 * Writes the suggestion into the codex at its chapter (the owner's edits to the aspect, form or text win over the AI's)
 * and marks it accepted. Returns the id of the entry changed or created.
 */
export function acceptSuggestion(id: string, edits: z.infer<typeof AcceptEditsSchema> = {}): { entry_id: string } {
  return db().transaction(() => {
    const row = openRow(id);
    if (row.status !== "open") throw new PostError("That suggestion has already been decided", 409);
    if (row.revision !== row.chapter_revision) throw new PostError("The chapter was edited after this was suggested", 409);
    const anchor = row.chapter_id;
    let entryId: string;
    if (row.kind === "entry") {
      const proposed = parseEntry(row.entry);
      if (!proposed) throw new PostError("That suggestion has no entry", 409);
      entryId = createCodexOp({ anchor_chapter_id: anchor, op: "create", name: proposed.name, type: proposed.type, aliases: proposed.aliases, content: proposed.notes, always_include: false }).entry_id;
      for (const f of proposed.facts) createFactOp({ anchor_chapter_id: anchor, entry_id: entryId, op: "set", aspect: f.aspect, form: f.form, text: f.text, quote: row.quote });
    } else {
      entryId = row.entry_id!;
      if (row.kind === "retire") {
        const entry = getCodexState(anchor).find((e) => e.entry_id === entryId);
        const fact = entry ? liveFact(entry, row.aspect, row.form) : undefined;
        if (!fact) throw new PostError("That fact is already gone", 409);
        createFactOp({ anchor_chapter_id: anchor, entry_id: entryId, fact_id: fact.fact_id, op: "retire", aspect: fact.aspect, form: fact.form, text: "", quote: row.quote });
      } else if (row.kind === "form") {
        createFactOp({ anchor_chapter_id: anchor, entry_id: entryId, op: "set", aspect: FORM_ASPECT, form: edits.form ?? row.form, text: edits.text ?? row.after, quote: row.quote });
      } else {
        createFactOp({ anchor_chapter_id: anchor, entry_id: entryId, op: "set", aspect: edits.aspect ?? row.aspect, form: edits.form ?? row.form, text: edits.text ?? row.after, quote: row.quote });
      }
    }
    db().prepare(`UPDATE codex_suggestions SET status = 'accepted', decided_at = ? WHERE id = ?`).run(Date.now(), id);
    return { entry_id: entryId };
  })();
}

function decide(id: string, from: SuggestionStatus, to: SuggestionStatus, why: string) {
  const row = openRow(id);
  if (row.status !== from) throw new PostError(why, 409);
  db().prepare(`UPDATE codex_suggestions SET status = ?, decided_at = ? WHERE id = ?`).run(to, to === "open" ? null : Date.now(), id);
  return { ok: true as const };
}

export const dismissSuggestion = (id: string) => decide(id, "open", "dismissed", "That suggestion has already been decided");
export const reopenSuggestion = (id: string) => decide(id, "dismissed", "open", "Only a dismissed suggestion can be reopened");
