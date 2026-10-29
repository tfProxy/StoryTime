import { z } from "zod";
import { db, newId } from "./db";
import { PostError } from "./stories";

import { storyVerdicts } from "./continuityVerdicts";
import { CODEX_LIMITS, createCodexOp, getCodexState } from "./codexDb";
import { currentSummaryChecks } from "./summaryChecks";

export const ISSUE_KINDS = ["summary-missing", "summary-stale", "summary-wrong", "continuity", "codex-missing", "ai-unreviewed"] as const;
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
  /** Set when the author marked the issue intentional (its status is then "dismissed"): why it is on purpose. */
  intentionalNote?: string;
  /** Only on a continuity issue; its chapter is the later one (`after`). */
  continuity?: ContinuityDetail;
};

type Row = {
  id: string;
  parent_id: string | null;
  title: string;
  depth: number;
  revision: number;
  summary: string | null;
  body: string;
  prev_body: string | null;
  prev_summary: string | null;
  ai_run_id: string | null;
  ai_reviewed_at: number | null;
  ai_owned_at: number | null;
};

type Decision = { chapter_id: string; kind: string; fingerprint: string; status: string; revision: number; note: string | null };

/**
 * Free checks (no AI) on a story's chapters, parents before children, with the author's decisions on them.
 * A decision only counts while the chapter is at the revision it was made at. Deleting is permanent, so every
 * chapter row of the story is live.
 */
export function reviewIssues(storyId: string): ReviewIssue[] {
  const rows = db()
    .prepare(
      `SELECT c.id, ch.parent_chapter_id AS parent_id, c.title, c.depth, c.revision, c.summary, c.body,
              r.body AS prev_body, r.summary AS prev_summary, c.ai_run_id, c.ai_reviewed_at, c.ai_owned_at
         FROM chapters c
         LEFT JOIN choices ch ON ch.id = c.parent_choice_id
         LEFT JOIN chapter_revisions r ON r.chapter_id = c.id AND r.revision = c.revision - 1
        WHERE c.story_id = ? AND c.trashed_at IS NULL
        ORDER BY c.depth, c.posted_at, c.rowid`,
    )
    .all(storyId) as Row[];
  const decisions = new Map(
    (
      db()
        .prepare(
          `SELECT ri.chapter_id, ri.kind, ri.fingerprint, ri.status, ri.revision, ri.note
             FROM review_items ri JOIN chapters c ON c.id = ri.chapter_id
            WHERE c.story_id = ? AND c.trashed_at IS NULL AND ri.revision = c.revision`,
        )
        .all(storyId) as Decision[]
    ).map((d) => [`${d.chapter_id}\n${d.kind}\n${d.fingerprint}`, d]),
  );
  const statusOf = (chapterId: string, kind: IssueKind, fingerprint: string): IssueStatus => {
    const s = decisions.get(`${chapterId}\n${kind}\n${fingerprint}`)?.status;
    return s === "later" || s === "dismissed" ? s : s === "intentional" ? "dismissed" : "open";
  };
  const noteOf = (chapterId: string, kind: IssueKind, fingerprint: string): string | undefined => {
    const d = decisions.get(`${chapterId}\n${kind}\n${fingerprint}`);
    return d?.status === "intentional" ? (d.note ?? "") : undefined;
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
    if (c.ai_run_id !== null && c.ai_reviewed_at === null && c.ai_owned_at === null) {
      add("ai-unreviewed", "Written by AI and not read yet.");
    }
  }

  // Summaries the AI found don't match their chapter (a check counts while the chapter and its summary are as checked).
  const rowOf = new Map(rows.map((c) => [c.id, c]));
  for (const k of currentSummaryChecks(storyId)) {
    const c = rowOf.get(k.chapterId);
    if (!c || k.verdict !== "wrong") continue;
    issues.push({
      chapterId: c.id,
      title: c.title,
      depth: c.depth,
      kind: "summary-wrong",
      fingerprint: "",
      message: `The summary doesn't match the chapter: ${k.problem}`,
      status: statusOf(c.id, "summary-wrong", ""),
    });
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
      intentionalNote: noteOf(after.id, "continuity", v.fingerprint),
      continuity: {
        entity: v.entity,
        attribute: v.attribute,
        before: { chapterId: before.id, title: before.title, value: v.before.value, quote: v.before.quote },
        after: { chapterId: after.id, title: after.title, value: v.after.value, quote: v.after.quote },
      },
    });
  }

  issues.push(...codexGaps(storyId, rows, statusOf));
  return issues;
}

/** An entity name as compared for codex gaps: lowercase, spaces collapsed, no leading "the ". */
function normaliseEntity(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim().replace(/^the /, "");
}

/**
 * Entities the facts name in two or more chapters on one path that the codex (at the later chapter) has no entry for.
 * One issue per entity and first chapter, anchored at the first appearance. Needs no AI.
 */
function codexGaps(
  storyId: string,
  rows: { id: string; parent_id: string | null; title: string; depth: number }[],
  statusOf: (chapterId: string, kind: IssueKind, fingerprint: string) => IssueStatus,
): ReviewIssue[] {
  const factRows = db()
    .prepare(
      `SELECT f.chapter_id, f.entity
         FROM chapter_facts f JOIN chapters c ON c.id = f.chapter_id AND c.revision = f.revision
        WHERE c.story_id = ? AND c.trashed_at IS NULL ORDER BY f.rowid`,
    )
    .all(storyId) as { chapter_id: string; entity: string }[];
  if (factRows.length === 0) return [];
  const entitiesOf = new Map<string, Map<string, string>>();
  for (const f of factRows) {
    const norm = normaliseEntity(f.entity);
    if (norm.length < 2) continue;
    let m = entitiesOf.get(f.chapter_id);
    if (!m) entitiesOf.set(f.chapter_id, (m = new Map()));
    if (!m.has(norm)) m.set(norm, f.entity.trim());
  }
  if (entitiesOf.size === 0) return [];

  type Seen = { first: string; written: string; count: number };
  const seenAt = new Map<string, Map<string, Seen>>();
  const codexCache = new Map<string, Set<string>>();
  const namesAt = (chapterId: string) => {
    let names = codexCache.get(chapterId);
    if (!names) {
      names = new Set<string>();
      for (const e of getCodexState(chapterId)) for (const n of [e.name, ...e.aliases]) names.add(normaliseEntity(n));
      codexCache.set(chapterId, names);
    }
    return names;
  };
  const byId = new Map(rows.map((c) => [c.id, c]));
  const found = new Map<string, Seen & { norm: string }>();
  for (const c of rows) {
    const seen = new Map<string, Seen>();
    for (const [k, v] of c.parent_id ? (seenAt.get(c.parent_id) ?? []) : []) seen.set(k, v);
    for (const [norm, written] of entitiesOf.get(c.id) ?? []) {
      const prior = seen.get(norm);
      if (!prior) {
        seen.set(norm, { first: c.id, written, count: 1 });
        continue;
      }
      const next = { ...prior, count: prior.count + 1 };
      seen.set(norm, next);
      const key = `${prior.first}\n${norm}`;
      const already = found.get(key);
      if (already) already.count = Math.max(already.count, next.count);
      else if (!namesAt(c.id).has(norm)) found.set(key, { ...next, norm });
    }
    seenAt.set(c.id, seen);
  }
  const out: ReviewIssue[] = [];
  for (const g of found.values()) {
    const first = byId.get(g.first)!;
    out.push({
      chapterId: first.id,
      title: first.title,
      depth: first.depth,
      kind: "codex-missing",
      fingerprint: g.norm,
      message: `“${g.written}” comes up in ${g.count} chapters on this path but has no codex entry.`,
      status: statusOf(first.id, "codex-missing", g.norm),
    });
  }
  return out;
}

/**
 * Chapter id to number of open issues, for chapters with at least one. Put-off and dismissed ones don't count.
 * ai-unreviewed issues are left out: the AI mark already shows on the outline.
 */
export function issueCounts(storyId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of reviewIssues(storyId)) if (i.status === "open" && i.kind !== "ai-unreviewed") counts.set(i.chapterId, (counts.get(i.chapterId) ?? 0) + 1);
  return counts;
}

export const NOTE_MAX = 200;

export const DecideIssueSchema = z
  .object({
    kind: z.enum(ISSUE_KINDS),
    fingerprint: z.string().max(200).default(""),
    /** open undoes an earlier decision; intentional (continuity only) needs a note. */
    status: z.enum(["open", "later", "dismissed", "intentional"]),
    note: z.string().trim().max(NOTE_MAX).optional(),
  })
  .refine((v) => v.status !== "intentional" || v.kind === "continuity", { message: "Only a continuity issue can be marked intentional" })
  .refine((v) => v.status !== "intentional" || (v.note ?? "").length > 0, { message: "Say why it is on purpose" });

/** The codex entry named `entity` (case-insensitive) that is live at the chapter, if any. */
export function codexEntryFor(chapterId: string, entity: string) {
  const name = entity.trim().toLowerCase();
  return getCodexState(chapterId).find((e) => e.name.trim().toLowerCase() === name) ?? null;
}

/**
 * Records (or with status open, forgets) the author's decision on one issue, at the chapter's current revision.
 * An intentional decision also appends its note to the matching codex entry, as a replace op anchored at the
 * chapter; with no such entry only the decision is kept. Returns the name of the entry that got the note.
 */
export function decideIssue(chapterId: string, input: z.infer<typeof DecideIssueSchema>): { codex_entry: string | null } {
  return db().transaction(() => {
    const chapter = db().prepare(`SELECT revision FROM chapters WHERE id = ?`).get(chapterId) as { revision: number } | undefined;
    if (!chapter) throw new PostError("That chapter does not exist", 404);
    if (input.status === "open") {
      db().prepare(`DELETE FROM review_items WHERE chapter_id = ? AND kind = ? AND fingerprint = ?`).run(chapterId, input.kind, input.fingerprint);
      return { codex_entry: null };
    }
    const intentional = input.status === "intentional";
    let codexEntry: string | null = null;
    if (intentional) {
      const verdict = storyVerdicts(
        (db().prepare(`SELECT story_id FROM chapters WHERE id = ?`).get(chapterId) as { story_id: string }).story_id,
      ).find((v) => v.fingerprint === input.fingerprint && v.after.chapterId === chapterId);
      const entry = verdict ? codexEntryFor(chapterId, verdict.entity) : null;
      if (verdict && entry) {
        const added = `Intentional (${verdict.attribute}): ${input.note}`;
        const content = entry.content.trim() ? `${entry.content.trim()}\n\n${added}` : added;
        if (content.length <= CODEX_LIMITS.content) {
          createCodexOp({
            anchor_chapter_id: chapterId,
            op: "replace",
            entry_id: entry.entry_id,
            name: entry.name,
            type: entry.type,
            aliases: entry.aliases,
            content,
            always_include: entry.always_include,
          });
          codexEntry = entry.name;
        }
      }
    }
    db()
      .prepare(
        `INSERT INTO review_items (id, chapter_id, kind, fingerprint, status, revision, note, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (chapter_id, kind, fingerprint) DO UPDATE SET status = excluded.status, revision = excluded.revision, note = excluded.note, decided_at = excluded.decided_at`,
      )
      .run(newId(), chapterId, input.kind, input.fingerprint, input.status, chapter.revision, intentional ? input.note : null, Date.now());
    return { codex_entry: codexEntry };
  })();
}
