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
 * @property {string} author
 * @property {number} at
 * @property {number | null} removed_at
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

/** Ids of every chapter below (and not including) the given one, removed or not. */
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
    stories: n(`SELECT COUNT(*) AS n FROM stories WHERE removed_at IS NULL`),
    chapters: n(`SELECT COUNT(*) AS n FROM chapters WHERE removed_at IS NULL`),
    codexOps: n(`SELECT COUNT(*) AS n FROM codex_ops WHERE removed_at IS NULL`),
    removed:
      n(`SELECT COUNT(*) AS n FROM stories WHERE removed_at IS NOT NULL`) +
      n(`SELECT COUNT(*) AS n FROM chapters WHERE removed_at IS NOT NULL`) +
      n(`SELECT COUNT(*) AS n FROM codex_ops WHERE removed_at IS NOT NULL`) +
      n(`SELECT COUNT(*) AS n FROM choices WHERE removed_at IS NOT NULL`),
  };
}

/**
 * Newest items across stories, chapters, choices and codex changes (removed ones included,
 * flagged), so a moderator can scan what was just posted.
 * @param {Db} db @param {{limit?: number, kind?: Kind, storyId?: string, removedOnly?: boolean}} [opts]
 * @returns {ActivityRow[]}
 */
export function recentActivity(db, opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const parts = [
    {
      kind: "story",
      sql: `SELECT 'story' AS kind, s.id, s.id AS story_id, s.title AS story_title, s.title AS label,
                   substr(s.premise, 1, 240) AS preview, s.author_name AS author, s.created_at AS at, s.removed_at
              FROM stories s`,
    },
    {
      kind: "chapter",
      sql: `SELECT 'chapter' AS kind, c.id, c.story_id, s.title AS story_title, c.title AS label,
                   substr(c.body, 1, 240) AS preview, c.author_name AS author, COALESCE(c.edited_at, c.posted_at) AS at, c.removed_at
              FROM chapters c JOIN stories s ON s.id = c.story_id`,
    },
    {
      kind: "choice",
      sql: `SELECT 'choice' AS kind, ch.id, c.story_id, s.title AS story_title, ch.label AS label,
                   'on chapter: ' || c.title AS preview, ch.author_name AS author, ch.posted_at AS at, ch.removed_at
              FROM choices ch JOIN chapters c ON c.id = ch.parent_chapter_id JOIN stories s ON s.id = c.story_id`,
    },
    {
      kind: "codex_op",
      sql: `SELECT 'codex_op' AS kind, o.id, o.story_id, s.title AS story_title,
                   o.op || ': ' || CASE WHEN o.name = '' THEN '(entry)' ELSE o.name END AS label,
                   substr(o.content, 1, 240) AS preview, o.author_name AS author, o.posted_at AS at, o.removed_at
              FROM codex_ops o JOIN stories s ON s.id = o.story_id`,
    },
  ].filter((p) => !opts.kind || p.kind === opts.kind);

  const where = [];
  const params = [];
  if (opts.removedOnly) where.push("removed_at IS NOT NULL");
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
 * Hides an item. Removing a chapter hides everything below it; the choice that led to it
 * becomes an unwritten slot again. Removing a choice also removes the chapter written for it.
 * @param {Db} db @param {Kind} kind @param {string} id
 */
export function remove(db, kind, id) {
  const row = getRow(db, kind, id);
  const now = Date.now();
  return db.transaction(() => {
    if (row.removed_at) return { changed: false, hidden: 0 };
    db.prepare(`UPDATE ${table(kind)} SET removed_at = ? WHERE id = ?`).run(now, id);
    let hidden = 0;
    if (kind === "chapter") hidden = descendantIds(db, id).length;
    if (kind === "choice") {
      db.prepare(`UPDATE chapters SET removed_at = ? WHERE parent_choice_id = ? AND removed_at IS NULL`).run(now, id);
    }
    return { changed: true, hidden };
  })();
}

/**
 * Brings back something removed. Restoring a chapter fails if someone has since written another
 * chapter for the same choice.
 * @param {Db} db @param {Kind} kind @param {string} id
 */
export function restore(db, kind, id) {
  const row = getRow(db, kind, id);
  if (!row.removed_at) return { changed: false, note: null };
  try {
    db.prepare(`UPDATE ${table(kind)} SET removed_at = NULL WHERE id = ?`).run(id);
  } catch (e) {
    if (e && String(e.code).startsWith("SQLITE_CONSTRAINT")) {
      throw new AdminError("Can't restore: someone has since written a different chapter for that choice.");
    }
    throw e;
  }
  let note = null;
  if (kind === "chapter" && row.parent_choice_id) {
    const parent = db
      .prepare(`SELECT c.removed_at FROM choices ch JOIN chapters c ON c.id = ch.parent_chapter_id WHERE ch.id = ?`)
      .get(row.parent_choice_id);
    if (parent?.removed_at) note = "Restored, but it stays hidden because the chapter before it is still removed.";
  }
  return { changed: true, note };
}

/**
 * Permanently deletes a removed chapter and everything below it (choices, revisions, and codex
 * changes anchored there), or a removed story and all of its contents.
 * @param {Db} db @param {"chapter" | "story"} kind @param {string} id
 */
export function hardDelete(db, kind, id) {
  if (kind !== "chapter" && kind !== "story") throw new AdminError("Only chapters and stories can be deleted permanently");
  const row = getRow(db, kind, id);
  if (!row.removed_at) throw new AdminError("Remove it first; only removed items can be deleted permanently.");

  return db.transaction(() => {
    // chapters <-> choices reference each other, so check the constraints only at commit.
    db.pragma("defer_foreign_keys = ON");
    let chapterIds;
    if (kind === "story") {
      chapterIds = db.prepare(`SELECT id FROM chapters WHERE story_id = ?`).all(id).map((r) => r.id);
    } else {
      chapterIds = [id, ...descendantIds(db, id)];
    }
    const marks = chapterIds.map(() => "?").join(",");
    let codex = 0;
    if (kind === "story") codex = db.prepare(`DELETE FROM codex_ops WHERE story_id = ?`).run(id).changes;
    else if (chapterIds.length) codex = db.prepare(`DELETE FROM codex_ops WHERE anchor_chapter_id IN (${marks})`).run(...chapterIds).changes;
    if (chapterIds.length) {
      db.prepare(`DELETE FROM chapter_revisions WHERE chapter_id IN (${marks})`).run(...chapterIds);
      db.prepare(`DELETE FROM choices WHERE parent_chapter_id IN (${marks})`).run(...chapterIds);
      db.prepare(`DELETE FROM chapters WHERE id IN (${marks})`).run(...chapterIds);
    }
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
      `INSERT INTO chapter_revisions (id, chapter_id, revision, title, body, summary, path_summary, author_name, edited_by, edit_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomBytes(8).toString("base64url"), chapterId, cur.revision, cur.title, cur.body, cur.summary,
      cur.path_summary, cur.author_name, cur.edited_by, cur.edit_note, cur.edited_at ?? cur.posted_at,
    );
    const next = cur.revision + 1;
    db.prepare(
      `UPDATE chapters SET title = ?, body = ?, summary = NULL, path_summary = NULL, revision = ?,
              edited_at = ?, edited_by = 'admin', edit_note = ? WHERE id = ?`,
    ).run(old.title, old.body, next, now, `Reverted to revision ${revision}`, chapterId);
    const below = descendantIds(db, chapterId);
    if (below.length) {
      db.prepare(`UPDATE chapters SET path_summary = NULL WHERE id IN (${below.map(() => "?").join(",")})`).run(...below);
    }
    return { revision: next };
  })();
}
