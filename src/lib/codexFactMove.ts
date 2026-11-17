import { z } from "zod";
import { db } from "./db";
import { DRAFT_ANCHOR, isDraftEntry, isFormAspect } from "./codex";
import { getCodexOps } from "./codexDb";
import { getStoryChapters, type StoryChapter } from "./tree";
import { getPath, PostError } from "./stories";

// Moving a fact to an earlier chapter: the change that sets it (one codex_facts row, the one the entry's page shows) is
// re-anchored at a chapter before it on the same line, so the fact holds from there on, as if it had been entered there.
//
// Only that row moves; the fact's earlier and later changes stay where they are. It can't move to or past another
// change of the same fact (or another fact for the same aspect and form) on the way back, which would then come after
// it and hide it, nor before the chapter where the entry first appears. Chapters on other branches that split off on
// the way back get the fact too; the dialog counts them.

type FactRow = {
  id: string;
  story_id: string;
  entry_id: string;
  fact_id: string;
  anchor_chapter_id: string;
  op: string;
  aspect: string;
  form: string;
  text: string;
};

export type FactMoveOption = {
  chapter_id: string;
  title: string;
  /** Ch. N: the chapter's place on the line, from 1. */
  number: number;
  relation: "now" | "earlier";
  allowed: boolean;
  /** Why it can't be chosen. */
  reason?: string;
  /** Chapters on other branches that would have the fact from then on. */
  gains: number;
};

export type FactMove = {
  entry_id: string;
  fact_op_id: string;
  /** "Hair (vixen): long red hair", for the dialog. */
  label: string;
  chapter_id: string;
  title: string;
  number: number;
  options: FactMoveOption[];
};

const factLabel = (r: FactRow) =>
  isFormAspect(r.aspect) ? `Form: ${[r.form, r.text].filter(Boolean).join(", ")}` : r.aspect.trim() ? `${r.aspect.trim()}${r.form ? ` (${r.form})` : ""}: ${r.text}` : r.text;
const slotOf = (r: FactRow) => `${r.aspect.trim().toLowerCase()}\n${r.form.trim().toLowerCase()}`;

function context(entryId: string, factOpId: string, chapterId: string) {
  if (chapterId === DRAFT_ANCHOR) throw new PostError("This chapter isn't posted yet. Post it first, then move the fact.", 400);
  if (isDraftEntry(entryId)) throw new PostError("This entry is only in a draft so far. Post the chapter first, then move the fact.", 400);
  const row = db().prepare(`SELECT id, story_id, entry_id, fact_id, anchor_chapter_id, op, aspect, form, text FROM codex_facts WHERE id = ? AND entry_id = ?`).get(factOpId, entryId) as
    | FactRow
    | undefined;
  // A shared entry's own facts live with the shared entry, not in the story.
  if (!row) throw new PostError("That fact isn't in this story's codex (a shared entry's facts can't be moved)", 404);
  if (row.op !== "set") throw new PostError("Only a fact that is set can be moved", 409);
  const path = getPath(chapterId);
  if (path.length === 0) throw new PostError("That chapter does not exist", 404);
  if (path[0].story_id !== row.story_id) throw new PostError("That fact belongs to another story", 400);
  if (!path.some((c) => c.id === row.anchor_chapter_id)) throw new PostError("That fact isn't set on this branch", 409);
  const create = getCodexOps(chapterId)
    .filter((o) => o.entry_id === entryId && o.op === "create")
    .at(-1);
  if (!create) throw new PostError("That entry doesn't start on this branch", 409);

  const chapters = getStoryChapters(row.story_id);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const anchor = byId.get(row.anchor_chapter_id);
  const start = byId.get(create.anchor_chapter_id);
  if (!anchor) throw new PostError("The chapter where the fact is set is in the trash", 409);
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
  // The line back from the fact's chapter, and the entry's other rows that could stand in the way.
  const line = getPath(anchor.id).flatMap((c) => byId.get(c.id) ?? []);
  const others = (db().prepare(`SELECT id, story_id, entry_id, fact_id, anchor_chapter_id, op, aspect, form, text FROM codex_facts WHERE story_id = ? AND entry_id = ? AND id != ?`).all(row.story_id, entryId, row.id) as FactRow[]).filter(
    (r) => r.fact_id === row.fact_id || (row.aspect.trim() !== "" && r.op === "set" && slotOf(r) === slotOf(row)),
  );
  return { row, anchor, start, line, byId, subtree, others };
}

type Context = ReturnType<typeof context>;

function optionFor(ctx: Context, target: StoryChapter): FactMoveOption {
  const { row, anchor, start, byId, subtree, others } = ctx;
  const head = { chapter_id: target.id, title: target.title, number: target.depth + 1, gains: 0 };
  if (target.id === anchor.id) return { ...head, relation: "now", allowed: false, reason: "It is set here now" };
  if (target.depth < start.depth) return { ...head, relation: "earlier", allowed: false, reason: `The entry first appears in “${start.title}”; move that first to go earlier` };
  // The chapters the fact would now cover on this line, from the target up to (not including) its chapter.
  const covered = new Set(ctx.line.filter((c) => c.depth >= target.depth && c.depth < anchor.depth).map((c) => c.id));
  const clash = others
    .filter((r) => covered.has(r.anchor_chapter_id))
    .sort((a, b) => (byId.get(b.anchor_chapter_id)?.depth ?? 0) - (byId.get(a.anchor_chapter_id)?.depth ?? 0))[0];
  if (clash) {
    const where = byId.get(clash.anchor_chapter_id)?.title ?? "a chapter";
    const what = clash.fact_id !== row.fact_id ? `${factLabel(clash)} is set` : clash.op === "retire" ? "It is removed" : `It is set to “${clash.text}”`;
    return { ...head, relation: "earlier", allowed: false, reason: `${what} in “${where}”, so it can't move ${clash.anchor_chapter_id === target.id ? "there" : "before that"}` };
  }
  const old = subtree(anchor.id);
  const gains = [...subtree(target.id)].filter((id) => !old.has(id) && !covered.has(id)).length;
  return { ...head, relation: "earlier", allowed: true, gains };
}

/** The chapters a fact can move back to: the line from where the entry starts to the fact's chapter, each with why not. */
export function factMoveOptions(entryId: string, factOpId: string, chapterId: string): FactMove {
  const ctx = context(entryId, factOpId, chapterId);
  return {
    entry_id: entryId,
    fact_op_id: factOpId,
    label: factLabel(ctx.row),
    chapter_id: ctx.anchor.id,
    title: ctx.anchor.title,
    number: ctx.anchor.depth + 1,
    options: ctx.line.filter((c) => c.depth >= ctx.start.depth).map((c) => optionFor(ctx, c)),
  };
}

export const MoveFactSchema = z.object({
  entry_id: z.string().min(1),
  /** The codex_facts row that sets the fact, as the entry's page shows it at `from_chapter_id`. */
  fact_op_id: z.string().min(1),
  from_chapter_id: z.string().min(1),
  to_chapter_id: z.string().min(1),
});

/** Moves the change that sets a fact to an earlier chapter on its line (see the top of this file). */
export function moveFact(input: z.infer<typeof MoveFactSchema>): { chapter_id: string } {
  return db().transaction(() => {
    const ctx = context(input.entry_id, input.fact_op_id, input.from_chapter_id);
    const target = ctx.line.find((c) => c.id === input.to_chapter_id);
    if (!target) throw new PostError("That chapter isn't before the fact on this branch", 400);
    const o = optionFor(ctx, target);
    if (!o.allowed) throw new PostError(o.reason ?? "The fact can't move there", 409);
    db().prepare(`UPDATE codex_facts SET anchor_chapter_id = ? WHERE id = ?`).run(target.id, ctx.row.id);
    return { chapter_id: target.id };
  })();
}
