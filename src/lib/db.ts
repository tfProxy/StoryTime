import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureAiLog, installAiRecorder } from "./aiLog";

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
  // 11: a log of the picture jobs made on the ComfyUI machine, so a picture can be found again with the
  // prompt and settings that made it. The pictures stay in ComfyUI; `images` is a JSON list of where
  // they are ({filename, subfolder, type}). A job is recorded once per ComfyUI prompt id and chapter.
  // `source` and `denoise` are for pictures made from another picture (nothing sets them yet).
  // chapter_images also remembers how a saved picture was made (null for uploads). `job_id` has no
  // foreign key: the picture outlives its job when the chapter the job was made for is deleted.
  `
  CREATE TABLE picture_jobs (
    id         TEXT PRIMARY KEY,
    story_id   TEXT NOT NULL REFERENCES stories(id),
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    prompt_id  TEXT NOT NULL,
    prompt     TEXT NOT NULL,
    negative   TEXT NOT NULL DEFAULT '',
    checkpoint TEXT NOT NULL DEFAULT '',
    width      INTEGER NOT NULL,
    height     INTEGER NOT NULL,
    seed       INTEGER NOT NULL,
    count      INTEGER NOT NULL,
    moment     TEXT CHECK (moment IN ('start', 'end')),
    source     TEXT,
    denoise    REAL,
    images     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX picture_jobs_prompt ON picture_jobs(chapter_id, prompt_id);
  CREATE INDEX picture_jobs_story ON picture_jobs(story_id);

  ALTER TABLE chapter_images ADD COLUMN job_id TEXT;
  ALTER TABLE chapter_images ADD COLUMN prompt TEXT;
  ALTER TABLE chapter_images ADD COLUMN negative TEXT;
  `,
  // 12: what was in the Illustrate page's prompt boxes for each chapter, so it is there again on return
  // (on any device). One row per chapter, replaced as the author types.
  `
  CREATE TABLE picture_drafts (
    chapter_id TEXT PRIMARY KEY REFERENCES chapters(id),
    prompt     TEXT NOT NULL DEFAULT '',
    negative   TEXT NOT NULL DEFAULT '',
    scene      TEXT NOT NULL DEFAULT '',
    direction  TEXT NOT NULL DEFAULT '',
    moment     TEXT NOT NULL DEFAULT 'start' CHECK (moment IN ('start', 'end')),
    updated_at INTEGER NOT NULL
  );
  `,
  // 13: pictures the author pinned (contenders for the header or footer) or rejected (hidden unless asked
  // for), one row per marked picture: its job and its place in the job's `images`. Unmarked pictures have none.
  `
  CREATE TABLE picture_marks (
    job_id      TEXT NOT NULL REFERENCES picture_jobs(id),
    image_index INTEGER NOT NULL,
    mark        TEXT NOT NULL CHECK (mark IN ('pinned', 'rejected')),
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (job_id, image_index)
  );
  `,
  // 14: the prompt boxes are kept per moment (chapter start, chapter end), so switching between them
  // brings each one's prompt back. The moment shown on return is the one saved last.
  `
  CREATE TABLE picture_prompts (
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    moment     TEXT NOT NULL CHECK (moment IN ('start', 'end')),
    prompt     TEXT NOT NULL DEFAULT '',
    negative   TEXT NOT NULL DEFAULT '',
    scene      TEXT NOT NULL DEFAULT '',
    direction  TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chapter_id, moment)
  );
  INSERT INTO picture_prompts (chapter_id, moment, prompt, negative, scene, direction, updated_at)
    SELECT chapter_id, moment, prompt, negative, scene, direction, updated_at FROM picture_drafts;
  DROP TABLE picture_drafts;
  `,
  // 15: which of its job's pictures a saved header or footer is (its place in the job's `images`), so the
  // Illustrate page can mark the picture in use. Null for uploads and for pictures saved before this.
  `
  ALTER TABLE chapter_images ADD COLUMN image_index INTEGER;
  `,
  // 16: the picture settings that keep a story's pictures alike are the story's, beside its art style:
  // how picture prompts are written (tags or sentences; null until chosen) and the ComfyUI checkpoint
  // ('' until chosen).
  `
  ALTER TABLE stories ADD COLUMN image_prompt_style TEXT CHECK (image_prompt_style IN ('tags', 'natural'));
  ALTER TABLE stories ADD COLUMN checkpoint TEXT NOT NULL DEFAULT '';
  `,
  // 17: pictures made by editing a starting picture with an instruction ("remove the logo"): the
  // instruction and the edit model (an id from EDIT_MODELS). Null for every other picture.
  `
  ALTER TABLE picture_jobs ADD COLUMN instruction TEXT;
  ALTER TABLE picture_jobs ADD COLUMN edit_model TEXT;
  `,
  // 18: pictures are drawn with named presets from Settings (checkpoint, LoRAs, sampler). A story has a
  // default one and a chapter can choose another: ids of drawing presets, null to follow the story's
  // (or, for a story, the first preset). `stories.checkpoint` is only read once, to turn the checkpoints
  // stories used into presets.
  `
  ALTER TABLE stories ADD COLUMN draw_preset TEXT;
  ALTER TABLE chapters ADD COLUMN draw_preset TEXT;
  `,
  // 19: when a job's pictures were first shown on their chapter's Illustrate page (or dismissed from the
  // picture queue in the header); null until then, so a job finished while the page wasn't open shows as
  // new there and as ready in the header, on any device. Jobs from before this count as seen.
  `
  ALTER TABLE picture_jobs ADD COLUMN seen_at INTEGER;
  UPDATE picture_jobs SET seen_at = created_at;
  CREATE INDEX picture_jobs_unseen ON picture_jobs(created_at) WHERE seen_at IS NULL;
  `,
  // 20: pictures for the story's cover, made like a chapter's. A cover job has no chapter and the moment
  // 'cover' (a chapter's job keeps its chapter), so picture_jobs is rebuilt: SQLite can't loosen NOT NULL
  // or change a CHECK in place. The marks are put aside while the old table goes, then back.
  // `cover_prompts` keeps the cover page's prompt boxes (like picture_prompts), what the prompt is written
  // from ('premise', 'opening' or 'path', with the chapter the path ends at) and the cover's own drawing
  // preset (null follows the story's). A saved cover remembers the job, picture and prompts that made it
  // (null for uploads), like chapter_images.
  `
  CREATE TEMP TABLE marks_aside AS SELECT * FROM picture_marks;
  DELETE FROM picture_marks;

  CREATE TABLE picture_jobs_new (
    id          TEXT PRIMARY KEY,
    story_id    TEXT NOT NULL REFERENCES stories(id),
    chapter_id  TEXT REFERENCES chapters(id),
    prompt_id   TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    negative    TEXT NOT NULL DEFAULT '',
    checkpoint  TEXT NOT NULL DEFAULT '',
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    seed        INTEGER NOT NULL,
    count       INTEGER NOT NULL,
    moment      TEXT CHECK (moment IN ('start', 'end', 'cover')),
    source      TEXT,
    denoise     REAL,
    images      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    instruction TEXT,
    edit_model  TEXT,
    seen_at     INTEGER,
    CHECK ((chapter_id IS NULL) = (moment IS 'cover'))
  );
  INSERT INTO picture_jobs_new (id, story_id, chapter_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
                                moment, source, denoise, images, created_at, instruction, edit_model, seen_at)
    SELECT id, story_id, chapter_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
           moment, source, denoise, images, created_at, instruction, edit_model, seen_at FROM picture_jobs;
  DROP TABLE picture_jobs;
  ALTER TABLE picture_jobs_new RENAME TO picture_jobs;
  CREATE UNIQUE INDEX picture_jobs_prompt ON picture_jobs(chapter_id, prompt_id);
  CREATE UNIQUE INDEX picture_jobs_cover_prompt ON picture_jobs(story_id, prompt_id) WHERE chapter_id IS NULL;
  CREATE INDEX picture_jobs_story ON picture_jobs(story_id);
  CREATE INDEX picture_jobs_unseen ON picture_jobs(created_at) WHERE seen_at IS NULL;

  INSERT INTO picture_marks SELECT * FROM marks_aside;
  DROP TABLE marks_aside;

  CREATE TABLE cover_prompts (
    story_id        TEXT PRIMARY KEY REFERENCES stories(id),
    prompt          TEXT NOT NULL DEFAULT '',
    negative        TEXT NOT NULL DEFAULT '',
    scene           TEXT NOT NULL DEFAULT '',
    direction       TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT 'premise' CHECK (source IN ('premise', 'opening', 'path')),
    path_chapter_id TEXT,
    draw_preset     TEXT,
    updated_at      INTEGER NOT NULL
  );

  ALTER TABLE stories ADD COLUMN cover_job_id TEXT;
  ALTER TABLE stories ADD COLUMN cover_image_index INTEGER;
  ALTER TABLE stories ADD COLUMN cover_prompt TEXT;
  ALTER TABLE stories ADD COLUMN cover_negative TEXT;
  `,
  // 21: text the author always wants in a chapter's picture prompt (the Illustrate page's "Always include"
  // box), one for the chapter whichever moment is shown. It is added to the written prompt when a picture is made.
  `
  ALTER TABLE chapters ADD COLUMN picture_fixed TEXT NOT NULL DEFAULT '';
  `,
  // 22: a redraw of only a painted part of the starting picture: the name of the mask picture in ComfyUI's
  // input folder (null = the whole picture).
  `
  ALTER TABLE picture_jobs ADD COLUMN mask TEXT;
  `,
  // 23: the reference pictures a job was made with (reference pictures through IP-Adapter, or extra images
  // for an edit): a JSON list of {source, label, role, weight}, null for none.
  `
  ALTER TABLE picture_jobs ADD COLUMN refs TEXT;
  `,
  // 24: the reference pictures chosen on the Illustrate page (per chapter and moment) and the cover page,
  // kept with the prompt boxes: a JSON list of {source, label, role, weight}, null for none.
  `
  ALTER TABLE picture_prompts ADD COLUMN refs TEXT;
  ALTER TABLE cover_prompts ADD COLUMN refs TEXT;
  `,
  // 25: pictures for codex entries. A codex picture is anchored at a chapter (null = the whole story) and
  // applies to it and its descendants, like codex text: the picture at a chapter is the one anchored nearest
  // to it on the root->chapter path (see ./codexPictures). `codex_picture_prompts` keeps the codex page's
  // prompt boxes (like cover_prompts) and the entry's own drawing preset. A codex job has no chapter, an
  // entry_id and the moment 'codex' (cover jobs: no chapter, no entry, 'cover'), so picture_jobs is rebuilt
  // again, the marks put aside meanwhile, as in migration 20.
  `
  CREATE TEMP TABLE marks_aside AS SELECT * FROM picture_marks;
  DELETE FROM picture_marks;

  CREATE TABLE picture_jobs_new (
    id          TEXT PRIMARY KEY,
    story_id    TEXT NOT NULL REFERENCES stories(id),
    chapter_id  TEXT REFERENCES chapters(id),
    entry_id    TEXT,
    prompt_id   TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    negative    TEXT NOT NULL DEFAULT '',
    checkpoint  TEXT NOT NULL DEFAULT '',
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    seed        INTEGER NOT NULL,
    count       INTEGER NOT NULL,
    moment      TEXT CHECK (moment IN ('start', 'end', 'cover', 'codex')),
    source      TEXT,
    denoise     REAL,
    images      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    instruction TEXT,
    edit_model  TEXT,
    seen_at     INTEGER,
    mask        TEXT,
    refs        TEXT,
    CHECK ((chapter_id IS NULL) = (moment IS 'cover' OR moment IS 'codex')),
    CHECK ((entry_id IS NOT NULL) = (moment IS 'codex'))
  );
  INSERT INTO picture_jobs_new (id, story_id, chapter_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
                                moment, source, denoise, images, created_at, instruction, edit_model, seen_at, mask, refs)
    SELECT id, story_id, chapter_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
           moment, source, denoise, images, created_at, instruction, edit_model, seen_at, mask, refs FROM picture_jobs;
  DROP TABLE picture_jobs;
  ALTER TABLE picture_jobs_new RENAME TO picture_jobs;
  CREATE UNIQUE INDEX picture_jobs_prompt ON picture_jobs(chapter_id, prompt_id);
  CREATE UNIQUE INDEX picture_jobs_cover_prompt ON picture_jobs(story_id, prompt_id) WHERE chapter_id IS NULL;
  CREATE INDEX picture_jobs_story ON picture_jobs(story_id);
  CREATE INDEX picture_jobs_entry ON picture_jobs(story_id, entry_id) WHERE entry_id IS NOT NULL;
  CREATE INDEX picture_jobs_unseen ON picture_jobs(created_at) WHERE seen_at IS NULL;

  INSERT INTO picture_marks SELECT * FROM marks_aside;
  DROP TABLE marks_aside;

  CREATE TABLE codex_pictures (
    id                TEXT PRIMARY KEY,
    story_id          TEXT NOT NULL REFERENCES stories(id),
    entry_id          TEXT NOT NULL,
    anchor_chapter_id TEXT REFERENCES chapters(id),
    job_id            TEXT,
    image_index       INTEGER,
    image             BLOB NOT NULL,
    type              TEXT NOT NULL,
    prompt            TEXT NOT NULL DEFAULT '',
    negative          TEXT NOT NULL DEFAULT '',
    posted_at         INTEGER NOT NULL,
    removed_at        INTEGER
  );
  CREATE INDEX codex_pictures_entry ON codex_pictures(story_id, entry_id);

  CREATE TABLE codex_picture_prompts (
    story_id    TEXT NOT NULL REFERENCES stories(id),
    entry_id    TEXT NOT NULL,
    prompt      TEXT NOT NULL DEFAULT '',
    negative    TEXT NOT NULL DEFAULT '',
    scene       TEXT NOT NULL DEFAULT '',
    direction   TEXT NOT NULL DEFAULT '',
    refs        TEXT,
    draw_preset TEXT,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (story_id, entry_id)
  );
  `,
  // 26: the story's style picture, sent as a style reference with every picture job unless left out there:
  // a JSON {source, label, role: "style", weight}, null for none.
  `
  ALTER TABLE stories ADD COLUMN style_ref TEXT;
  `,
  // 27: AI tagging. tags is a library of tag definitions shared by all stories (names unique among live
  // tags, checked in code); choices is a JSON list of allowed values (empty = no value) and examples
  // a JSON list of {text, applies, note?}. story_tags records a tag's switch for a story (see 28).
  // chapter_tags holds the AI's suggestions and the author's decisions per chapter and tag: revision
  // is the chapter revision it was made from, so an edited chapter's tags can be told apart as stale.
  // Chapters are never deleted by the app, so nothing needs to clean up chapter_tags.
  `
  CREATE TABLE tags (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    applies     TEXT NOT NULL DEFAULT '',
    not_applies TEXT NOT NULL DEFAULT '',
    kind        TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'state')),
    choices     TEXT NOT NULL DEFAULT '[]',
    examples    TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL,
    removed_at  INTEGER
  );

  CREATE TABLE story_tags (
    story_id TEXT NOT NULL REFERENCES stories(id),
    tag_id   TEXT NOT NULL REFERENCES tags(id),
    PRIMARY KEY (story_id, tag_id)
  );

  CREATE TABLE chapter_tags (
    id         TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    tag_id     TEXT NOT NULL REFERENCES tags(id),
    value      TEXT,
    status     TEXT NOT NULL CHECK (status IN ('suggested', 'approved', 'rejected')),
    source     TEXT NOT NULL CHECK (source IN ('ai', 'author')),
    quote      TEXT NOT NULL DEFAULT '',
    reason     TEXT NOT NULL DEFAULT '',
    revision   INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    UNIQUE (chapter_id, tag_id)
  );
  CREATE INDEX chapter_tags_chapter ON chapter_tags(chapter_id);
  `,
  // 28: every tag is on for every story unless the author switches it off. A tag is on for a story unless
  // its story_tags row says enabled = 0; rows made under 27 (when a row meant on) stay on.
  `
  ALTER TABLE story_tags ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
  `,
  // 29: the author's decisions on Review issues. The issues themselves are worked out when asked for
  // (review.ts); a row only records that one was dismissed or put off. fingerprint tells apart several
  // issues of one kind on a chapter ("" when there is only ever one). A decision holds while the chapter
  // is still at revision; after an edit the issue counts as new and shows again.
  `
  CREATE TABLE review_items (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    kind TEXT NOT NULL,
    fingerprint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('dismissed', 'later', 'intentional')),
    revision INTEGER NOT NULL,
    note TEXT,
    decided_at INTEGER NOT NULL,
    UNIQUE (chapter_id, kind, fingerprint)
  );
  `,
  // 30: a temporary picture job (made by the Refine screen's inpainting): the Illustrate page and the picture
  // queue leave it out unless the author asks for it, or one of its pictures is pinned (see ./pictureJobs).
  `
  ALTER TABLE picture_jobs ADD COLUMN temporary INTEGER NOT NULL DEFAULT 0;
  `,
  // 31: AI runs (write ahead, fill missing pictures; see ./aiRuns): a run's task list is kept on the server so it
  // can be resumed, with a lease so only one tab runs it. A chapter written by a run points at it (ai_run_id) and
  // carries when the owner marked it reviewed.
  `
  CREATE TABLE ai_runs (
    id               TEXT PRIMARY KEY,
    story_id         TEXT NOT NULL REFERENCES stories(id),
    start_chapter_id TEXT,
    mode             TEXT NOT NULL CHECK (mode IN ('fill', 'tree', 'arc', 'pictures')),
    options          TEXT NOT NULL,
    tasks            TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('ready', 'queued', 'running', 'review', 'paused', 'done', 'stopped')),
    review_depth     INTEGER,
    finished_at      INTEGER,
    error            TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    lease_token      TEXT,
    lease_until      INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  CREATE INDEX ai_runs_story ON ai_runs(story_id, created_at);
  ALTER TABLE chapters ADD COLUMN ai_run_id TEXT;
  ALTER TABLE chapters ADD COLUMN ai_reviewed_at INTEGER;
  `,
  // 32: the work queue on the server (see ./worker): what is waiting, being made or
  // finished, so a restart loses nothing. data is JSON, per type (worker/items.ts). A run the author stopped, or
  // that waits for the plan to be checked, is 'paused'. work_uploads holds pictures the browser sent for a job
  // (a picked file, Refine's flattened picture, a painted mask); they are deleted after a day.
  `
  CREATE TABLE work_items (
    key        TEXT PRIMARY KEY,
    type       TEXT NOT NULL CHECK (type IN ('picture', 'run', 'generate')),
    state      TEXT NOT NULL CHECK (state IN ('gathering', 'waiting', 'working', 'paused', 'done', 'failed')),
    target_key TEXT,
    data       TEXT NOT NULL,
    moved      INTEGER NOT NULL DEFAULT 0,
    ready_at   INTEGER,
    ended_at   INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX work_items_state ON work_items(state, ready_at);
  CREATE TABLE work_uploads (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    bytes      BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // 33: which tags the AI has checked a chapter for, and at which revision, so Find tags does not read a chapter
  // again when nothing changed. One row per chapter; tag_ids is the JSON list of tag ids checked.
  `
  CREATE TABLE chapter_tag_checks (
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    revision   INTEGER NOT NULL,
    tag_ids    TEXT NOT NULL,
    checked_at INTEGER NOT NULL,
    PRIMARY KEY (chapter_id)
  );
  `,
  // 34: a "tags" AI run (Find tags on the work queue): ai_runs.mode allows it. SQLite can't change a CHECK, so the
  // table is rebuilt with the same columns.
  `
  CREATE TABLE ai_runs_new (
    id               TEXT PRIMARY KEY,
    story_id         TEXT NOT NULL REFERENCES stories(id),
    start_chapter_id TEXT,
    mode             TEXT NOT NULL CHECK (mode IN ('fill', 'tree', 'arc', 'pictures', 'tags')),
    options          TEXT NOT NULL,
    tasks            TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('ready', 'queued', 'running', 'review', 'paused', 'done', 'stopped')),
    review_depth     INTEGER,
    finished_at      INTEGER,
    error            TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    lease_token      TEXT,
    lease_until      INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  INSERT INTO ai_runs_new (id, story_id, start_chapter_id, mode, options, tasks, status, review_depth, finished_at, error, version, lease_token, lease_until, created_at, updated_at)
    SELECT id, story_id, start_chapter_id, mode, options, tasks, status, review_depth, finished_at, error, version, lease_token, lease_until, created_at, updated_at FROM ai_runs;
  DROP TABLE ai_runs;
  ALTER TABLE ai_runs_new RENAME TO ai_runs;
  CREATE INDEX ai_runs_story ON ai_runs(story_id, created_at);
  `,
  // 35: the story review's facts. chapter_facts holds what a chapter states (one row per fact, for one revision of the
  // chapter); chapter_fact_checks records that a chapter was read at a revision, so one with no facts isn't read again.
  // The "tags" AI run becomes the "review" run (it now also reads facts): ai_runs is rebuilt with the new mode list and
  // its "tags" rows become "review".
  `
  CREATE TABLE chapter_facts (
    id         TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    revision   INTEGER NOT NULL,
    entity     TEXT NOT NULL,
    attribute  TEXT NOT NULL,
    value      TEXT NOT NULL,
    quote      TEXT NOT NULL
  );
  CREATE INDEX chapter_facts_chapter ON chapter_facts(chapter_id);
  CREATE TABLE chapter_fact_checks (
    chapter_id TEXT PRIMARY KEY REFERENCES chapters(id),
    revision   INTEGER NOT NULL,
    checked_at INTEGER NOT NULL
  );
  CREATE TABLE ai_runs_new (
    id               TEXT PRIMARY KEY,
    story_id         TEXT NOT NULL REFERENCES stories(id),
    start_chapter_id TEXT,
    mode             TEXT NOT NULL CHECK (mode IN ('fill', 'tree', 'arc', 'pictures', 'review')),
    options          TEXT NOT NULL,
    tasks            TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('ready', 'queued', 'running', 'review', 'paused', 'done', 'stopped')),
    review_depth     INTEGER,
    finished_at      INTEGER,
    error            TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    lease_token      TEXT,
    lease_until      INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  INSERT INTO ai_runs_new (id, story_id, start_chapter_id, mode, options, tasks, status, review_depth, finished_at, error, version, lease_token, lease_until, created_at, updated_at)
    SELECT id, story_id, start_chapter_id, CASE WHEN mode = 'tags' THEN 'review' ELSE mode END, options, tasks, status, review_depth, finished_at, error, version, lease_token, lease_until, created_at, updated_at FROM ai_runs;
  DROP TABLE ai_runs;
  ALTER TABLE ai_runs_new RENAME TO ai_runs;
  CREATE INDEX ai_runs_story ON ai_runs(story_id, created_at);
  UPDATE work_items SET data = json_set(data, '$.mode', 'review') WHERE type = 'run' AND json_extract(data, '$.mode') = 'tags';
  `,
  // 36: the AI's verdicts on continuity clashes (two chapters stating different values for one thing). Keyed by a
  // fingerprint of the two quotes rather than by fact ids, because fact rows are replaced each time a chapter is read.
  // The revisions say which text the verdict was about: a chapter edited since makes it stale.
  `
  CREATE TABLE continuity_verdicts (
    fingerprint       TEXT PRIMARY KEY,
    story_id          TEXT NOT NULL REFERENCES stories(id),
    verdict           TEXT NOT NULL CHECK (verdict IN ('contradiction', 'change', 'fine')),
    entity            TEXT NOT NULL,
    attribute         TEXT NOT NULL,
    before_chapter_id TEXT NOT NULL,
    before_revision   INTEGER NOT NULL,
    before_value      TEXT NOT NULL,
    before_quote      TEXT NOT NULL,
    after_chapter_id  TEXT NOT NULL,
    after_revision    INTEGER NOT NULL,
    after_value       TEXT NOT NULL,
    after_quote       TEXT NOT NULL,
    created_at        INTEGER NOT NULL
  );
  CREATE INDEX continuity_verdicts_story ON continuity_verdicts(story_id);
  `,
  // 37: the AI's check of whether a chapter's summary matches the chapter. One row a chapter. A summary edit does not
  // bump the chapter's revision, so the summary text that was checked is kept too: the row only counts while both the
  // revision and the summary are still the ones checked.
  `
  CREATE TABLE summary_checks (
    chapter_id TEXT PRIMARY KEY REFERENCES chapters(id),
    revision   INTEGER NOT NULL,
    summary    TEXT NOT NULL,
    verdict    TEXT NOT NULL CHECK (verdict IN ('ok', 'wrong')),
    problem    TEXT,
    checked_at INTEGER NOT NULL
  );
  `,
  // 38: a tag can be shown to readers (in the notes under each choice, when content notes are on). Off by default.
  `ALTER TABLE tags ADD COLUMN show_readers INTEGER NOT NULL DEFAULT 0;`,
  // 39: codex facts. One row per change to one fact of an entry ("Ears: tall fox ears"), anchored at a chapter
  // like codex_ops and folded along the same root->chapter path; rows sharing a fact_id are versions of one fact.
  // aspect 'form' is the entry's current form, held in the form column. See FactOp in src/lib/codex.ts.
  `
  CREATE TABLE codex_facts (
    id                TEXT PRIMARY KEY,
    story_id          TEXT NOT NULL REFERENCES stories(id),
    anchor_chapter_id TEXT NOT NULL REFERENCES chapters(id),
    entry_id          TEXT NOT NULL,
    fact_id           TEXT NOT NULL,
    op                TEXT NOT NULL CHECK (op IN ('set', 'retire')),
    aspect            TEXT NOT NULL DEFAULT '',
    form              TEXT NOT NULL DEFAULT '',
    text              TEXT NOT NULL DEFAULT '',
    quote             TEXT NOT NULL DEFAULT '',
    posted_at         INTEGER NOT NULL
  );
  CREATE INDEX codex_facts_anchor ON codex_facts(anchor_chapter_id, posted_at);
  CREATE INDEX codex_facts_entry ON codex_facts(story_id, entry_id);
  `,
  // 40: the codex inbox. After a chapter is posted the AI reads it and leaves suggestions (one fact-sized change each,
  // with a quote from the chapter as evidence) for the owner to accept, edit or dismiss. 'before' is the fact's text when
  // the suggestion was made; 'entry' holds a proposed new entry as JSON. codex_checks says which chapter revision was
  // read, so it isn't read again automatically.
  `
  CREATE TABLE codex_suggestions (
    id         TEXT PRIMARY KEY,
    story_id   TEXT NOT NULL REFERENCES stories(id),
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    revision   INTEGER NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('set', 'form', 'retire', 'entry', 'conflict')),
    entry_id   TEXT,
    aspect     TEXT NOT NULL DEFAULT '',
    form       TEXT NOT NULL DEFAULT '',
    before     TEXT NOT NULL DEFAULT '',
    after      TEXT NOT NULL DEFAULT '',
    quote      TEXT NOT NULL DEFAULT '',
    entry      TEXT NOT NULL DEFAULT '{}',
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE INDEX codex_suggestions_story ON codex_suggestions(story_id, status);
  CREATE INDEX codex_suggestions_chapter ON codex_suggestions(chapter_id);
  CREATE TABLE codex_checks (
    chapter_id TEXT PRIMARY KEY REFERENCES chapters(id),
    revision   INTEGER NOT NULL,
    checked_at INTEGER NOT NULL
  );
  `,
  // 41: where a suggestion came from. 'chapter' = the AI read a chapter; 'notes' = the AI turned an entry's notes
  // into facts (its quote is from the notes, not the chapter).
  `
  ALTER TABLE codex_suggestions ADD COLUMN source TEXT NOT NULL DEFAULT 'chapter';
  `,
  // 42: when the owner declared an AI-written chapter their own writing ("This is my writing now"). The AI mark is
  // gone for good then; ai_run_id stays, because the run still lists the chapter.
  `
  ALTER TABLE chapters ADD COLUMN ai_owned_at INTEGER;
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
  // The prompt history table is not a migration (see aiLog.ts), and its recorder is set wherever the database is.
  ensureAiLog(db);
  installAiRecorder(db);
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
