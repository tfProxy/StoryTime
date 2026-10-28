// Moderation operations on the StoryTime database. Plain JavaScript that takes the database
// handle as an argument, so the web admin page and the command-line tool share one
// implementation (the CLI runs on the server without the app's build tooling).
import crypto from "node:crypto";

/** @typedef {import("better-sqlite3").Database} Db */
/** @typedef {"chapter" | "story" | "codex_op" | "choice"} Kind */
/**
 * @typedef {object} ActivityRow
 * @property {Kind} kind
 * @property {string} id
 * @property {string} story_id
 * @property {string} story_title
 * @property {string} label
 * @property {string | null} preview
 * @property {number} at
 */

export const KINDS = /** @type {const} */ (["chapter", "story", "codex_op", "choice"]);

export class AdminError extends Error {}

const TABLE = { chapter: "chapters", story: "stories", codex_op: "codex_ops", choice: "choices" };

/** @param {Kind} kind */
function table(kind) {
  const t = TABLE[kind];
  if (!t) throw new AdminError(`Unknown kind "${kind}". Use one of: ${KINDS.join(", ")}`);
  return t;
}

/** @param {Db} db @param {Kind} kind @param {string} id */
function getRow(db, kind, id) {
  const row = db.prepare(`SELECT * FROM ${table(kind)} WHERE id = ?`).get(id);
  if (!row) throw new AdminError(`No ${kind.replace("_", " ")} with id ${id}`);
  return row;
}

/** Ids of every chapter below (and not including) the given one. */
function descendantIds(db, chapterId) {
  return db
    .prepare(
      `WITH RECURSIVE d(id) AS (
         SELECT c.id FROM choices ch JOIN chapters c ON c.parent_choice_id = ch.id WHERE ch.parent_chapter_id = ?
         UNION ALL
         SELECT c.id FROM d JOIN choices ch ON ch.parent_chapter_id = d.id JOIN chapters c ON c.parent_choice_id = ch.id
       )
       SELECT id FROM d`,
    )
    .all(chapterId)
    .map((r) => r.id);
}

/** @param {Db} db */
export function stats(db) {
  const n = (sql) => db.prepare(sql).get().n;
  return {
    stories: n(`SELECT COUNT(*) AS n FROM stories`),
    chapters: n(`SELECT COUNT(*) AS n FROM chapters`),
    codexOps: n(`SELECT COUNT(*) AS n FROM codex_ops`),
  };
}

/**
 * Newest items across stories, chapters, choices and codex changes, so you can scan what was
 * just posted.
 * @param {Db} db @param {{limit?: number, kind?: Kind, storyId?: string}} [opts]
 * @returns {ActivityRow[]}
 */
export function recentActivity(db, opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const parts = [
    {
      kind: "story",
      sql: `SELECT 'story' AS kind, s.id, s.id AS story_id, s.title AS story_title, s.title AS label,
                   substr(s.premise, 1, 240) AS preview, s.created_at AS at
              FROM stories s`,
    },
    {
      kind: "chapter",
      sql: `SELECT 'chapter' AS kind, c.id, c.story_id, s.title AS story_title, c.title AS label,
                   substr(c.body, 1, 240) AS preview, COALESCE(c.edited_at, c.posted_at) AS at
              FROM chapters c JOIN stories s ON s.id = c.story_id`,
    },
    {
      kind: "choice",
      sql: `SELECT 'choice' AS kind, ch.id, c.story_id, s.title AS story_title, ch.label AS label,
                   'on chapter: ' || c.title AS preview, ch.posted_at AS at
              FROM choices ch JOIN chapters c ON c.id = ch.parent_chapter_id JOIN stories s ON s.id = c.story_id`,
    },
    {
      kind: "codex_op",
      sql: `SELECT 'codex_op' AS kind, o.id, o.story_id, s.title AS story_title,
                   o.op || ': ' || CASE WHEN o.name = '' THEN '(entry)' ELSE o.name END AS label,
                   substr(o.content, 1, 240) AS preview, o.posted_at AS at
              FROM codex_ops o JOIN stories s ON s.id = o.story_id`,
    },
  ].filter((p) => !opts.kind || p.kind === opts.kind);

  const where = [];
  const params = [];
  if (opts.storyId) {
    where.push("story_id = ?");
    params.push(opts.storyId);
  }
  const sql = `SELECT * FROM (${parts.map((p) => p.sql).join(" UNION ALL ")})
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY at DESC LIMIT ?`;
  // One parameter set per UNION part is not needed: filters apply to the wrapped result.
  return /** @type {ActivityRow[]} */ (db.prepare(sql).all(...params, limit));
}

/**
 * Permanently deletes an item. A chapter takes everything below it with it (choices, revisions,
 * and codex changes anchored there) and its incoming choice becomes an unwritten slot again. A
 * choice takes the chapter written for it (and everything below). A story takes all of its
 * contents.
 * @param {Db} db @param {Kind} kind @param {string} id
 */
export function deleteItem(db, kind, id) {
  getRow(db, kind, id);
  if (kind === "chapter" && db.prepare(`SELECT 1 FROM stories WHERE root_chapter_id = ?`).get(id)) {
    throw new AdminError("That is a story's first chapter; delete the story instead.");
  }

  return db.transaction(() => {
    // chapters <-> choices reference each other, so check the constraints only at commit.
    db.pragma("defer_foreign_keys = ON");
    let chapterIds;
    if (kind === "story") {
      chapterIds = db.prepare(`SELECT id FROM chapters WHERE story_id = ?`).all(id).map((r) => r.id);
    } else if (kind === "chapter") {
      chapterIds = [id, ...descendantIds(db, id)];
    } else if (kind === "choice") {
      const child = db.prepare(`SELECT id FROM chapters WHERE parent_choice_id = ?`).get(id);
      chapterIds = child ? [child.id, ...descendantIds(db, child.id)] : [];
    } else {
      chapterIds = [];
    }
    const marks = chapterIds.map(() => "?").join(",");
    let codex = 0;
    if (kind === "story") codex = db.prepare(`DELETE FROM codex_ops WHERE story_id = ?`).run(id).changes;
    else if (kind === "codex_op") codex = db.prepare(`DELETE FROM codex_ops WHERE id = ?`).run(id).changes;
    else if (chapterIds.length) codex = db.prepare(`DELETE FROM codex_ops WHERE anchor_chapter_id IN (${marks})`).run(...chapterIds).changes;
    // Codex facts go with their chapters (or story) too; they aren't counted with the codex changes.
    if (kind === "story") db.prepare(`DELETE FROM codex_facts WHERE story_id = ?`).run(id);
    else if (chapterIds.length) db.prepare(`DELETE FROM codex_facts WHERE anchor_chapter_id IN (${marks})`).run(...chapterIds);
    // AI runs go with their story, or with the chapter they started from (or one below it).
    if (kind === "story") db.prepare(`DELETE FROM ai_runs WHERE story_id = ?`).run(id);
    else if (chapterIds.length) db.prepare(`DELETE FROM ai_runs WHERE start_chapter_id IN (${marks})`).run(...chapterIds);
    if (chapterIds.length) {
      db.prepare(`DELETE FROM chapter_revisions WHERE chapter_id IN (${marks})`).run(...chapterIds);
      db.prepare(`DELETE FROM chapter_images WHERE chapter_id IN (${marks})`).run(...chapterIds);
      db.prepare(`DELETE FROM picture_jobs WHERE chapter_id IN (${marks})`).run(...chapterIds);
      db.prepare(`DELETE FROM choices WHERE parent_chapter_id IN (${marks})`).run(...chapterIds);
      db.prepare(`DELETE FROM chapters WHERE id IN (${marks})`).run(...chapterIds);
    }
    if (kind === "choice") db.prepare(`DELETE FROM choices WHERE id = ?`).run(id);
    if (kind === "story") db.prepare(`DELETE FROM stories WHERE id = ?`).run(id);
    return { chapters: chapterIds.length, codexOps: codex };
  })();
}

/**
 * Puts an earlier revision's text back as the chapter's current version. The version being
 * replaced is kept in the history, so this can itself be undone. Rolling summaries below the
 * chapter are cleared because they were built from the old text.
 * @param {Db} db @param {string} chapterId @param {number} revision
 */
export function revertChapter(db, chapterId, revision) {
  return db.transaction(() => {
    const cur = getRow(db, "chapter", chapterId);
    const old = db.prepare(`SELECT * FROM chapter_revisions WHERE chapter_id = ? AND revision = ?`).get(chapterId, revision);
    if (!old) throw new AdminError(`Chapter has no revision ${revision}`);
    const now = Date.now();
    db.prepare(
      `INSERT INTO chapter_revisions (id, chapter_id, revision, title, body, summary, path_summary, edit_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomBytes(8).toString("base64url"), chapterId, cur.revision, cur.title, cur.body, cur.summary,
      cur.path_summary, cur.edit_note, cur.edited_at ?? cur.posted_at,
    );
    const next = cur.revision + 1;
    db.prepare(
      `UPDATE chapters SET title = ?, body = ?, summary = NULL, path_summary = NULL, revision = ?,
              edited_at = ?, edit_note = ? WHERE id = ?`,
    ).run(old.title, old.body, next, now, `Reverted to revision ${revision}`, chapterId);
    const below = descendantIds(db, chapterId);
    if (below.length) {
      db.prepare(`UPDATE chapters SET path_summary = NULL WHERE id IN (${below.map(() => "?").join(",")})`).run(...below);
    }
    return { revision: next };
  })();
}
