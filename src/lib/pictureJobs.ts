import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";
import { PostError } from "./stories";

// The log of picture jobs made on the ComfyUI machine (see migration 11). The pictures stay in ComfyUI;
// a job remembers where they are and the prompt and settings that made them.

const text = (max: number) => z.string().max(max);
const JobImage = z.object({ filename: text(500).min(1), subfolder: text(500), type: text(50).min(1) });

export const StoredRefSchema = z.object({
  source: text(1000).min(1),
  label: text(200),
  role: z.enum(["character", "item", "place", "style"]),
  weight: z.number().min(0).max(2),
});

export const NewJobSchema = z
  .object({
    /** The chapter the job was for; a cover or codex job gives its story instead. */
    chapter_id: z.string().min(1).max(100).optional(),
    story_id: z.string().min(1).max(100).optional(),
    /** A codex job: the codex entry it is for (with the story, and the moment codex). */
    entry_id: z.string().min(1).max(100).optional(),
    prompt_id: text(200).min(1),
    // An edit follows its instruction, so it may have no prompt.
    prompt: text(LIMITS.picturePrompt),
    negative: text(LIMITS.picturePrompt).default(""),
    checkpoint: text(500).default(""),
    width: z.number().int().min(1).max(16384),
    height: z.number().int().min(1).max(16384),
    seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    count: z.number().int().min(1).max(64),
    moment: z.enum(["start", "end", "cover", "codex"]).nullish(),
    source: text(1000).nullish(),
    denoise: z.number().min(0).max(1).nullish(),
    /** A redraw of only a painted part: the mask picture's name in ComfyUI's input folder. Needs a starting picture. */
    mask: text(300).min(1).nullish(),
    /** The reference pictures the job was made with (at most 4). */
    refs: z.array(StoredRefSchema).max(4).nullish(),
    /** An edit: what it was told to change, and the model (an id from EDIT_MODELS). Both or neither. */
    instruction: text(LIMITS.picturePrompt).min(1).nullish(),
    edit_model: text(100).min(1).nullish(),
    images: z.array(JobImage).min(1).max(64),
    /** Finished while its chapter's Illustrate page wasn't open, so its pictures are new until they are seen. */
    unseen: z.boolean().optional(),
    /** Made by the Refine screen: left out of listings unless asked for, or until a picture is pinned. */
    temporary: z.boolean().optional(),
  })
  .refine((j) => !j.chapter_id !== !j.story_id, { message: "give the chapter, or for a cover the story", path: ["chapter_id"] })
  .refine((j) => !j.story_id === (j.moment !== "cover" && j.moment !== "codex"), { message: "a cover or codex job is given its story, and its moment is cover or codex", path: ["moment"] })
  .refine((j) => !j.entry_id === (j.moment !== "codex"), { message: "a codex job is given its entry, and no other job is", path: ["entry_id"] })
  .refine((j) => !j.instruction === !j.edit_model, { message: "an edit needs both its instruction and its model", path: ["instruction"] })
  .refine((j) => j.prompt.length > 0 || !!j.instruction, { message: "a prompt is needed (or, for an edit, an instruction)", path: ["prompt"] })
  .refine((j) => !j.instruction || !!j.source, { message: "an edit needs the picture it started from", path: ["source"] })
  .refine((j) => !j.mask || (!!j.source && !j.instruction), { message: "a mask needs the picture it started from, and is for a redraw, not an edit", path: ["mask"] });
export type NewJob = z.infer<typeof NewJobSchema>;

export type PictureJob = {
  id: string;
  story_id: string;
  /** Null for a job made for the story's cover or a codex entry. */
  chapter_id: string | null;
  /** The codex entry a codex job was made for, else null. */
  entry_id: string | null;
  prompt_id: string;
  prompt: string;
  negative: string;
  checkpoint: string;
  width: number;
  height: number;
  seed: number;
  count: number;
  moment: "start" | "end" | "cover" | "codex" | null;
  source: string | null;
  denoise: number | null;
  mask: string | null;
  /** The reference pictures it was made with, or null for none. */
  refs: z.infer<typeof StoredRefSchema>[] | null;
  instruction: string | null;
  edit_model: string | null;
  /** A temporary (Refine) job: listed only on request, unless one of its pictures is pinned. */
  temporary: boolean;
  images: z.infer<typeof JobImage>[];
  /** Each picture's mark, in the order of `images`: pinned, rejected, or null. */
  marks: (PictureMark | null)[];
  created_at: number;
  /** When its pictures were first shown on the chapter's Illustrate page, or dismissed from the header's queue; null while they are new. */
  seen_at: number | null;
};

export const PICTURE_MARKS = ["pinned", "rejected"] as const;
export type PictureMark = (typeof PICTURE_MARKS)[number];

type Row = Omit<PictureJob, "images" | "marks" | "refs" | "temporary"> & { images: string; refs: string | null; seq: number; temporary: number };

/** The jobs of the rows, with each picture's mark. */
function toJobs(rows: Row[]): PictureJob[] {
  const marks = new Map<string, PictureMark>();
  if (rows.length) {
    const found = db()
      .prepare(`SELECT job_id, image_index, mark FROM picture_marks WHERE job_id IN (${rows.map(() => "?").join(",")})`)
      .all(...rows.map((r) => r.id)) as { job_id: string; image_index: number; mark: PictureMark }[];
    for (const m of found) marks.set(`${m.job_id}:${m.image_index}`, m.mark);
  }
  return rows.map(({ seq, images, refs, temporary, ...job }) => {
    void seq; // only the cursor for paging uses it
    const list = JSON.parse(images) as PictureJob["images"];
    return { ...job, temporary: temporary === 1, refs: refs ? (JSON.parse(refs) as PictureJob["refs"]) : null, images: list, marks: list.map((_, i) => marks.get(`${job.id}:${i}`) ?? null) };
  });
}

const toJob = (row: Row) => toJobs([row])[0];

const COLUMNS = `rowid AS seq, id, story_id, chapter_id, entry_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
                 moment, source, denoise, mask, refs, instruction, edit_model, temporary, images, created_at, seen_at`;

/** A temporary job counts as kept, and is listed like any other, once one of its pictures is pinned. */
const HIDDEN_TEMPORARY = `temporary = 1 AND NOT EXISTS (SELECT 1 FROM picture_marks m WHERE m.job_id = picture_jobs.id AND m.mark = 'pinned')`;
/**
 * Records a finished job for a chapter, or (given a story instead) for the story's cover, or for one of its
 * codex entries (given the entry too). Recording the same ComfyUI job again returns the first record.
 */
export function recordPictureJob(input: NewJob): PictureJob {
  const chapterId = input.chapter_id ?? null;
  const entryId = input.entry_id ?? null;
  let storyId: string;
  if (chapterId !== null) {
    const chapter = db().prepare(`SELECT story_id FROM chapters WHERE id = ?`).get(chapterId) as { story_id: string } | undefined;
    if (!chapter) throw new PostError("That chapter does not exist", 404);
    storyId = chapter.story_id;
  } else {
    if (!db().prepare(`SELECT 1 FROM stories WHERE id = ?`).get(input.story_id)) throw new PostError("That story does not exist", 404);
    storyId = input.story_id!;
    if (entryId !== null && !db().prepare(`SELECT 1 FROM codex_ops WHERE story_id = ? AND entry_id = ?`).get(storyId, entryId)) {
      throw new PostError("That codex entry does not exist", 404);
    }
  }
  const seen = (
    chapterId !== null
      ? db().prepare(`SELECT ${COLUMNS} FROM picture_jobs WHERE chapter_id = ? AND prompt_id = ?`).get(chapterId, input.prompt_id)
      : db().prepare(`SELECT ${COLUMNS} FROM picture_jobs WHERE story_id = ? AND chapter_id IS NULL AND prompt_id = ?`).get(storyId, input.prompt_id)
  ) as Row | undefined;
  if (seen) return toJob(seen);
  const id = newId();
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO picture_jobs (id, story_id, chapter_id, entry_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
                                 moment, source, denoise, mask, refs, instruction, edit_model, images, created_at, seen_at, temporary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, storyId, chapterId, entryId, input.prompt_id, input.prompt, input.negative, input.checkpoint,
      input.width, input.height, input.seed, input.count, input.moment ?? null, input.source ?? null,
      input.denoise ?? null, input.mask ?? null, input.refs?.length ? JSON.stringify(input.refs) : null, input.instruction ?? null, input.edit_model ?? null, JSON.stringify(input.images), now,
      input.unseen ? null : now, input.temporary ? 1 : 0,
    );
  return toJob(db().prepare(`SELECT ${COLUMNS} FROM picture_jobs WHERE id = ?`).get(id) as Row);
}

/**
 * A page of the log, newest first, for a story, one chapter, or the story's cover. For a story,
 * `notChapter` leaves one chapter out and `chaptersOnly` leaves the cover's jobs out (leaving out a
 * chapter leaves them out too). `before` is the cursor from the previous page; `next` is the cursor for
 * the page after this one, or null at the end. Temporary jobs are left out unless `temporary` is "include"
 * ("only" lists just those, "hidden" just those a normal listing leaves out) or one of their pictures is pinned.
 */
export function listPictureJobs(
  where: { story: string; notChapter?: string; chaptersOnly?: boolean } | { chapter: string } | { cover: string } | { codex: string; entry: string },
  page: { before?: number; limit: number; temporary?: "include" | "only" | "hidden" },
): { jobs: PictureJob[]; next: number | null } {
  const [filter, ...values] =
    "story" in where
      ? ["story_id = ?", where.story]
      : "chapter" in where
        ? ["chapter_id = ?", where.chapter]
        : "cover" in where
          ? ["story_id = ? AND chapter_id IS NULL AND entry_id IS NULL", where.cover]
          : ["story_id = ? AND entry_id = ?", where.codex, where.entry];
  // The whole story but one chapter, for "other chapters", or but the cover.
  const not = "story" in where && where.notChapter ? where.notChapter : null;
  const chaptersOnly = "story" in where && !not && where.chaptersOnly;
  const rows = db()
    .prepare(
      `SELECT ${COLUMNS} FROM picture_jobs WHERE ${filter} ${not ? "AND chapter_id != ?" : ""} ${chaptersOnly ? "AND chapter_id IS NOT NULL" : ""}
         ${page.temporary === "only" ? "AND temporary = 1" : page.temporary === "hidden" ? `AND ${HIDDEN_TEMPORARY}` : page.temporary ? "" : `AND NOT (${HIDDEN_TEMPORARY})`}
         AND rowid < ? ORDER BY rowid DESC LIMIT ?`,
    )
    .all(...values, ...(not ? [not] : []), page.before ?? Number.MAX_SAFE_INTEGER, page.limit + 1) as Row[];
  const more = rows.length > page.limit;
  const shown = rows.slice(0, page.limit);
  return { jobs: toJobs(shown), next: more ? shown[shown.length - 1].seq : null };
}

// How many of a chapter's jobs the Illustrate page loads with it.
const CHAPTER_JOBS = 1000;

/** A chapter's jobs, newest first (the most recent 1000), with their marks: what its Illustrate page shows. */
export function chapterPictureJobs(chapterId: string): PictureJob[] {
  return listPictureJobs({ chapter: chapterId }, { limit: CHAPTER_JOBS }).jobs;
}
// (The three lists below leave out temporary jobs too, unless one of their pictures is pinned.)

/** The story's cover jobs, newest first (the most recent 1000), with their marks: what its cover page shows. */
export function coverPictureJobs(storyId: string): PictureJob[] {
  return listPictureJobs({ cover: storyId }, { limit: CHAPTER_JOBS }).jobs;
}

/** A codex entry's jobs, newest first (the most recent 1000), with their marks: what its codex picture page shows. */
export function codexPictureJobs(storyId: string, entryId: string): PictureJob[] {
  return listPictureJobs({ codex: storyId, entry: entryId }, { limit: CHAPTER_JOBS }).jobs;
}

// How many new jobs the picture queue in the header is given.
const UNSEEN_JOBS = 50;

/** The jobs whose pictures haven't been seen yet, in every story, newest first (the latest 50); never a temporary job. */
export function unseenPictureJobs(): PictureJob[] {
  const rows = db()
    .prepare(`SELECT ${COLUMNS} FROM picture_jobs WHERE seen_at IS NULL AND temporary = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(UNSEEN_JOBS) as Row[];
  return toJobs(rows);
}

export const SeenJobsSchema = z.object({ ids: z.array(z.string().min(1).max(100)).max(1000) });

/** Marks these jobs' pictures as seen (those already seen keep their time). */
export function markPictureJobsSeen({ ids }: z.infer<typeof SeenJobsSchema>): { seen: number } {
  if (ids.length === 0) return { seen: 0 };
  const done = db()
    .prepare(`UPDATE picture_jobs SET seen_at = ? WHERE seen_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`)
    .run(Date.now(), ...ids);
  return { seen: done.changes };
}

export const KnownJobsSchema = z.object({
  prompt_ids: z.array(text(200).min(1)).max(500),
  /** Chapters the jobs found in ComfyUI are for; `chapters` in the answer lists those that exist here. */
  chapter_ids: z.array(z.string().min(1).max(100)).max(500).optional(),
  /** Stories the cover jobs found in ComfyUI are for; `stories` in the answer lists those that exist here. */
  story_ids: z.array(z.string().min(1).max(100)).max(500).optional(),
});

/**
 * Which of these ComfyUI jobs are already in the log, and which of these chapters exist, so the picture
 * queue only picks up jobs that are this StoryTime's and that a page left before they finished (ComfyUI may
 * be shared with other StoryTimes and tools).
 */
export function knownPromptIds({ prompt_ids, chapter_ids = [], story_ids = [] }: z.infer<typeof KnownJobsSchema>): { known: string[]; chapters: string[]; stories: string[] } {
  const ids = (sql: string, list: string[], column: string) =>
    list.length === 0 ? [] : (db().prepare(`${sql} (${list.map(() => "?").join(",")})`).all(...list) as Record<string, string>[]).map((r) => r[column]);
  return {
    known: ids("SELECT DISTINCT prompt_id FROM picture_jobs WHERE prompt_id IN", prompt_ids, "prompt_id"),
    chapters: ids("SELECT id FROM chapters WHERE id IN", chapter_ids, "id"),
    stories: ids("SELECT id FROM stories WHERE id IN", story_ids, "id"),
  };
}

/** Pins or rejects one of a job's pictures (by its place in the job's `images`), or clears its mark with null. */
export function setPictureMark(jobId: string, index: number, mark: PictureMark | null): { mark: PictureMark | null } {
  const row = db().prepare(`SELECT images FROM picture_jobs WHERE id = ?`).get(jobId) as { images: string } | undefined;
  if (!row) throw new PostError("That picture job does not exist", 404);
  if (index >= (JSON.parse(row.images) as unknown[]).length) throw new PostError("That job has no picture at that index", 404);
  if (mark === null) {
    db().prepare(`DELETE FROM picture_marks WHERE job_id = ? AND image_index = ?`).run(jobId, index);
  } else {
    db()
      .prepare(
        `INSERT INTO picture_marks (job_id, image_index, mark, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (job_id, image_index) DO UPDATE SET mark = excluded.mark, updated_at = excluded.updated_at`,
      )
      .run(jobId, index, mark, Date.now());
  }
  return { mark };
}

export const MarkSchema = z.object({
  index: z.number().int().min(0).max(63),
  mark: z.enum(PICTURE_MARKS).nullable(),
});

/** The title of every chapter in a story, by chapter id, to label past pictures with the chapter they were made for. */
export function storyChapterTitles(storyId: string): Record<string, string> {
  const rows = db().prepare(`SELECT id, title FROM chapters WHERE story_id = ?`).all(storyId) as { id: string; title: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.title]));
}

/** The prompt and negative prompt of a job, or undefined when there is no such job. */
export function jobPrompts(jobId: string): { prompt: string; negative: string; count: number } | undefined {
  return db().prepare(`SELECT prompt, negative, json_array_length(images) AS count FROM picture_jobs WHERE id = ?`).get(jobId) as
    | { prompt: string; negative: string; count: number }
    | undefined;
}
