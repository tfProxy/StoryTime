// What the Illustrate page knows about a picture made on ComfyUI, and the helpers its gallery uses.
// Pure code: no React.
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { ComfyImage } from "@/lib/comfy/client";
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

/** Pictures grouped by the prompt and negative prompt that made them, in the order each group first appears. */
export function byPrompt(pictures: Picture[]): Picture[][] {
  const groups = new Map<string, Picture[]>();
  for (const p of pictures) {
    const key = `${p.prompt}\u0000${p.negative}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

/** The gallery's views: pinned and new pictures, every picture but the rejected ones, and the rejected ones. */
export type PictureView = "shortlist" | "all" | "rejected";

export function inView(p: Picture, view: PictureView): boolean {
  if (view === "rejected") return p.mark === "rejected";
  if (view === "all") return p.mark !== "rejected";
  return p.mark === "pinned" || (p.fresh && p.mark === null);
}
