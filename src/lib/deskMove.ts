// Moving between chapters on the writing desk (browser only). Each chapter has its own address (/c/<id>/desk, or a
// new chapter's), so reload and back work. A move within the desk (✎ on a path block, a choice in "What happens next?",
// Post, Back or Forward from one desk to another) marks the address it goes to in sessionStorage just before it goes;
// the desk that opens there finds the mark and
// keeps the path blocks folded as they were. With no mark (the reading page's Edit, a reload, a link from elsewhere) the desk
// was opened from outside: every block starts unfolded. The fold states are kept per story in sessionStorage.

const MOVE_KEY = "storytime-desk-move";
const foldsKey = (storyId: string) => `storytime-desk-folds:${storyId}`;
/** A mark older than this was left by a move that didn't happen (or went elsewhere). */
const MOVE_FRESH_MS = 30_000;

const here = (href: string) => {
  const u = new URL(href, window.location.origin);
  return u.pathname + u.search;
};

/** Marks a move within the desk to `href`, just before going there. */
export function markDeskMove(href: string): void {
  try {
    sessionStorage.setItem(MOVE_KEY, JSON.stringify({ to: here(href), at: Date.now() }));
  } catch {
    // no storage: the desk opens as from outside
  }
}

/**
 * Whether the desk at `address` (its path and query, from the router: while the new page first renders, the window's
 * address is still the old one) was reached by a move within the desk: the mark is for it and fresh.
 */
export function cameFromDesk(address: string): boolean {
  try {
    const raw = sessionStorage.getItem(MOVE_KEY);
    if (!raw) return false;
    const m = JSON.parse(raw) as { to?: string; at?: number };
    return m.to === here(address) && typeof m.at === "number" && Date.now() - m.at < MOVE_FRESH_MS;
  } catch {
    return false;
  }
}

/** Drops the mark once the desk has read it. */
export function clearDeskMove(): void {
  try {
    sessionStorage.removeItem(MOVE_KEY);
  } catch {
    // nothing to clear
  }
}

/** The path blocks' fold states for a story: true for an unfolded block, by chapter id. */
export function readFolds(storyId: string): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(foldsKey(storyId));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function writeFolds(storyId: string, folds: Record<string, boolean>): void {
  try {
    sessionStorage.setItem(foldsKey(storyId), JSON.stringify(folds));
  } catch {
    // kept for this page only
  }
}
