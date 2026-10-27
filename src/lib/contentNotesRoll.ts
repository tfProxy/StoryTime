// The pure part of the content notes under each choice: given each chapter's own approved tags, work out what
// comes next (the chapter itself) and what comes later (everything below it), for every chapter at once.

export type NoteTag = { name: string; value: string | null };
export type ChapterNote = { next: string[]; later: string[] };

/** Tags by lower-cased name, with the values seen for each. */
type TagSet = Map<string, { name: string; values: Map<string, string> }>;

function add(set: TagSet, t: NoteTag) {
  const key = t.name.toLowerCase();
  const entry = set.get(key) ?? { name: t.name, values: new Map<string, string>() };
  const v = t.value?.trim();
  if (v && !entry.values.has(v.toLowerCase())) entry.values.set(v.toLowerCase(), v);
  set.set(key, entry);
}

/** "violence (graphic, mild)" for each tag, sorted by name. */
function format(set: TagSet, leaveOut?: TagSet): string[] {
  return [...set.entries()]
    .filter(([key]) => !leaveOut?.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, e]) => (e.values.size > 0 ? `${e.name} (${[...e.values.values()].join(", ")})` : e.name));
}

/**
 * `chapters` lists parents before children. `own` holds each chapter's approved tags. For every chapter the
 * result has `next` (its own tags) and `later` (tags anywhere below it that are not already in `next`).
 * One pass from the bottom up: each chapter's subtree set is its own tags plus its children's subtree sets.
 */
export function rollUpNotes(chapters: { id: string; parent_id: string | null }[], own: Map<string, NoteTag[]>): Map<string, ChapterNote> {
  const below = new Map<string, TagSet>();
  const notes = new Map<string, ChapterNote>();
  for (let i = chapters.length - 1; i >= 0; i--) {
    const c = chapters[i];
    const mine: TagSet = new Map();
    for (const t of own.get(c.id) ?? []) add(mine, t);
    const under = below.get(c.id) ?? new Map();
    notes.set(c.id, { next: format(mine), later: format(under, mine) });
    // This chapter's whole subtree, handed up to its parent.
    if (c.parent_id) {
      const up = below.get(c.parent_id) ?? new Map();
      for (const [key, e] of [...mine, ...under]) {
        const into = up.get(key) ?? { name: e.name, values: new Map<string, string>() };
        for (const [k, v] of e.values) if (!into.values.has(k)) into.values.set(k, v);
        up.set(key, into);
      }
      below.set(c.parent_id, up);
    }
  }
  return notes;
}

/** "Next: violence, tf · Later on this branch: tg", or null when there is nothing to say. */
export function noteText(n: ChapterNote | undefined): string | null {
  if (!n) return null;
  const parts = [];
  if (n.next.length > 0) parts.push(`Next: ${n.next.join(", ")}`);
  if (n.later.length > 0) parts.push(`Later on this branch: ${n.later.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
