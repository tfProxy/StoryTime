import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Schema notes:
// - Every chapter edit first copies the previous version into chapter_revisions, so nothing is
//   ever lost.
// - `removed_at` is set by the command-line tool (scripts/admin.mjs).
// - The author_name, edited_by and edit_key_hash columns date from when the app had several
//   writers. Nothing reads or writes them any more (they keep their defaults).
// - A choice's child is the chapter whose parent_choice_id points at it. A choice with no
//   live child is an "unwritten" slot. The partial unique index allows only one live child per
//   choice, and frees the slot again if the child is removed.
const MIGRATIONS: string[] = [
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
