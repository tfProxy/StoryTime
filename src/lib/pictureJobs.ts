import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";
import { PostError } from "./stories";

// The log of picture jobs made on the ComfyUI machine (see migration 11). The pictures stay in ComfyUI;
// a job remembers where they are and the prompt and settings that made them.

const text = (max: number) => z.string().max(max);
const JobImage = z.object({ filename: text(500).min(1), subfolder: text(500), type: text(50).min(1) });

export const NewJobSchema = z.object({
  chapter_id: z.string().min(1).max(100),
  prompt_id: text(200).min(1),
  prompt: text(LIMITS.picturePrompt).min(1),
  negative: text(LIMITS.picturePrompt).default(""),
  checkpoint: text(500).default(""),
  width: z.number().int().min(1).max(16384),
  height: z.number().int().min(1).max(16384),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  count: z.number().int().min(1).max(64),
  moment: z.enum(["start", "end"]).nullish(),
  source: text(1000).nullish(),
  denoise: z.number().min(0).max(1).nullish(),
  images: z.array(JobImage).min(1).max(64),
});
export type NewJob = z.infer<typeof NewJobSchema>;

export type PictureJob = {
  id: string;
  story_id: string;
  chapter_id: string;
  prompt_id: string;
  prompt: string;
  negative: string;
  checkpoint: string;
  width: number;
  height: number;
  seed: number;
  count: number;
  moment: "start" | "end" | null;
  source: string | null;
  denoise: number | null;
  images: z.infer<typeof JobImage>[];
  created_at: number;
};

type Row = Omit<PictureJob, "images"> & { images: string; seq: number };

function toJob(row: Row): PictureJob {
  const { seq, images, ...job } = row;
  void seq; // only the cursor for paging uses it
  return { ...job, images: JSON.parse(images) };
}

const COLUMNS = `rowid AS seq, id, story_id, chapter_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
                 moment, source, denoise, images, created_at`;

/** Records a finished job for a chapter. Recording the same ComfyUI job again returns the first record. */
export function recordPictureJob(input: NewJob): PictureJob {
  const chapter = db().prepare(`SELECT story_id FROM chapters WHERE id = ?`).get(input.chapter_id) as { story_id: string } | undefined;
  if (!chapter) throw new PostError("That chapter does not exist", 404);
  const seen = db()
    .prepare(`SELECT ${COLUMNS} FROM picture_jobs WHERE chapter_id = ? AND prompt_id = ?`)
    .get(input.chapter_id, input.prompt_id) as Row | undefined;
  if (seen) return toJob(seen);
  const id = newId();
  db()
    .prepare(
      `INSERT INTO picture_jobs (id, story_id, chapter_id, prompt_id, prompt, negative, checkpoint, width, height, seed, count,
                                 moment, source, denoise, images, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, chapter.story_id, input.chapter_id, input.prompt_id, input.prompt, input.negative, input.checkpoint,
      input.width, input.height, input.seed, input.count, input.moment ?? null, input.source ?? null,
      input.denoise ?? null, JSON.stringify(input.images), Date.now(),
    );
  return toJob(db().prepare(`SELECT ${COLUMNS} FROM picture_jobs WHERE id = ?`).get(id) as Row);
}

/**
 * A page of the log, newest first, for a story or for one chapter. `before` is the cursor from the
 * previous page; `next` is the cursor for the page after this one, or null at the end.
 */
export function listPictureJobs(
  where: { story: string } | { chapter: string },
  page: { before?: number; limit: number },
): { jobs: PictureJob[]; next: number | null } {
  const [column, value] = "story" in where ? ["story_id", where.story] : ["chapter_id", where.chapter];
  const rows = db()
    .prepare(`SELECT ${COLUMNS} FROM picture_jobs WHERE ${column} = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?`)
    .all(value, page.before ?? Number.MAX_SAFE_INTEGER, page.limit + 1) as Row[];
  const more = rows.length > page.limit;
  const shown = rows.slice(0, page.limit);
  return { jobs: shown.map(toJob), next: more ? shown[shown.length - 1].seq : null };
}

/** The title of every chapter in a story, by chapter id, to label past pictures with the chapter they were made for. */
export function storyChapterTitles(storyId: string): Record<string, string> {
  const rows = db().prepare(`SELECT id, title FROM chapters WHERE story_id = ?`).all(storyId) as { id: string; title: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.title]));
}

/** The prompt and negative prompt of a job, or undefined when there is no such job. */
export function jobPrompts(jobId: string): { prompt: string; negative: string } | undefined {
  return db().prepare(`SELECT prompt, negative FROM picture_jobs WHERE id = ?`).get(jobId) as { prompt: string; negative: string } | undefined;
}
