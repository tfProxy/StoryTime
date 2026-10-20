// What the Illustrate page knows about a picture made on ComfyUI, and the helpers its gallery uses.
// Pure code: no React.
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { ComfyImage, Progress } from "@/lib/comfy/client";
import type { PictureJob, PictureMark } from "@/lib/pictureJobs";

/** The shared settings a picture was made with, which "Load prompt" offers to use again. */
export type MadeWith = { checkpoint: string; width: number; height: number; denoise: number | null };

/**
 * What "Load prompt" hands back: the text and, where known, the seed, the settings and the moment of the
 * job that made the pictures.
 */
export type PromptToLoad = { prompt: string; negative: string; seed: number | null; settings?: MadeWith | null; moment?: ImageMoment | null };

/**
 * One of a chapter's pictures. `jobId` is its job's record in StoryTime (null when that couldn't be
 * recorded, so it can't be marked) and `index` its place in the job's pictures. `fresh` pictures were made
 * on this visit and haven't been cleared; they show with the pinned ones.
 */
export type Picture = {
  key: string;
  jobId: string | null;
  index: number;
  image: ComfyImage;
  prompt: string;
  negative: string;
  seed: number;
  checkpoint: string;
  width: number;
  height: number;
  /** Strength, when the picture was made from a starting picture. */
  denoise: number | null;
  /** The starting picture it was made from (`comfy:…` or `saved:…`), or null. */
  source: string | null;
  moment: ImageMoment | null;
  mark: PictureMark | null;
  fresh: boolean;
};

/** A chapter's recorded jobs (newest first) as pictures, none of them fresh. */
export function picturesOf(jobs: PictureJob[]): Picture[] {
  return jobs.flatMap((job) =>
    job.images.map((image, index) => ({
      key: `${job.id}-${index}`,
      jobId: job.id,
      index,
      image,
      prompt: job.prompt,
      negative: job.negative,
      seed: job.seed,
      checkpoint: job.checkpoint,
      width: job.width,
      height: job.height,
      denoise: job.denoise,
      source: job.source,
      moment: job.moment,
      mark: job.marks[index] ?? null,
      fresh: false,
    })),
  );
}

/** What tells pictures from the same prompt apart: the seed and the settings. */
export function pictureCaption(c: { seed: number; checkpoint: string; width: number; height: number; denoise: number | null }): string {
  return [
    c.checkpoint.replace(/\.(safetensors|ckpt)$/i, ""),
    `${c.width} × ${c.height}`,
    `seed ${c.seed}`,
    c.denoise !== null && `strength ${c.denoise}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A job's progress, or "gathering" while more clicks can still be added to it. */
export type JobProgress = Progress | { stage: "gathering" };

export function progressText(p: JobProgress): string {
  if (p.stage === "gathering") return "Click again for more pictures in this job…";
  if (p.stage === "uploading") return "Sending the starting picture to ComfyUI…";
  if (p.stage === "queued") return p.ahead ? `Waiting in ComfyUI's queue (${p.ahead} ahead)…` : "Starting…";
  if (p.stage === "running") return `Step ${p.value} of ${p.max}…`;
  return "Loading the pictures…";
}

/** What a run of pictures shares: the prompts and the settings they were made with. */
type MadeFrom = Pick<Picture, "prompt" | "negative" | "checkpoint" | "width" | "height" | "denoise" | "source" | "moment">;

/** A job still being made, with a place kept for each of its pictures. */
export type PendingJob = MadeFrom & { key: string; count: number; progress: JobProgress; stop: () => void };

/**
 * Pictures from a starting picture are its size, which is only known once it is uploaded, so the size
 * only counts for pictures made from the prompt alone.
 */
const settingsOf = (m: MadeFrom) =>
  JSON.stringify([m.prompt, m.negative, m.checkpoint, m.moment, m.source, m.denoise, m.source ? null : [m.width, m.height]]);

/** A run of pictures made one after another with the same settings: its jobs still being made, then its pictures. */
export type PictureRun = { key: string; pending: PendingJob[]; pictures: Picture[] };

/**
 * The timeline, newest first: the jobs being made (newest first, so the one running now is last, next to
 * the pictures just made), then the pictures. Neighbours made with the same settings share a run; a job
 * with other settings in between starts a new one, so A, B, then A again is three runs.
 */
export function timeline(pending: PendingJob[], pictures: Picture[]): PictureRun[] {
  const runs: (PictureRun & { settings: string })[] = [];
  const runFor = (m: MadeFrom) => {
    const settings = settingsOf(m);
    const last = runs.at(-1);
    if (last?.settings === settings) return last;
    const run: PictureRun & { settings: string } = { key: "", settings, pending: [], pictures: [] };
    runs.push(run);
    return run;
  };
  for (const job of pending) runFor(job).pending.push(job);
  for (const p of pictures) runFor(p).pictures.push(p);
  // Keyed by its oldest entry, which stays the same as newer pictures join it.
  return runs.map(({ pending, pictures }) => ({ key: pictures.at(-1)?.key ?? pending.at(-1)!.key, pending, pictures }));
}

/** The gallery's views: pinned and new pictures, every picture but the rejected ones, and the rejected ones. */
export type PictureView = "shortlist" | "all" | "rejected";

export function inView(p: Picture, view: PictureView): boolean {
  if (view === "rejected") return p.mark === "rejected";
  if (view === "all") return p.mark !== "rejected";
  return p.mark === "pinned" || (p.fresh && p.mark === null);
}
