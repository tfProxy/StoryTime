import { z } from "zod";
import { db } from "./db";
import { DRAFT_ANCHOR, isDraftEntry, isFormAspect } from "./codex";
import { getCodexOps, getCodexState } from "./codexDb";
import { getStoryChapters, type StoryChapter } from "./tree";
import { getPath, PostError } from "./stories";

// Moving where a codex entry first appears: its "create" op (the last one on the viewed path) is re-anchored at an
// earlier or later chapter of the same line, taking the entry's first version with it.
//
// The first version is every row of the entry anchored at the start chapter from the create on: the create, a
// change made there and the facts set there. Facts posted with the create (the drafting page saves them in the same
// transaction) and facts added at that chapter afterwards both say how the entry reads where it first appears, so
// they go together; a time window would split them by when the owner happened to type them. Rows at later chapters
// stay where they are. Rows at the start chapter posted before the create belong to an earlier life of the entry
// (removed and added again there) and stay too.

type EntryRow = {
  kind: "op" | "fact";
  id: string;
  anchor_chapter_id: string;
  posted_at: number;
  op: string;
  fact_id: string | null;
  aspect: string;
  form: string;
  text: string;
};

export type StartItem = { chapter_id: string; chapter_title: string; label: string };

export type StartOption = {
  chapter_id: string;
  title: string;
  /** Ch. N: the chapter's place on the line, from 1. */
  number: number;
  relation: "now" | "earlier" | "later";
  allowed: boolean;
  /** Why it can't be chosen. */
  reason?: string;
  /** Moving later: the entry's facts and changes on the chapters in between, which would have to move too. */
  between: StartItem[];
  /** Moving later: how many of the entry's later facts are set in between (counted once each). */
  between_facts: number;
  /** Moving later: chapters on other branches (off this line) that would no longer have the entry. */
  leaves: number;
  /** Moving earlier: chapters on other branches that would have it from then on. */
  gains: number;
};

export type EntryStart = {
  entry_id: string;
  name: string;
  chapter_id: string;
  title: string;
  number: number;
  /** Facts in the first version (they move with it). */
  first_facts: number;
  /** Facts set at later chapters (they stay where they are). */
  later_facts: number;
  options: StartOption[];
};

export class StartConflict extends PostError {
  constructor(
    message: string,
    public between: StartItem[],
  ) {
    super(message, 409);
  }
}

const factLabel = (r: EntryRow) =>
  isFormAspect(r.aspect) ? `Form: ${[r.form, r.text].filter(Boolean).join(", ")}` : r.aspect.trim() ? `${r.aspect.trim()}${r.form ? ` (${r.form})` : ""}: ${r.text}` : r.text;
const rowLabel = (r: EntryRow) =>
  r.kind === "fact" ? (r.op === "retire" ? `Fact removed: ${factLabel(r)}` : factLabel(r)) : r.op === "retire" ? "Removed from the codex" : "A change to its details";

/** What the entry's start is on the viewed chapter's path, and what each chapter of the line would mean as its start. */
function context(entryId: string, chapterId: string) {
  if (chapterId === DRAFT_ANCHOR) throw new PostError("This chapter isn't posted yet. Post it first, then move where the entry first appears.", 400);
  if (isDraftEntry(entryId)) throw new PostError("This entry is only in a draft so far. Post the chapter first, then move where it first appears.", 400);
  const path = getPath(chapterId);
  if (path.length === 0) throw new PostError("That chapter does not exist", 404);
  const storyId = path[0].story_id;
  const create = getCodexOps(chapterId)
    .filter((o) => o.entry_id === entryId && o.op === "create")
    .at(-1);
  if (!create) throw new PostError("That entry doesn't start on this branch", 409);

  const chapters = getStoryChapters(storyId);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const start = byId.get(create.anchor_chapter_id);
  if (!start) throw new PostError("The chapter where the entry starts is in the trash", 409);
  const kids = new Map<string, StoryChapter[]>();
  for (const c of chapters) if (c.parent_id) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
  const subtree = (id: string) => {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      for (const k of kids.get(stack.pop()!) ?? []) {
        if (out.has(k.id)) continue;
        out.add(k.id);
        stack.push(k.id);
      }
    }
    return out;
  };

  const rows = [
    ...(db().prepare(`SELECT 'op' AS kind, id, anchor_chapter_id, posted_at, op, NULL AS fact_id, '' AS aspect, '' AS form, '' AS text FROM codex_ops WHERE story_id = ? AND entry_id = ?`).all(storyId, entryId) as EntryRow[]),
    ...(db().prepare(`SELECT 'fact' AS kind, id, anchor_chapter_id, posted_at, op, fact_id, aspect, form, text FROM codex_facts WHERE story_id = ? AND entry_id = ?`).all(storyId, entryId) as EntryRow[]),
  ];
  const first = rows.filter((r) => r.id === create.id || (r.anchor_chapter_id === start.id && r.posted_at >= create.posted_at));
  const firstIds = new Set(first.map((r) => r.id));
  const rest = rows.filter((r) => !firstIds.has(r.id));
  // Rows of an earlier life of the entry on this path: it can't start at or before the deepest of them.
  const startPath = getPath(start.id);
  const startPathIds = new Set(startPath.map((c) => c.id));
  const prior = rest
    .filter((r) => startPathIds.has(r.anchor_chapter_id) && r.anchor_chapter_id !== start.id)
    .map((r) => byId.get(r.anchor_chapter_id))
    .filter((c): c is StoryChapter => c !== undefined)
    .sort((a, b) => b.depth - a.depth)[0];
  return { storyId, path, create, start, byId, subtree, first, rest, startPath, prior };
}

type Context = ReturnType<typeof context>;

/** Drafts (unposted chapters and edits) that hold changes to the entry; moving its start later could strand them. */
function draftsHolding(entryId: string): string[] {
  const rows = db().prepare(`SELECT key, data FROM drafts WHERE data LIKE ?`).all(`%${entryId}%`) as { key: string; data: string }[];
  const out: string[] = [];
  for (const r of rows) {
    try {
      const d = JSON.parse(r.data) as { label?: string; title?: string; codexChanges?: { entry_id?: string }[]; codexFactChanges?: { entry_id?: string }[] };
      const holds = [...(d.codexChanges ?? []), ...(d.codexFactChanges ?? [])].some((c) => c?.entry_id === entryId);
      if (holds) out.push(d.title || d.label || "a draft");
    } catch {
      // not a chapter draft
    }
  }
  return out;
}

function optionFor(ctx: Context, targetId: string, name: string): StartOption & { move: EntryRow[]; status: number } {
  const { start, byId, subtree, rest, startPath, prior } = ctx;
  const t = byId.get(targetId);
  const base = { between: [] as StartItem[], between_facts: 0, leaves: 0, gains: 0, move: [] as EntryRow[], status: 400 };
  if (!t) return { ...base, chapter_id: targetId, title: "", number: 0, relation: "later", allowed: false, reason: "That chapter isn't in this story (or is in the trash)" };
  const head = { chapter_id: t.id, title: t.title, number: t.depth + 1 };
  if (t.id === start.id) return { ...base, ...head, relation: "now", allowed: false, reason: `${name} starts here now` };

  if (startPath.some((c) => c.id === t.id)) {
    // Earlier: always allowed, unless an earlier life of the entry, or another entry of the same name, is in the way.
    if (prior && t.depth <= prior.depth) {
      return { ...base, ...head, relation: "earlier", allowed: false, reason: `${name} was in the codex before, until “${prior.title}”, so it can't start before that` };
    }
    const clash = getCodexState(t.id).find((e) => e.entry_id !== ctx.create.entry_id && e.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (clash) return { ...base, ...head, relation: "earlier", allowed: false, reason: `Another entry called “${clash.name}” is in the codex at that chapter` };
    const between = new Set(startPath.filter((c) => c.depth >= t.depth && c.depth < start.depth).map((c) => c.id));
    const old = subtree(start.id);
    const gains = [...subtree(t.id)].filter((id) => !old.has(id) && !between.has(id)).length;
    return { ...base, ...head, relation: "earlier", allowed: true, gains };
  }

  const targetPath = getPath(t.id);
  if (!targetPath.some((c) => c.id === start.id)) {
    return { ...base, ...head, relation: "later", allowed: false, reason: `“${t.title}” isn't before or after “${start.title}” on one branch` };
  }
  // Later.
  const inBetween = new Set(targetPath.filter((c) => c.depth > start.depth && c.depth < t.depth).map((c) => c.id));
  const oldSub = subtree(start.id);
  const newSub = subtree(t.id);
  const title = (id: string) => byId.get(id)?.title ?? "a chapter";
  const between = rest.filter((r) => inBetween.has(r.anchor_chapter_id));
  const items = between
    .sort((a, b) => (byId.get(a.anchor_chapter_id)?.depth ?? 0) - (byId.get(b.anchor_chapter_id)?.depth ?? 0) || a.posted_at - b.posted_at)
    .map((r) => ({ chapter_id: r.anchor_chapter_id, chapter_title: title(r.anchor_chapter_id), label: rowLabel(r) }));
  const leaves = [...oldSub].filter((id) => !newSub.has(id) && !inBetween.has(id) && id !== start.id).length;
  const betweenFacts = new Set(between.filter((r) => r.kind === "fact" && r.op === "set").map((r) => r.fact_id)).size;
  const later = { ...base, ...head, relation: "later" as const, between: items, between_facts: betweenFacts, leaves, move: between };
  const elsewhere = rest.find((r) => oldSub.has(r.anchor_chapter_id) && !newSub.has(r.anchor_chapter_id) && !inBetween.has(r.anchor_chapter_id));
  if (elsewhere) {
    return { ...later, allowed: false, reason: `${name} is also changed in “${title(elsewhere.anchor_chapter_id)}”, on another branch, which wouldn't have it any more` };
  }
  const removed = between.find((r) => r.kind === "op" && r.op === "retire");
  if (removed) return { ...later, allowed: false, reason: `${name} is removed from the codex in “${title(removed.anchor_chapter_id)}”, before that chapter` };
  const drafts = draftsHolding(ctx.create.entry_id);
  if (drafts.length) return { ...later, allowed: false, reason: `A draft holds changes to ${name} (“${drafts[0]}”). Post or discard it first.` };
  return { ...later, allowed: true };
}

/**
 * The chapters the "First appears in" picker offers: the line through the viewed chapter (from the first chapter to it,
 * then on down while a chapter has only one next chapter), each with whether the entry can start there and why not.
 */
export function entryStartOptions(entryId: string, chapterId: string): EntryStart {
  const ctx = context(entryId, chapterId);
  const name = getCodexState(chapterId).find((e) => e.entry_id === entryId)?.name ?? ctx.create.name;
  const line: StoryChapter[] = ctx.path.flatMap((c) => ctx.byId.get(c.id) ?? []);
  const kidsOf = (id: string) => [...ctx.byId.values()].filter((c) => c.parent_id === id);
  for (let next = kidsOf(line.at(-1)!.id); next.length === 1; next = kidsOf(next[0].id)) line.push(next[0]);
  const options = line.map((c): StartOption => {
    const o = optionFor(ctx, c.id, name);
    return { chapter_id: o.chapter_id, title: o.title, number: o.number, relation: o.relation, allowed: o.allowed, reason: o.reason, between: o.between, between_facts: o.between_facts, leaves: o.leaves, gains: o.gains };
  });
  const facts = (rows: EntryRow[]) => new Set(rows.filter((r) => r.kind === "fact" && r.op === "set").map((r) => r.fact_id)).size;
  return {
    entry_id: entryId,
    name,
    chapter_id: ctx.start.id,
    title: ctx.start.title,
    number: ctx.start.depth + 1,
    first_facts: facts(ctx.first),
    later_facts: facts(ctx.rest.filter((r) => ctx.subtree(ctx.start.id).has(r.anchor_chapter_id))),
    options,
  };
}

export const MoveStartSchema = z.object({
  entry_id: z.string().min(1),
  /** The chapter the entry is viewed at: its start is the last "create" on this chapter's path. */
  from_chapter_id: z.string().min(1),
  to_chapter_id: z.string().min(1),
  /** Moving later: also move the entry's facts and changes on the chapters in between (else they refuse the move). */
  move_between: z.boolean().default(false),
});

/** Moves where an entry first appears (see the top of this file), all or nothing. */
export function moveEntryStart(input: z.infer<typeof MoveStartSchema>): { chapter_id: string; moved: number } {
  return db().transaction(() => {
    const ctx = context(input.entry_id, input.from_chapter_id);
    const name = ctx.create.name;
    const o = optionFor(ctx, input.to_chapter_id, name);
    if (!o.allowed) throw new PostError(o.reason ?? "The entry can't start there", o.relation === "now" ? 409 : o.status);
    if (o.relation === "later" && o.between.length && !input.move_between) {
      throw new StartConflict(`${name} has ${o.between.length} fact${o.between.length === 1 ? "" : "s"} or change${o.between.length === 1 ? "" : "s"} between “${ctx.start.title}” and “${o.title}”. Move them too, or cancel.`, o.between);
    }
    const rows = [...ctx.first, ...(o.relation === "later" ? o.move : [])];
    const ops = rows.filter((r) => r.kind === "op").map((r) => r.id);
    const facts = rows.filter((r) => r.kind === "fact").map((r) => r.id);
    const marks = (ids: string[]) => ids.map(() => "?").join(",");
    db().prepare(`UPDATE codex_ops SET anchor_chapter_id = ? WHERE id IN (${marks(ops)})`).run(o.chapter_id, ...ops);
    db().prepare(`UPDATE codex_ops SET moved_from_chapter_id = ? WHERE id = ?`).run(ctx.start.id, ctx.create.id);
    if (facts.length) db().prepare(`UPDATE codex_facts SET anchor_chapter_id = ? WHERE id IN (${marks(facts)})`).run(o.chapter_id, ...facts);
    // (The entry's icon belongs to no chapter, so it stays as it is.)
    return { chapter_id: o.chapter_id, moved: rows.length };
  })();
}
