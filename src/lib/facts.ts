// Facts for the story review: what each chapter states about its characters, places and things (eye colour, home, ...),
// read by the AI and kept per chapter revision so they can be compared along a path. A chapter's facts are replaced
// each time it is read; a fact row only counts while its revision is the chapter's current one.
import { z } from "zod";
import { db, newId } from "./db";
import { getPath, PostError } from "./stories";

// The same lengths factAi.ts cuts the AI's reply to.
export const FACT_LIMITS = { facts: 40, entity: 80, attribute: 60, value: 120, quote: 240 };

export type StoredFact = { entity: string; attribute: string; value: string; quote: string };

const field = (max: number) => z.string().trim().min(1).max(max);

export const SaveFactsSchema = z.object({
  revision: z.number().int().min(1),
  facts: z
    .array(
      z.object({
        entity: field(FACT_LIMITS.entity),
        attribute: field(FACT_LIMITS.attribute),
        value: field(FACT_LIMITS.value),
        quote: field(FACT_LIMITS.quote),
      }),
    )
    .max(FACT_LIMITS.facts),
});

/** Replaces a chapter's facts with those read from the given revision, and records that it was read. 409 when the chapter has been edited since. */
export function saveFacts(chapterId: string, revision: number, facts: StoredFact[]): { saved: number } {
  return db().transaction(() => {
    const chapter = db().prepare(`SELECT revision FROM chapters WHERE id = ?`).get(chapterId) as { revision: number } | undefined;
    if (!chapter) throw new PostError("That chapter does not exist", 404);
    if (chapter.revision !== revision) throw new PostError("The chapter was edited meanwhile", 409);
    db().prepare(`DELETE FROM chapter_facts WHERE chapter_id = ?`).run(chapterId);
    const insert = db().prepare(`INSERT INTO chapter_facts (id, chapter_id, revision, entity, attribute, value, quote) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const f of facts) insert.run(newId(), chapterId, revision, f.entity, f.attribute, f.value, f.quote);
    db()
      .prepare(
        `INSERT INTO chapter_fact_checks (chapter_id, revision, checked_at) VALUES (?, ?, ?)
         ON CONFLICT (chapter_id) DO UPDATE SET revision = excluded.revision, checked_at = excluded.checked_at`,
      )
      .run(chapterId, revision, Date.now());
    return { saved: facts.length };
  })();
}

/** The chapters of a story that were read for facts at their current revision (a chapter with no facts counts), by id. */
export function factCheckedChapterIds(storyId: string): Set<string> {
  const rows = db()
    .prepare(
      `SELECT k.chapter_id FROM chapter_fact_checks k JOIN chapters c ON c.id = k.chapter_id AND c.revision = k.revision WHERE c.story_id = ?`,
    )
    .all(storyId) as { chapter_id: string }[];
  return new Set(rows.map((r) => r.chapter_id));
}

/** The facts of each chapter from the story's root down to the given chapter, in that order, only those read from the chapter's current revision. */
export function factsAlongPath(chapterId: string): { chapterId: string; facts: StoredFact[] }[] {
  const path = getPath(chapterId);
  if (path.length === 0) return [];
  const rows = db()
    .prepare(
      `SELECT f.chapter_id, f.entity, f.attribute, f.value, f.quote
         FROM chapter_facts f JOIN chapters c ON c.id = f.chapter_id AND c.revision = f.revision
        WHERE f.chapter_id IN (${path.map(() => "?").join(",")}) ORDER BY f.rowid`,
    )
    .all(...path.map((c) => c.id)) as (StoredFact & { chapter_id: string })[];
  return path.map((c) => ({
    chapterId: c.id,
    facts: rows.filter((r) => r.chapter_id === c.id).map(({ entity, attribute, value, quote }) => ({ entity, attribute, value, quote })),
  }));
}
