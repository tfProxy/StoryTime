import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// A database as the soft-delete version left it (schema version 2) with some removed rows.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytime-migrate-"));
const file = path.join(dir, "old.db");
process.env.STORYTIME_DB = file;
const { MIGRATIONS, db } = await import("../../src/lib/db.ts");

const old = new Database(file);
old.pragma("foreign_keys = ON");
for (let v = 0; v < 2; v++) old.exec(MIGRATIONS[v]);
old.pragma("user_version = 2");
const story = (id: string, removed: number | null) =>
  old.prepare(`INSERT INTO stories (id, title, root_chapter_id, created_at, removed_at) VALUES (?, ?, ?, 1, ?)`).run(id, id, `${id}-root`, removed);
const chapter = (id: string, storyId: string, choice: string | null, removed: number | null = null) =>
  old.prepare(`INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, posted_at, removed_at) VALUES (?, ?, ?, 0, ?, 'b', 1, ?)`).run(id, storyId, choice, id, removed);
const choice = (id: string, parent: string, removed: number | null = null) =>
  old.prepare(`INSERT INTO choices (id, parent_chapter_id, label, posted_at, removed_at) VALUES (?, ?, ?, 1, ?)`).run(id, parent, id, removed);
const codex = (id: string, storyId: string, anchor: string, removed: number | null = null) =>
  old.prepare(`INSERT INTO codex_ops (id, story_id, anchor_chapter_id, entry_id, op, posted_at, removed_at) VALUES (?, ?, ?, 'e', 'create', 1, ?)`).run(id, storyId, anchor, removed);

old.pragma("foreign_keys = OFF");
// keep: root -> [a -> [a2], b (removed -> its child hidden too), c unwritten (removed choice)]
story("keep", null); chapter("keep-root", "keep", null);
choice("ka", "keep-root"); choice("kb", "keep-root"); choice("kc", "keep-root", 5);
chapter("a", "keep", "ka"); choice("ka2", "a"); chapter("a2", "keep", "ka2");
chapter("b", "keep", "kb", 5); choice("kb2", "b"); chapter("b2", "keep", "kb2");
codex("o-keep", "keep", "a"); codex("o-removed", "keep", "a", 5); codex("o-under-b", "keep", "b2");
old.prepare(`INSERT INTO chapter_revisions (id, chapter_id, revision, title, body, created_at) VALUES ('r-b2', 'b2', 1, 't', 'b', 1)`).run();
// a removed story with a chapter
story("gone", 5); chapter("gone-root", "gone", null); codex("o-gone", "gone", "gone-root");
old.close();

const d = db();
const ids = (sql: string) => (d.prepare(sql).all() as { id: string }[]).map((r) => r.id).sort().join();
ok(d.pragma("user_version", { simple: true }) === MIGRATIONS.length, "the database is upgraded");
ok(ids("SELECT id FROM stories") === "keep", "a removed story is deleted");
ok(ids("SELECT id FROM chapters") === "a,a2,keep-root", "removed chapters, and everything below them, are deleted");
ok(ids("SELECT id FROM choices") === "ka,ka2,kb", "removed choices and choices on deleted chapters are deleted");
ok(ids("SELECT id FROM codex_ops") === "o-keep", "removed codex changes and those anchored on deleted chapters are deleted");
ok(ids("SELECT chapter_id AS id FROM chapter_revisions") === "", "revisions of deleted chapters are deleted");
const cols = (t: string) => (d.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name);
ok(!["stories", "chapters", "choices", "codex_ops"].some((t) => cols(t).includes("removed_at")), "the removed_at columns are gone");
const dead = ["author_name", "edited_by", "edit_key_hash"];
ok(!["stories", "chapters", "choices", "codex_ops", "chapter_revisions"].some((t) => cols(t).some((c) => dead.includes(c))), "the author columns are gone");
let dup = false;
try {
  d.prepare(`INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, posted_at) VALUES ('dup', 'keep', 'ka', 1, 't', 'b', 1)`).run();
} catch { dup = true; }
ok(dup, "the one-chapter-per-choice index still holds");
d.close();
fs.rmSync(dir, { recursive: true, force: true });
