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
ok(cols("stories").includes("draw_preset") && cols("chapters").includes("draw_preset"), "stories and chapters can choose a drawing preset");
const presets = d.prepare(`SELECT (SELECT draw_preset FROM stories WHERE id = 'keep') AS story, (SELECT draw_preset FROM chapters WHERE id = 'a') AS chapter`).get() as Record<string, unknown>;
ok(presets.story === null && presets.chapter === null, "…and existing ones start with none, so they follow the top preset");
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

// the job log is rebuilt for cover jobs (schema version 20): jobs and their marks are kept
for (let v = 14; v < 19; v++) before.exec(MIGRATIONS[v]);
before
  .prepare(
    `INSERT INTO picture_jobs (id, story_id, chapter_id, prompt_id, prompt, width, height, seed, count, moment, images, created_at, instruction, edit_model, seen_at)
     VALUES ('pj', 's', 'c', 'p1', 'a lamp', 832, 1216, 5, 2, 'end', '[{"filename":"a.png","subfolder":"","type":"output"}]', 3, 'brighter', 'qwen', NULL)`,
  )
  .run();
before.prepare(`INSERT INTO picture_marks (job_id, image_index, mark, updated_at) VALUES ('pj', 1, 'pinned', 4)`).run();
before.exec(MIGRATIONS[19]);
const rebuilt = before.prepare(`SELECT * FROM picture_jobs WHERE id = 'pj'`).get() as Record<string, unknown>;
ok(rebuilt.chapter_id === "c" && rebuilt.moment === "end" && rebuilt.width === 832 && rebuilt.instruction === "brighter" && rebuilt.edit_model === "qwen" && rebuilt.seen_at === null, "a job keeps every column, its unseen state too");
ok(JSON.stringify(before.prepare(`SELECT job_id, image_index, mark FROM picture_marks`).all()) === JSON.stringify([{ job_id: "pj", image_index: 1, mark: "pinned" }]), "…and its marks");
ok((before.pragma("foreign_key_check") as unknown[]).length === 0, "…and every mark still points at its job");
ok(!before.prepare(`SELECT 1 FROM sqlite_master WHERE name IN ('picture_jobs_new', 'marks_aside')`).get(), "nothing is left over from the rebuild");
const indexes = (before.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'picture_jobs' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name).sort().join();
ok(indexes === "picture_jobs_cover_prompt,picture_jobs_prompt,picture_jobs_story,picture_jobs_unseen", "the job log's indexes are back, with one for covers");
const coverJob = (id: string, promptId: string, chapterId: string | null, moment: string | null) =>
  before.prepare(`INSERT INTO picture_jobs (id, story_id, chapter_id, prompt_id, prompt, width, height, seed, count, moment, images, created_at) VALUES (?, 's', ?, ?, 'p', 1, 1, 1, 1, ?, '[]', 1)`).run(id, chapterId, promptId, moment);
const refused = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
ok(!refused(() => coverJob("cj", "q1", null, "cover")), "a cover job has no chapter");
ok(refused(() => coverJob("cj2", "q1", null, "cover")), "one ComfyUI job is recorded once per story's cover");
ok(refused(() => coverJob("cj3", "q2", null, "start")) && refused(() => coverJob("cj4", "q3", null, null)), "a job with no chapter must be a cover");
ok(refused(() => coverJob("cj5", "q4", "c", "cover")), "a chapter's job can't be a cover");
ok(["cover_job_id", "cover_image_index", "cover_prompt", "cover_negative"].every((c) => (before.pragma("table_info(stories)") as { name: string }[]).some((x) => x.name === c)), "a saved cover can remember the job, picture and prompts that made it");
before.prepare(`INSERT INTO cover_prompts (story_id, prompt, updated_at) VALUES ('s', 'a lighthouse', 1)`).run();
ok((before.prepare(`SELECT source FROM cover_prompts`).get() as { source: string }).source === "premise", "the cover's prompt is written from the premise until another source is chosen");
ok(refused(() => before.prepare(`UPDATE cover_prompts SET source = 'elsewhere'`).run()), "…and the source is one of premise, opening and path");
before.close();

// tags are on for a story unless switched off (schema version 28): switches made earlier stay on
const tagDb = new Database(":memory:");
for (let v = 0; v < 27; v++) tagDb.exec(MIGRATIONS[v]);
tagDb.prepare(`INSERT INTO stories (id, title, root_chapter_id, created_at) VALUES ('ts', 'ts', 'tc', 1)`).run();
tagDb.prepare(`INSERT INTO tags (id, name, created_at) VALUES ('tg', 'tg', 1)`).run();
tagDb.prepare(`INSERT INTO story_tags (story_id, tag_id) VALUES ('ts', 'tg')`).run();
tagDb.exec(MIGRATIONS[27]);
ok((tagDb.prepare(`SELECT enabled FROM story_tags`).get() as { enabled: number }).enabled === 1, "a tag switched on before stays on");

// decisions on Review issues (schema version 29): one per chapter, kind and fingerprint, of a known status
tagDb.exec(MIGRATIONS[28]);
tagDb.prepare(`INSERT INTO chapters (id, story_id, depth, title, body, posted_at) VALUES ('tc', 'ts', 0, 't', 'b', 1)`).run();
const item = (id: string, status: string) =>
  tagDb.prepare(`INSERT INTO review_items (id, chapter_id, kind, status, revision, decided_at) VALUES (?, 'tc', 'summary-missing', ?, 1, 1)`).run(id, status);
const refusedItem = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
ok(!refusedItem(() => item("r1", "later")), "an issue can be put off");
ok(refusedItem(() => item("r2", "dismissed")), "…and has one decision at a time");
ok(refusedItem(() => tagDb.prepare(`UPDATE review_items SET status = 'maybe'`).run()), "the status is one of dismissed, later and intentional");
tagDb.close();

// the work queue (schema version 32): items of a known type and state, and uploads
ok(MIGRATIONS.length >= 32, "migration 32 exists");
const wq = new Database(":memory:");
wq.exec(MIGRATIONS[31]);
const wqCols = (t: string) => (wq.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name);
ok(["key", "type", "state", "target_key", "data", "moved", "ready_at", "ended_at", "created_at", "updated_at"].every((c) => wqCols("work_items").includes(c)), "work items have their columns");
ok(["id", "type", "bytes", "created_at"].every((c) => wqCols("work_uploads").includes(c)), "work uploads have their columns");
const wqItem = (key: string, type: string, state: string) =>
  wq.prepare(`INSERT INTO work_items (key, type, state, data, created_at, updated_at) VALUES (?, ?, ?, '{}', 1, 1)`).run(key, type, state);
const wqRefused = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
ok(!wqRefused(() => wqItem("a", "picture", "gathering")) && !wqRefused(() => wqItem("b", "run", "paused")), "a picture can be gathering and a run can be paused");
ok(wqRefused(() => wqItem("c", "picture", "elsewhere")), "the state is one of gathering, waiting, working, paused, done and failed");
ok(wqRefused(() => wqItem("d", "video", "waiting")), "the type is one of picture, run and generate");
ok(wqRefused(() => wqItem("a", "picture", "waiting")), "a key is used once");
ok((wq.prepare(`SELECT moved FROM work_items WHERE key = 'a'`).get() as { moved: number }).moved === 0, "an item has not been moved by default");
wq.close();

// which tags a chapter was checked for (schema version 33): one row per chapter
ok(MIGRATIONS.length >= 33, "migration 33 exists");
const tc = new Database(":memory:");
tc.pragma("foreign_keys = OFF");
tc.exec(MIGRATIONS[32]);
const tcCols = (tc.pragma(`table_info(chapter_tag_checks)`) as { name: string }[]).map((c) => c.name);
ok(["chapter_id", "revision", "tag_ids", "checked_at"].every((c) => tcCols.includes(c)), "a tag check has its columns");
const tcAdd = () => tc.prepare(`INSERT INTO chapter_tag_checks (chapter_id, revision, tag_ids, checked_at) VALUES ('c1', 1, '[]', 1)`).run();
ok(!wqRefused(tcAdd), "a chapter's check can be recorded");
ok(wqRefused(tcAdd), "a chapter has one check row");
tc.close();

// a "tags" AI run (schema version 34): ai_runs is rebuilt to allow the mode, keeping its rows
ok(MIGRATIONS.length >= 34, "migration 34 exists");
const ar = new Database(":memory:");
ar.pragma("foreign_keys = OFF");
ar.exec(`CREATE TABLE chapters (id TEXT PRIMARY KEY)`);
ar.exec(MIGRATIONS[30]);
const arAdd = (id: string, mode: string) =>
  ar.prepare(`INSERT INTO ai_runs (id, story_id, mode, options, tasks, status, created_at, updated_at) VALUES (?, 's1', ?, '{}', '[]', 'done', 1, 1)`).run(id, mode);
arAdd("r1", "fill");
ok(wqRefused(() => arAdd("r2", "tags")), "before 34 a tags run is refused");
ar.exec(MIGRATIONS[33]);
ok((ar.prepare(`SELECT mode FROM ai_runs WHERE id = 'r1'`).get() as { mode: string } | undefined)?.mode === "fill", "an existing run is kept");
ok(!wqRefused(() => arAdd("r3", "tags")), "a tags run can be saved");
ok(wqRefused(() => arAdd("r4", "bogus")), "an unknown mode is still refused");
ok((ar.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ai_runs_story'`).get() as { name: string } | undefined) !== undefined, "the story index is back");
ar.close();

// facts and the "review" AI run (schema version 35): chapter_facts and chapter_fact_checks are added, and ai_runs is
// rebuilt so a "tags" run becomes a "review" run
ok(MIGRATIONS.length >= 35, "migration 35 exists");
const fr = new Database(":memory:");
fr.pragma("foreign_keys = OFF");
fr.exec(`CREATE TABLE chapters (id TEXT PRIMARY KEY)`);
fr.exec(MIGRATIONS[30]);
fr.exec(MIGRATIONS[31]);
fr.exec(MIGRATIONS[33]);
const frAdd = (id: string, mode: string) =>
  fr.prepare(`INSERT INTO ai_runs (id, story_id, mode, options, tasks, status, created_at, updated_at) VALUES (?, 's1', ?, '{}', '[]', 'done', 1, 1)`).run(id, mode);
frAdd("r1", "fill");
frAdd("r2", "tags");
const frItem = (key: string, mode: string) =>
  fr.prepare(`INSERT INTO work_items (key, type, state, data, created_at, updated_at) VALUES (?, 'run', 'waiting', ?, 1, 1)`).run(key, JSON.stringify({ runId: key, mode }));
frItem("w1", "tags");
frItem("w2", "fill");
fr.exec(MIGRATIONS[34]);
const itemMode = (key: string) => (JSON.parse((fr.prepare(`SELECT data FROM work_items WHERE key = ?`).get(key) as { data: string }).data) as { mode: string }).mode;
ok(itemMode("w1") === "review" && itemMode("w2") === "fill", "a queued tags run's item says review too");
const modeOf = (id: string) => (fr.prepare(`SELECT mode FROM ai_runs WHERE id = ?`).get(id) as { mode: string } | undefined)?.mode;
ok(modeOf("r1") === "fill", "an existing run is kept");
ok(modeOf("r2") === "review", "a tags run becomes a review run");
ok(!wqRefused(() => frAdd("r3", "review")), "a review run can be saved");
ok(wqRefused(() => frAdd("r4", "tags")), "a tags run is refused now");
ok(wqRefused(() => frAdd("r5", "bogus")), "an unknown mode is still refused");
ok((fr.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ai_runs_story'`).get() as { name: string } | undefined) !== undefined, "the story index is back");
const frCols = (t: string) => (fr.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).join(",");
ok(frCols("chapter_facts") === "id,chapter_id,revision,entity,attribute,value,quote", "chapter_facts has its columns");
ok(frCols("chapter_fact_checks") === "chapter_id,revision,checked_at", "chapter_fact_checks has its columns");
ok((fr.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'chapter_facts_chapter'`).get() as { name: string } | undefined) !== undefined, "chapter_facts is indexed by chapter");
const factAdd = (id: string) => fr.prepare(`INSERT INTO chapter_facts (id, chapter_id, revision, entity, attribute, value, quote) VALUES (?, 'c1', 1, 'Ann', 'home', 'farm', 'q')`).run(id);
ok(!wqRefused(() => factAdd("f1")), "a fact can be recorded");
ok(wqRefused(() => factAdd("f1")), "a fact id is unique");
fr.close();
d.close();
fs.rmSync(dir, { recursive: true, force: true });
