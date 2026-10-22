import { db } from "./db";

export type ReviewIssue = {
  chapterId: string;
  title: string;
  depth: number;
  kind: "summary-missing" | "summary-stale";
  message: string;
};

type Row = {
  id: string;
  title: string;
  depth: number;
  revision: number;
  summary: string | null;
  body: string;
  prev_body: string | null;
  prev_summary: string | null;
};

/**
 * Free checks (no AI) on a story's chapters, parents before children. Deleting is permanent, so every
 * chapter row of the story is live.
 */
export function reviewIssues(storyId: string): ReviewIssue[] {
  const rows = db()
    .prepare(
      `SELECT c.id, c.title, c.depth, c.revision, c.summary, c.body,
              r.body AS prev_body, r.summary AS prev_summary
         FROM chapters c
         LEFT JOIN chapter_revisions r ON r.chapter_id = c.id AND r.revision = c.revision - 1
        WHERE c.story_id = ?
        ORDER BY c.depth, c.posted_at, c.rowid`,
    )
    .all(storyId) as Row[];

  const issues: ReviewIssue[] = [];
  for (const c of rows) {
    const base = { chapterId: c.id, title: c.title, depth: c.depth };
    if (c.summary === null || c.summary.trim() === "") {
      issues.push({
        ...base,
        kind: "summary-missing",
        message: "No summary. The AI reads the full text of this chapter instead, or nothing once it's far back.",
      });
    } else if (c.revision > 1 && c.prev_body !== null && c.prev_body !== c.body && c.prev_summary === c.summary) {
      issues.push({ ...base, kind: "summary-stale", message: "The last edit changed the text but not the summary." });
    }
  }
  return issues;
}

/** Chapter id to number of issues, for chapters with at least one. */
export function issueCounts(storyId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of reviewIssues(storyId)) counts.set(i.chapterId, (counts.get(i.chapterId) ?? 0) + 1);
  return counts;
}
