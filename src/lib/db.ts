import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Schema notes:
// - Every chapter edit first copies the previous version into chapter_revisions, so nothing is
//   ever lost.
// - The author_name, edited_by and edit_key_hash columns date from when the app had several
//   writers; migration 4 drops them.
// - A choice's child is the chapter whose parent_choice_id points at it. A choice with no
//   child is an "unwritten" slot. The unique index allows only one child per choice.
// - Deleting (scripts/admin.mjs) removes rows for good. Earlier versions only flagged rows with
//   `removed_at`; migration 3 deletes anything that was flagged and drops the column.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE stories (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    premise         TEXT NOT NULL DEFAULT '',
    author_name     TEXT NOT NULL DEFAULT '',
    root_chapter_id TEXT,
    created_at      INTEGER NOT NULL,
    removed_at      INTEGER
  );

  CREATE TABLE chapters (
    id               TEXT PRIMARY KEY,
    story_id         TEXT NOT NULL REFERENCES stories(id),
    parent_choice_id TEXT REFERENCES choices(id),
    depth            INTEGER NOT NULL,
    title            TEXT NOT NULL,
    body             TEXT NOT NULL,
    summary          TEXT,
    path_summary     TEXT,
    author_name      TEXT NOT NULL DEFAULT '',
    posted_at        INTEGER NOT NULL,
    removed_at       INTEGER
  );
  CREATE UNIQUE INDEX chapters_one_child_per_choice
    ON chapters(parent_choice_id) WHERE parent_choice_id IS NOT NULL AND removed_at IS NULL;
  CREATE INDEX chapters_story ON chapters(story_id, posted_at);

  CREATE TABLE choices (
    id                TEXT PRIMARY KEY,
    parent_chapter_id TEXT NOT NULL REFERENCES chapters(id),
    label             TEXT NOT NULL,
    author_name       TEXT NOT NULL DEFAULT '',
    posted_at         INTEGER NOT NULL,
    removed_at        INTEGER
  );
  CREATE INDEX choices_parent ON choices(parent_chapter_id, posted_at);

  -- Append-only codex timeline. An op anchored at a chapter applies to that chapter and
  -- all of its descendants. State at a chapter = fold of ops on the root->chapter path,
  -- ordered by anchor depth, then posted_at.
  CREATE TABLE codex_ops (
    id                TEXT PRIMARY KEY,
    story_id          TEXT NOT NULL REFERENCES stories(id),
    anchor_chapter_id TEXT NOT NULL REFERENCES chapters(id),
    entry_id          TEXT NOT NULL,
    op                TEXT NOT NULL CHECK (op IN ('create','replace','retire')),
    name              TEXT NOT NULL DEFAULT '',
    type              TEXT NOT NULL DEFAULT 'note',
    aliases           TEXT NOT NULL DEFAULT '[]',
    content           TEXT NOT NULL DEFAULT '',
    always_include    INTEGER NOT NULL DEFAULT 0,
    author_name       TEXT NOT NULL DEFAULT '',
    posted_at         INTEGER NOT NULL,
    removed_at        INTEGER
  );
  CREATE INDEX codex_ops_anchor ON codex_ops(anchor_chapter_id, posted_at);
  CREATE INDEX codex_ops_entry ON codex_ops(story_id, entry_id);
  `,
  // 2: editable chapters with revision history
  `
  ALTER TABLE chapters ADD COLUMN edit_key_hash TEXT;
  ALTER TABLE chapters ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE chapters ADD COLUMN edited_at INTEGER;
  ALTER TABLE chapters ADD COLUMN edited_by TEXT NOT NULL DEFAULT '';
  ALTER TABLE chapters ADD COLUMN edit_note TEXT;

  -- Each row is a superseded version of a chapter (the live version is the chapters row).
  CREATE TABLE chapter_revisions (
    id           TEXT PRIMARY KEY,
    chapter_id   TEXT NOT NULL REFERENCES chapters(id),
    revision     INTEGER NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    summary      TEXT,
    path_summary TEXT,
    author_name  TEXT NOT NULL DEFAULT '',
    edited_by    TEXT NOT NULL DEFAULT '',
    edit_note    TEXT,
    created_at   INTEGER NOT NULL,
    UNIQUE (chapter_id, revision)
  );
  `,
  // 3: deleting is permanent, so drop the removed_at flag. Anything flagged (and everything
  // below a flagged chapter, or inside a flagged story) was hidden from readers, so delete it.
  `
  PRAGMA defer_foreign_keys = ON;

  CREATE TEMP TABLE doomed(id TEXT PRIMARY KEY);
  WITH RECURSIVE d(id) AS (
    SELECT id FROM chapters WHERE removed_at IS NOT NULL
    UNION
    SELECT id FROM chapters WHERE story_id IN (SELECT id FROM stories WHERE removed_at IS NOT NULL)
    UNION
    SELECT c.id FROM d
      JOIN choices ch ON ch.parent_chapter_id = d.id
      JOIN chapters c ON c.parent_choice_id = ch.id
  )
  INSERT INTO doomed SELECT id FROM d;

  DELETE FROM codex_ops
    WHERE removed_at IS NOT NULL OR anchor_chapter_id IN (SELECT id FROM doomed)
       OR story_id IN (SELECT id FROM stories WHERE removed_at IS NOT NULL);
  DELETE FROM chapter_revisions WHERE chapter_id IN (SELECT id FROM doomed);
  DELETE FROM choices WHERE removed_at IS NOT NULL OR parent_chapter_id IN (SELECT id FROM doomed);
  DELETE FROM chapters WHERE id IN (SELECT id FROM doomed);
  DELETE FROM stories WHERE removed_at IS NOT NULL OR root_chapter_id IN (SELECT id FROM doomed);
  DROP TABLE doomed;

  DROP INDEX chapters_one_child_per_choice;
  ALTER TABLE stories DROP COLUMN removed_at;
  ALTER TABLE chapters DROP COLUMN removed_at;
  ALTER TABLE choices DROP COLUMN removed_at;
  ALTER TABLE codex_ops DROP COLUMN removed_at;
  CREATE UNIQUE INDEX chapters_one_child_per_choice
    ON chapters(parent_choice_id) WHERE parent_choice_id IS NOT NULL;
  `,
  // 4: the app has one user, so nothing records who wrote or edited anything.
  `
  ALTER TABLE stories DROP COLUMN author_name;
  ALTER TABLE chapters DROP COLUMN author_name;
  ALTER TABLE chapters DROP COLUMN edit_key_hash;
  ALTER TABLE chapters DROP COLUMN edited_by;
  ALTER TABLE choices DROP COLUMN author_name;
  ALTER TABLE codex_ops DROP COLUMN author_name;
  ALTER TABLE chapter_revisions DROP COLUMN author_name;
  ALTER TABLE chapter_revisions DROP COLUMN edited_by;
  `,
  // 5: app settings (AI provider, keys, ...) live on the server so every browser shares them.
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 6: drafts live on the server too, so a chapter started in one browser can be finished in another.
  // `data` is the whole draft as JSON; the server only reads it to list drafts.
  `
  CREATE TABLE drafts (
    key        TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // 7: per-story style notes (point of view, tense, tone, limits) sent with every drafting prompt.
  `
  ALTER TABLE stories ADD COLUMN style TEXT NOT NULL DEFAULT '';
  `,
  // 8: an optional cover image per story, shown on the story list. `cover_updated_at` doubles as the
  // image's version, so it is the only part the list needs to load.
  `
  ALTER TABLE stories ADD COLUMN cover BLOB;
  ALTER TABLE stories ADD COLUMN cover_type TEXT;
  ALTER TABLE stories ADD COLUMN cover_updated_at INTEGER;
  `,
  // 9: illustrations for a chapter: one picture above its title (header) and one after its text
  // (footer). `updated_at` doubles as the image's version, like the story cover.
  `
  CREATE TABLE chapter_images (
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    slot       TEXT NOT NULL CHECK (slot IN ('header', 'footer')),
    image      BLOB NOT NULL,
    type       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chapter_id, slot)
  );
  `,
  // 10: the story's art style (medium, palette, mood), added to every picture prompt for it.
  `
  ALTER TABLE stories ADD COLUMN art_style TEXT NOT NULL DEFAULT '';
  `,
];

function open(): Database.Database {
  const file = process.env.STORYTIME_DB ?? path.join(process.cwd(), "data", "storytime.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

// Reuse one connection across dev-mode module reloads.
const g = globalThis as unknown as { __storytimeDb?: Database.Database };
export function db(): Database.Database {
  return (g.__storytimeDb ??= open());
}

export function newId(): string {
  return crypto.randomBytes(8).toString("base64url");
}
