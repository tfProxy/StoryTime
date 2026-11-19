// Parts of a story's chapter list, for choosing which chapters a check reads. Pure, so client components can use it.

/** The chapters from the first one down to `id`, in reading order. */
export function pathTo<T extends { id: string; parent_id: string | null }>(chapters: T[], id: string): T[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const out: T[] = [];
  for (let c = byId.get(id); c; c = c.parent_id ? byId.get(c.parent_id) : undefined) out.unshift(c);
  return out;
}

/** `id` and every chapter below it, parents first (the input is parents first). */
export function subtreeOf<T extends { id: string; parent_id: string | null }>(chapters: T[], id: string): T[] {
  const inside = new Set([id]);
  return chapters.filter((c) => {
    if (c.id === id || (c.parent_id && inside.has(c.parent_id))) {
      inside.add(c.id);
      return true;
    }
    return false;
  });
}
