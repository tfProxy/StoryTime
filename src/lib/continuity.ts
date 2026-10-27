// Continuity check in plain code (no AI, no db): walk the facts along a chapter path and report
// where a stated value changes without an approved change event on that chapter.
import type { StoredFact } from "./facts";

/**
 * The approved chapter tags (by name, any case) that mark a change the story explains, such as a transformation or a
 * gender swap: a changed value on a chapter with one of them is not a clash. The owner may want this as a setting later.
 */
export const CHANGE_EVENT_TAGS = ["tf", "tg"];

/** What `factsAlongPath(chapterId)` returns: one entry per chapter, root first. */
export type PathFacts = { chapterId: string; facts: StoredFact[] };

export type ConflictSide = { chapterId: string; value: string; quote: string };

export type Conflict = {
  entity: string;
  attribute: string;
  before: ConflictSide;
  after: ConflictSide;
};

const clean = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Lowercase, collapse whitespace, drop a leading "the " and trailing punctuation. */
function normValue(v: string): string {
  return clean(v).replace(/^the\s+/, "").replace(/[\s.,;:!?'")\]]+$/, "").trim();
}

/**
 * A short, stable id for a clash: 16 hex characters from the kind and both quotes (whitespace and case ignored).
 * Plain code with no node imports, because the run's runner and the server both compute it. Two 32-bit FNV-1a
 * hashes with different seeds; it only has to tell a story's few clashes apart.
 */
export function continuityFingerprint(beforeQuote: string, afterQuote: string): string {
  const text = `continuity\u0000${clean(beforeQuote)}\u0000${clean(afterQuote)}`;
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Finds values that change along the path without an approved change event.
 * `changeEvents` is the set of chapter ids that carry an approved change-event tag (for example
 * tf or tg); the caller resolves tag names to chapters. A change on such a chapter is accepted
 * and becomes the new baseline. Otherwise a conflict is reported once, and the new value
 * becomes the baseline. Conflicts come back in path order.
 */
export function findConflicts(path: PathFacts[], changeEvents: ReadonlySet<string>): Conflict[] {
  const latest = new Map<string, { side: ConflictSide; norm: string }>();
  const conflicts: Conflict[] = [];
  for (const { chapterId, facts } of path) {
    for (const f of facts) {
      const key = `${clean(f.entity)}\u0000${clean(f.attribute)}`;
      const norm = normValue(f.value);
      const side: ConflictSide = { chapterId, value: f.value, quote: f.quote };
      const prev = latest.get(key);
      if (prev && prev.norm !== norm && !changeEvents.has(chapterId)) {
        conflicts.push({ entity: f.entity, attribute: f.attribute, before: prev.side, after: side });
      }
      // Same value: the latest chapter stating it is the best evidence. Changed value: new baseline.
      latest.set(key, { side, norm });
    }
  }
  return conflicts;
}
