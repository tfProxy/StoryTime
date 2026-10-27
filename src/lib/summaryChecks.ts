// The AI's check of whether a chapter's summary matches the chapter, kept so the same summary isn't checked again.
// Editing a summary does not change the chapter's revision, so the summary text that was checked is kept as well: a
// check only counts while the chapter is at the revision checked AND its summary is still the text checked.
import { z } from "zod";
import { db } from "./db";
import { PostError } from "./stories";

export const PROBLEM_MAX = 200;

export const SaveSummaryCheckSchema = z
  .object({
    revision: z.number().int().min(1),
    summary: z.string().min(1).max(5000),
    verdict: z.enum(["ok", "wrong"]),
    problem: z.string().trim().max(PROBLEM_MAX).optional(),
  })
  .refine((v) => v.verdict !== "wrong" || (v.problem ?? "").length > 0, { message: "Say what does not match" });

export type CurrentSummaryCheck = { chapterId: string; verdict: "ok" | "wrong"; problem: string };

/** Saves (replacing the chapter's earlier one) the check of a summary. 409 when the chapter's revision or summary is no longer the one checked. */
export function saveSummaryCheck(chapterId: string, input: z.infer<typeof SaveSummaryCheckSchema>): { ok: true } {
  return db().transaction(() => {
    const chapter = db().prepare(`SELECT revision, summary FROM chapters WHERE id = ?`).get(chapterId) as { revision: number; summary: string | null } | undefined;
    if (!chapter) throw new PostError("That chapter does not exist", 404);
    if (chapter.revision !== input.revision || chapter.summary !== input.summary) throw new PostError("The chapter or its summary was edited meanwhile", 409);
    db()
      .prepare(
        `INSERT INTO summary_checks (chapter_id, revision, summary, verdict, problem, checked_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (chapter_id) DO UPDATE SET revision = excluded.revision, summary = excluded.summary, verdict = excluded.verdict,
           problem = excluded.problem, checked_at = excluded.checked_at`,
      )
      .run(chapterId, input.revision, input.summary, input.verdict, input.verdict === "wrong" ? (input.problem ?? "") : null, Date.now());
    return { ok: true as const };
  })();
}

/** The checks of a story's chapters that still count (same revision, same summary text). */
export function currentSummaryChecks(storyId: string): CurrentSummaryCheck[] {
  return (
    db()
      .prepare(
        `SELECT k.chapter_id, k.verdict, k.problem
           FROM summary_checks k JOIN chapters c ON c.id = k.chapter_id AND c.revision = k.revision AND c.summary = k.summary
          WHERE c.story_id = ? ORDER BY k.checked_at, k.rowid`,
      )
      .all(storyId) as { chapter_id: string; verdict: "ok" | "wrong"; problem: string | null }[]
  ).map((r) => ({ chapterId: r.chapter_id, verdict: r.verdict, problem: r.problem ?? "" }));
}
