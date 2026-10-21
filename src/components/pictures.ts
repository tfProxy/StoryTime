// What the Illustrate page knows about a picture made on ComfyUI, and the helpers its gallery uses.
// Pure code: no React.
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { ComfyImage, Progress } from "@/lib/comfy/client";
import type { PictureJob, PictureMark } from "@/lib/pictureJobs";
import { editModel } from "@/lib/comfy/editModels";

/** How a starting picture is used: redrawn from the prompt at a strength, or edited by instruction. */
export type StartMode = "redraw" | "edit";

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
  /** An edit: what it was told to change, and the edit model's id (see EDIT_MODELS); null otherwise. */
  instruction: string | null;
  editModel: string | null;
  moment: ImageMoment | null;
  /** The chapter it was made for. */
  chapterId: string;
  /** When its job finished (ms since 1970). */
  madeAt: number;
  /** How many pictures its job made together (ComfyUI's batch size); `index` is its place in that batch. */
  batch: number;
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
      instruction: job.instruction ?? null,
      editModel: job.edit_model ?? null,
      moment: job.moment,
      chapterId: job.chapter_id,
      madeAt: job.created_at,
      batch: job.images.length,
      mark: job.marks[index] ?? null,
      fresh: false,
    })),
  );
}

/** What tells pictures from the same prompt apart: the settings, and the seed when `withSeed` (the list under the pictures leaves it out; Info has it). */
export function pictureCaption(c: { seed: number; checkpoint: string; width: number; height: number; denoise: number | null; editModel?: string | null }, withSeed = false): string {
  return [
    (c.editModel && editModel(c.editModel)?.name) || c.checkpoint.replace(/\.(safetensors|ckpt)$/i, ""),
    `${c.width} × ${c.height}`,
    withSeed && `seed ${c.seed}`,
    c.denoise !== null && `strength ${c.denoise}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const MOMENT_NAMES: Record<ImageMoment, string> = { start: "chapter start", end: "chapter end" };
const SLOT_NAMES: Record<string, string> = { header: "header picture", footer: "footer picture" };

/** The file path ComfyUI keeps a picture under. */
const filePath = (image: ComfyImage) => `${image.subfolder ? `${image.subfolder}/` : ""}${image.filename}`;

/** What a starting picture (`comfy:<file>` or `saved:<chapter id>:<slot>`) was, in words. */
export function sourceText(source: string, titles: Record<string, string>): string {
  if (source.startsWith("comfy:")) return `ComfyUI picture ${source.slice("comfy:".length)}`;
  const saved = /^saved:(.+):(header|footer)$/.exec(source);
  if (saved) {
    const title = titles[saved[1]];
    return `the saved ${SLOT_NAMES[saved[2]]} of ${title ? `“${title}”` : "a chapter that has been removed"}`;
  }
  return source;
}

/** One line of a picture's details: what it is, and its value. */
export type PictureDetail = { label: string; value: string };

/**
 * Everything a picture was made with besides its prompts, for the Info popup and its Markdown: enough
 * to make it again in ComfyUI. The seed is the job's: ComfyUI gives each picture of a batch its own
 * noise from it, so the batch size and the picture's place in it count too.
 */
export function pictureDetails(p: Picture, titles: Record<string, string>): PictureDetail[] {
  const chapter = titles[p.chapterId] ? `“${titles[p.chapterId]}”` : "A chapter that has been removed";
  return [
    { label: "Chapter", value: p.moment ? `${chapter}, ${MOMENT_NAMES[p.moment]}` : chapter },
    { label: "Made", value: new Date(p.madeAt).toLocaleString() },
    ...(p.editModel
      ? [{ label: "Edit model", value: `${editModel(p.editModel)?.name ?? p.editModel} (${p.checkpoint})` }]
      : [{ label: "Checkpoint", value: p.checkpoint || "(the workflow's own)" }]),
    { label: "Size", value: `${p.width} × ${p.height}` },
    { label: "Seed", value: String(p.seed) },
    ...(p.batch > 1 ? [{ label: "Batch", value: `picture ${p.index + 1} of ${p.batch} (batch size ${p.batch}, batch index ${p.index})` }] : []),
    ...(p.source ? [{ label: "Started from", value: sourceText(p.source, titles) }] : []),
    ...(p.denoise !== null ? [{ label: "Strength (denoise)", value: String(p.denoise) }] : []),
    { label: "File", value: `${filePath(p.image)} (ComfyUI ${p.image.type})` },
  ];
}

/** A Markdown code block that holds `text` as it is, whatever backticks it contains. */
function codeBlock(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** The picture's prompts and details as Markdown, the prompts in code blocks so they copy as they are. */
export function pictureMarkdown(p: Picture, titles: Record<string, string>): string {
  return [
    `# ${p.image.filename}`,
    ...(p.instruction ? ["## Edit instruction", codeBlock(p.instruction)] : []),
    "## Prompt",
    codeBlock(p.prompt),
    "## Negative prompt",
    p.negative ? codeBlock(p.negative) : "None.",
    "## Settings",
    pictureDetails(p, titles)
      .map((d) => `- **${d.label}:** ${d.value}`)
      .join("\n"),
  ].join("\n\n") + "\n";
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
type MadeFrom = Pick<Picture, "prompt" | "negative" | "checkpoint" | "width" | "height" | "denoise" | "source" | "instruction" | "editModel" | "moment">;

/** A job still being made, with a place kept for each of its pictures. */
export type PendingJob = MadeFrom & { key: string; count: number; progress: JobProgress; stop: () => void };

/**
 * Pictures from a starting picture are its size, which is only known once it is uploaded, so the size
 * only counts for pictures made from the prompt alone.
 */
const settingsOf = (m: MadeFrom) =>
  JSON.stringify([m.prompt, m.negative, m.checkpoint, m.moment, m.source, m.denoise, m.instruction, m.editModel, m.source ? null : [m.width, m.height]]);

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

/** `inUse`: the picture is the chapter's header or footer now, so the first view shows it as if it were pinned. */
export function inView(p: Picture, view: PictureView, inUse = false): boolean {
  if (view === "rejected") return p.mark === "rejected";
  if (view === "all") return p.mark !== "rejected";
  return inUse || p.mark === "pinned" || (p.fresh && p.mark === null);
}
