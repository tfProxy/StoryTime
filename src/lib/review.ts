import { z } from "zod";
import { db, newId } from "./db";
import { PostError } from "./stories";

import { storyVerdicts } from "./continuityVerdicts";

export const ISSUE_KINDS = ["summary-missing", "summary-stale", "continuity"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

/** The two sides of a continuity issue: an earlier chapter said one thing, a later one another. */
export type ContinuityDetail = {
  entity: string;
  attribute: string;
  before: { chapterId: string; title: string; value: string; quote: string };
  after: { chapterId: string; title: string; value: string; quote: string };
};

/** open: still to deal with; later: put off (kept on the Review page, left out of the outline count); dismissed: hidden. */
export type IssueStatus = "open" | "later" | "dismissed";

export type ReviewIssue = {
  chapterId: string;
  title: string;
  depth: number;
  kind: IssueKind;
  /** Tells apart several issues of one kind on a chapter; "" when there is only ever one. */
  fingerprint: string;
  message: string;
  status: IssueStatus;
  /** Only on a continuity issue; its chapter is the later one (`after`). */
  continuity?: ContinuityDetail;
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

type Decision = { chapter_id: string; kind: string; fingerprint: string; status: string; revision: number };

/**
 * Free checks (no AI) on a story's chapters, parents before children, with the author's decisions on them.
 * A decision only counts while the chapter is at the revision it was made at. Deleting is permanent, so every
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
  const decisions = new Map(
    (
      db()
        .prepare(
          `SELECT ri.chapter_id, ri.kind, ri.fingerprint, ri.status, ri.revision
             FROM review_items ri JOIN chapters c ON c.id = ri.chapter_id
            WHERE c.story_id = ? AND ri.revision = c.revision`,
        )
        .all(storyId) as Decision[]
    ).map((d) => [`${d.chapter_id}\n${d.kind}\n${d.fingerprint}`, d.status]),
  );
  const statusOf = (chapterId: string, kind: IssueKind, fingerprint: string): IssueStatus => {
    const s = decisions.get(`${chapterId}\n${kind}\n${fingerprint}`);
    return s === "later" || s === "dismissed" ? s : s === "intentional" ? "dismissed" : "open";
  };

  const issues: ReviewIssue[] = [];
  for (const c of rows) {
    const add = (kind: IssueKind, message: string) =>
      issues.push({ chapterId: c.id, title: c.title, depth: c.depth, kind, fingerprint: "", message, status: statusOf(c.id, kind, "") });
    if (c.summary === null || c.summary.trim() === "") {
      add("summary-missing", "No summary. The AI reads the full text of this chapter instead, or nothing once it's far back.");
    } else if (c.revision > 1 && c.prev_body !== null && c.prev_body !== c.body && c.prev_summary === c.summary) {
      add("summary-stale", "The last edit changed the text but not the summary.");
    }
  }

  // Continuity: the clashes the AI judged a contradiction, while both chapters are still as they were read.
  const byId = new Map(rows.map((c) => [c.id, c]));
  for (const v of storyVerdicts(storyId)) {
    if (v.verdict !== "contradiction") continue;
    const before = byId.get(v.before.chapterId);
    const after = byId.get(v.after.chapterId);
    if (!before || !after || before.revision !== v.before.revision || after.revision !== v.after.revision) continue;
    issues.push({
      chapterId: after.id,
      title: after.title,
      depth: after.depth,
      kind: "continuity",
      fingerprint: v.fingerprint,
      message: `${v.entity}, ${v.attribute}: “${v.before.value}” in “${before.title}”, then “${v.after.value}” in “${after.title}”.`,
      status: statusOf(after.id, "continuity", v.fingerprint),
      continuity: {
        entity: v.entity,
        attribute: v.attribute,
        before: { chapterId: before.id, title: before.title, value: v.before.value, quote: v.before.quote },
        after: { chapterId: after.id, title: after.title, value: v.after.value, quote: v.after.quote },
      },
    });
  }
  return issues;
}

/** Chapter id to number of open issues, for chapters with at least one. Put-off and dismissed ones don't count. */
export function issueCounts(storyId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of reviewIssues(storyId)) if (i.status === "open") counts.set(i.chapterId, (counts.get(i.chapterId) ?? 0) + 1);
  return counts;
}

export const DecideIssueSchema = z.object({
  kind: z.enum(ISSUE_KINDS),
  fingerprint: z.string().max(200).default(""),
  /** open undoes an earlier decision. */
  status: z.enum(["open", "later", "dismissed"]),
});

/** Records (or with status open, forgets) the author's decision on one issue, at the chapter's current revision. */
export function decideIssue(chapterId: string, input: z.infer<typeof DecideIssueSchema>): void {
  db().transaction(() => {
    const chapter = db().prepare(`SELECT revision FROM chapters WHERE id = ?`).get(chapterId) as { revision: number } | undefined;
    if (!chapter) throw new PostError("That chapter does not exist", 404);
    if (input.status === "open") {
      db().prepare(`DELETE FROM review_items WHERE chapter_id = ? AND kind = ? AND fingerprint = ?`).run(chapterId, input.kind, input.fingerprint);
      return;
    }
    db()
      .prepare(
        `INSERT INTO review_items (id, chapter_id, kind, fingerprint, status, revision, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (chapter_id, kind, fingerprint) DO UPDATE SET status = excluded.status, revision = excluded.revision, decided_at = excluded.decided_at`,
      )
      .run(newId(), chapterId, input.kind, input.fingerprint, input.status, chapter.revision, Date.now());
  })();
}
