import { z } from "zod";
import { db, newId } from "./db";
import { ENTRY_TYPES, FACT_LIMITS, isFormAspect, type EntryType, type SharedBase } from "./codex";
import { PostError } from "./stories";

// The shared codex: entries that belong to no story, which stories link to (see `linkSharedEntry` in codexDb.ts and
// the notes above `resolveShared` in codex.ts). Editing one here changes it in every story that links to it.

const text = (max: number) => z.string().trim().max(max);

export const SHARED_LIMITS = { name: 100, content: 8000, alias: 60, aliases: 10, facts: 100 };

const entryFields = {
  name: text(SHARED_LIMITS.name).min(1, "name is required"),
  type: z.enum(ENTRY_TYPES),
  aliases: z.array(text(SHARED_LIMITS.alias).min(1)).max(SHARED_LIMITS.aliases),
  content: text(SHARED_LIMITS.content),
  always_include: z.boolean(),
};

export const NewSharedEntrySchema = z.object({
  name: entryFields.name,
  type: entryFields.type.default("note"),
  aliases: entryFields.aliases.default([]),
  content: entryFields.content.default(""),
  always_include: entryFields.always_include.default(false),
});
/** Any of the fields; the ones left out stay as they are (no defaults here, or a patch would reset them). */
export const SharedEntryPatchSchema = z.object(entryFields).partial().refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });

const factFields = {
  aspect: text(FACT_LIMITS.aspect).default(""),
  form: text(FACT_LIMITS.form).default(""),
  text: text(FACT_LIMITS.text).default(""),
};
const checkFact = <T extends z.ZodType<{ aspect: string; form: string; text: string }>>(schema: T) =>
  schema.refine((v) => (isFormAspect(v.aspect) ? v.form.length > 0 || v.text.length > 0 : v.text.length > 0), { message: "text is required" });

export const SharedFactSchema = checkFact(z.object(factFields));

type EntryRow = { id: string; name: string; type: EntryType; aliases: string; content: string; always_include: number; created_at: number; updated_at: number };
type FactRow = { id: string; shared_entry_id: string; aspect: string; form: string; text: string };

export type SharedEntry = SharedBase & { created_at: number; updated_at: number };

function parseAliases(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // leave empty
  }
  return [];
}

function toEntry(r: EntryRow, facts: FactRow[]): SharedEntry {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    aliases: parseAliases(r.aliases),
    content: r.content,
    always_include: r.always_include === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    facts: facts.filter((f) => f.shared_entry_id === r.id).map(({ id, aspect, form, text }) => ({ id, aspect, form, text })),
  };
}

/** Every shared entry with its facts, by name. */
export function listSharedEntries(): SharedEntry[] {
  const rows = db().prepare(`SELECT * FROM shared_entries ORDER BY name COLLATE NOCASE, id`).all() as EntryRow[];
  const facts = db().prepare(`SELECT * FROM shared_facts ORDER BY created_at, rowid`).all() as FactRow[];
  return rows.map((r) => toEntry(r, facts));
}

export function getSharedEntry(id: string): SharedEntry | null {
  const row = db().prepare(`SELECT * FROM shared_entries WHERE id = ?`).get(id) as EntryRow | undefined;
  if (!row) return null;
  const facts = db().prepare(`SELECT * FROM shared_facts WHERE shared_entry_id = ? ORDER BY created_at, rowid`).all(id) as FactRow[];
  return toEntry(row, facts);
}

/** The bases for these shared entry ids (ones that no longer exist are left out), for folding a story's codex. */
export function loadSharedBases(ids: string[]): Map<string, SharedBase> {
  const unique = [...new Set(ids)];
  const out = new Map<string, SharedBase>();
  if (unique.length === 0) return out;
  const marks = unique.map(() => "?").join(",");
  const rows = db().prepare(`SELECT * FROM shared_entries WHERE id IN (${marks})`).all(...unique) as EntryRow[];
  const facts = db().prepare(`SELECT * FROM shared_facts WHERE shared_entry_id IN (${marks}) ORDER BY created_at, rowid`).all(...unique) as FactRow[];
  for (const r of rows) {
    const { created_at, updated_at, ...base } = toEntry(r, facts);
    void created_at;
    void updated_at;
    out.set(r.id, base);
  }
  return out;
}

export function createSharedEntry(input: z.infer<typeof NewSharedEntrySchema>): { id: string } {
  const id = newId();
  const now = Date.now();
  db()
    .prepare(`INSERT INTO shared_entries (id, name, type, aliases, content, always_include, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name, input.type, JSON.stringify(input.aliases), input.content, input.always_include ? 1 : 0, now, now);
  return { id };
}

export function updateSharedEntry(id: string, patch: z.infer<typeof SharedEntryPatchSchema>): SharedEntry {
  const cur = getSharedEntry(id);
  if (!cur) throw new PostError("That shared entry doesn't exist", 404);
  const next = { ...cur, ...patch };
  db()
    .prepare(`UPDATE shared_entries SET name = ?, type = ?, aliases = ?, content = ?, always_include = ?, updated_at = ? WHERE id = ?`)
    .run(next.name, next.type, JSON.stringify(next.aliases), next.content, next.always_include ? 1 : 0, Date.now(), id);
  return getSharedEntry(id)!;
}

/** The stories that link to a shared entry (live links only: a deleted chapter's link is gone with it), with how many links each. */
export function sharedEntryUsage(id: string): { story_id: string; title: string; links: number }[] {
  return db()
    .prepare(
      `SELECT s.id AS story_id, s.title, COUNT(*) AS links
         FROM codex_ops o JOIN stories s ON s.id = o.story_id JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE o.shared_entry_id = ? AND o.op = 'create' AND c.trashed_at IS NULL
        GROUP BY s.id ORDER BY s.title COLLATE NOCASE`,
    )
    .all(id) as { story_id: string; title: string; links: number }[];
}

/** Deletes a shared entry nobody links to. A linked one must be removed from its stories first. */
export function deleteSharedEntry(id: string): { deleted: true } {
  if (!getSharedEntry(id)) throw new PostError("That shared entry doesn't exist", 404);
  const used = db().prepare(`SELECT COUNT(*) AS n FROM codex_ops WHERE shared_entry_id = ?`).get(id) as { n: number };
  if (used.n > 0) {
    const stories = sharedEntryUsage(id);
    throw new PostError(
      stories.length > 0
        ? `This entry is used in ${stories.map((s) => `“${s.title}”`).join(", ")}. Remove it from there first.`
        : "Chapters in the bin still link to this entry. Delete them for good first.",
      409,
    );
  }
  db().prepare(`DELETE FROM shared_entries WHERE id = ?`).run(id);
  return { deleted: true };
}

export function addSharedFact(entryId: string, input: z.infer<typeof SharedFactSchema>): { id: string } {
  if (!getSharedEntry(entryId)) throw new PostError("That shared entry doesn't exist", 404);
  const count = db().prepare(`SELECT COUNT(*) AS n FROM shared_facts WHERE shared_entry_id = ?`).get(entryId) as { n: number };
  if (count.n >= SHARED_LIMITS.facts) throw new PostError(`A shared entry can have at most ${SHARED_LIMITS.facts} facts`, 400);
  const aspect = isFormAspect(input.aspect) ? "form" : input.aspect;
  // One fact per aspect and form, as in a story: setting the same aspect again updates it.
  const same = aspect
    ? (db()
        .prepare(`SELECT id FROM shared_facts WHERE shared_entry_id = ? AND lower(aspect) = lower(?) AND (? = 'form' OR lower(form) = lower(?))`)
        .get(entryId, aspect, aspect, input.form) as { id: string } | undefined)
    : undefined;
  const now = Date.now();
  if (same) {
    db().prepare(`UPDATE shared_facts SET aspect = ?, form = ?, text = ? WHERE id = ?`).run(aspect, input.form, input.text, same.id);
    db().prepare(`UPDATE shared_entries SET updated_at = ? WHERE id = ?`).run(now, entryId);
    return { id: same.id };
  }
  const id = newId();
  db().prepare(`INSERT INTO shared_facts (id, shared_entry_id, aspect, form, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, entryId, aspect, input.form, input.text, now);
  db().prepare(`UPDATE shared_entries SET updated_at = ? WHERE id = ?`).run(now, entryId);
  return { id };
}

export function updateSharedFact(entryId: string, factId: string, input: z.infer<typeof SharedFactSchema>): { id: string } {
  const aspect = isFormAspect(input.aspect) ? "form" : input.aspect;
  const r = db().prepare(`UPDATE shared_facts SET aspect = ?, form = ?, text = ? WHERE id = ? AND shared_entry_id = ?`).run(aspect, input.form, input.text, factId, entryId);
  if (r.changes === 0) throw new PostError("That fact doesn't exist", 404);
  db().prepare(`UPDATE shared_entries SET updated_at = ? WHERE id = ?`).run(Date.now(), entryId);
  return { id: factId };
}

export function removeSharedFact(entryId: string, factId: string): { deleted: true } {
  const r = db().prepare(`DELETE FROM shared_facts WHERE id = ? AND shared_entry_id = ?`).run(factId, entryId);
  if (r.changes === 0) throw new PostError("That fact doesn't exist", 404);
  // A story's change to this fact (or its hiding of it) has nothing left to change; drop it rather than let it read as the story's own fact.
  db().prepare(`DELETE FROM codex_facts WHERE fact_id = ?`).run(factId);
  db().prepare(`UPDATE shared_entries SET updated_at = ? WHERE id = ?`).run(Date.now(), entryId);
  return { deleted: true };
}
