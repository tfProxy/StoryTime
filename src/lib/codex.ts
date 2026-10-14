// The codex is an append-only log of ops, each anchored at a chapter. An op applies to its
// anchor chapter and every descendant of it. The codex "at" a chapter is the fold of the ops
// anchored on the path from the story root to that chapter. Pure code: used by server and browser.

export const ENTRY_TYPES = ["character", "place", "item", "faction", "lore", "note"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export type CodexOp = {
  id: string;
  anchor_chapter_id: string;
  /** Depth of the anchor chapter; deeper anchors override shallower ones. */
  anchor_depth: number;
  entry_id: string;
  op: "create" | "replace" | "retire";
  name: string;
  type: EntryType;
  aliases: string[];
  content: string;
  always_include: boolean;
  author_name: string;
  posted_at: number;
};

export type CodexEntry = {
  entry_id: string;
  name: string;
  type: EntryType;
  aliases: string[];
  content: string;
  always_include: boolean;
  /** The op that produced this version of the entry. */
  op: CodexOp;
};

/** Ops in the order they take effect: by anchor depth, then post time, then given order. */
export function orderOps(ops: CodexOp[]): CodexOp[] {
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => a.op.anchor_depth - b.op.anchor_depth || a.op.posted_at - b.op.posted_at || a.i - b.i)
    .map((x) => x.op);
}

const fromOp = (op: CodexOp): CodexEntry => ({
  entry_id: op.entry_id,
  name: op.name,
  type: op.type,
  aliases: op.aliases,
  content: op.content,
  always_include: op.always_include,
  op,
});

/** The live entries produced by a set of ops (already limited to one root->chapter path). */
export function foldCodex(ops: CodexOp[]): CodexEntry[] {
  const state = new Map<string, CodexEntry>();
  for (const op of orderOps(ops)) {
    if (op.op === "retire") state.delete(op.entry_id);
    else state.set(op.entry_id, fromOp(op)); // a replace of a missing/retired entry creates (or revives) it
  }
  return [...state.values()].sort(
    (a, b) => ENTRY_TYPES.indexOf(a.type) - ENTRY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name),
  );
}

/** Entries that were retired on this path, as they last looked before retirement. */
export function retiredEntries(ops: CodexOp[]): CodexEntry[] {
  const live = new Set(foldCodex(ops).map((e) => e.entry_id));
  const last = new Map<string, CodexOp>();
  for (const op of orderOps(ops)) if (op.op !== "retire") last.set(op.entry_id, op);
  return [...last.values()].filter((op) => !live.has(op.entry_id)).map(fromOp);
}

/** All versions of one entry along the path, oldest first (retirements included). */
export function entryHistory(ops: CodexOp[], entryId: string): CodexOp[] {
  return orderOps(ops).filter((o) => o.entry_id === entryId);
}

// ---- Changes held in a draft until its chapter is posted ----

/** Stands in for the chapter being written, which has no id until it is posted. */
export const DRAFT_ANCHOR = "draft";

/** A codex change waiting in a draft. New entries get a local id (`draft-…`) until posted. */
export type CodexChange = Pick<CodexOp, "op" | "entry_id" | "name" | "type" | "aliases" | "content" | "always_include">;

export const isDraftEntry = (entryId: string) => entryId.startsWith("draft-");

/**
 * Adds a change to a draft's list, keeping at most one per entry: a later change to the same entry
 * replaces the earlier one, an entry created in the draft stays a "create", and retiring an entry
 * that only exists in the draft drops it.
 */
export function addChange(changes: CodexChange[], next: CodexChange): CodexChange[] {
  const prev = changes.find((c) => c.entry_id === next.entry_id);
  const rest = changes.filter((c) => c.entry_id !== next.entry_id);
  if (prev?.op === "create") return next.op === "retire" ? rest : [...rest, { ...next, op: "create" }];
  return [...rest, next];
}

/** The draft's changes as ops at `depth` (one below the last chapter of the path), so they win. */
export function draftOps(changes: CodexChange[], depth: number): CodexOp[] {
  return changes.map((c) => ({
    ...c,
    id: `draft-op-${c.entry_id}`,
    anchor_chapter_id: DRAFT_ANCHOR,
    anchor_depth: depth,
    author_name: "",
    posted_at: 0, // not posted; the depth alone puts these last
  }));
}

/** Which fields differ between two versions, for a one-line "changed: ..." summary. */
export function changedFields(prev: CodexOp | undefined, next: CodexOp): string[] {
  if (!prev || prev.op === "retire") return next.op === "retire" ? [] : ["created"];
  const out: string[] = [];
  if (prev.name !== next.name) out.push("name");
  if (prev.type !== next.type) out.push("type");
  if (prev.aliases.join("|") !== next.aliases.join("|")) out.push("aliases");
  if (prev.content !== next.content) out.push("content");
  if (prev.always_include !== next.always_include) out.push("always include");
  return out;
}
