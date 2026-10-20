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

// the picture job log, and the prompts kept with saved pictures
ok(["id", "story_id", "chapter_id", "prompt_id", "prompt", "negative", "checkpoint", "width", "height", "seed", "count", "moment", "source", "denoise", "images", "created_at"].every((c) => cols("picture_jobs").includes(c)), "the picture job log has its columns");
ok(["job_id", "prompt", "negative", "image_index"].every((c) => cols("chapter_images").includes(c)), "saved pictures can remember the job, picture and prompt that made them");
ok(["art_style", "image_prompt_style", "checkpoint"].every((c) => cols("stories").includes(c)), "stories keep their picture settings");
const keptStory = d.prepare(`SELECT image_prompt_style, checkpoint FROM stories WHERE id = 'keep'`).get() as Record<string, unknown>;
ok(keptStory.image_prompt_style === null && keptStory.checkpoint === "", "an existing story starts with no prompt style or checkpoint chosen");
const job = (id: string, promptId: string, chapterId = "a", moment: string | null = null) =>
  d.prepare(`INSERT INTO picture_jobs (id, story_id, chapter_id, prompt_id, prompt, width, height, seed, count, moment, images, created_at) VALUES (?, 'keep', ?, ?, 'p', 1, 1, 1, 1, ?, '[]', 1)`).run(id, chapterId, promptId, moment);
job("j1", "x");
let twice = false;
try { job("j2", "x"); } catch { twice = true; }
ok(twice, "one ComfyUI job is recorded once per chapter");
job("j3", "x", "a2");
let badMoment = false;
try { job("j4", "y", "a", "middle"); } catch { badMoment = true; }
ok(badMoment, "a moment other than start or end is refused");
let orphan = false;
try { job("j5", "z", "no-such-chapter"); } catch { orphan = true; }
ok(orphan, "a job needs a chapter that exists");

// a database that already has pictures (schema version 10) keeps them when it gets the job log
const before = new Database(path.join(dir, "v10.db"));
before.pragma("foreign_keys = ON");
for (let v = 0; v < 10; v++) before.exec(MIGRATIONS[v]);
before.prepare(`INSERT INTO stories (id, title, root_chapter_id, created_at) VALUES ('s', 's', 'c', 1)`).run();
before.pragma("foreign_keys = OFF");
before.prepare(`INSERT INTO chapters (id, story_id, depth, title, body, posted_at) VALUES ('c', 's', 0, 't', 'b', 1)`).run();
before.pragma("foreign_keys = ON");
before.prepare(`INSERT INTO chapter_images (chapter_id, slot, image, type, updated_at) VALUES ('c', 'header', x'89504e47', 'image/png', 7)`).run();
before.exec(MIGRATIONS[10]);
const kept = before.prepare(`SELECT type, updated_at, job_id, prompt, negative FROM chapter_images WHERE chapter_id = 'c' AND slot = 'header'`).get() as Record<string, unknown>;
ok(kept.type === "image/png" && kept.updated_at === 7 && kept.job_id === null && kept.prompt === null && kept.negative === null, "an existing picture is kept, with no prompt");

// a prompt kept per chapter (schema version 13) becomes that chapter's prompt for its moment
for (let v = 11; v < 13; v++) before.exec(MIGRATIONS[v]);
before.prepare(`INSERT INTO picture_drafts (chapter_id, prompt, negative, scene, direction, moment, updated_at) VALUES ('c', 'a “lamp”', 'blur', 'sc', 'dir', 'end', 9)`).run();
before.exec(MIGRATIONS[13]);
const moved = before.prepare(`SELECT * FROM picture_prompts`).all() as Record<string, unknown>[];
ok(moved.length === 1 && JSON.stringify(moved[0]) === JSON.stringify({ chapter_id: "c", moment: "end", prompt: "a “lamp”", negative: "blur", scene: "sc", direction: "dir", updated_at: 9 }), "a saved prompt is kept, under the moment it was saved with");
ok(!before.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'picture_drafts'`).get(), "…and the old table is gone");
before.close();
d.close();
fs.rmSync(dir, { recursive: true, force: true });
