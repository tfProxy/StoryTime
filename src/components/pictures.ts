// What the Illustrate page knows about a picture made on ComfyUI, and the helpers its gallery uses.
// Pure code: no React.
import type { ComfyImage, Progress } from "@/lib/comfy/client";
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { PictureMoment } from "@/lib/pictureTarget";
import type { PictureJob, PictureMark } from "@/lib/pictureJobs";
import { editFilesExtras, editModel } from "@/lib/comfy/editModels";
import { referenceText, type StoredReference } from "@/lib/comfy/references";

/** "1 LoRA", "3 LoRAs", or nothing for none. */
const loraCount = (n: number) => (n === 0 ? false : n === 1 ? "1 LoRA" : `${n} LoRAs`);

/**
 * What choosing a picture's ☰ menu item asks for: the picture as the Instruct starting picture ("Instruct
 * changes"), the picture added to the References ("Use as reference"), which leaves the starting picture
 * alone, or the Refine screen ("Refine…"), which opens a session for the picture.
 */
export type StartRequest = "instruct" | "reference" | "refine";

/** The shared settings a picture was made with, which "Load prompt" offers to use again. */
export type MadeWith = { checkpoint: string; width: number; height: number; denoise: number | null };

/**
 * What "Load prompt" hands back: the text and, where known, the seed, the settings and the moment of the
 * job that made the pictures.
 */
export type PromptToLoad = {
  prompt: string;
  negative: string;
  seed: number | null;
  settings?: MadeWith | null;
  moment?: PictureMoment | null;
  /** The references the pictures were made with (Load prompt brings them back from 2c on). */
  refs?: StoredReference[];
};

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
  /** The mask's file name in ComfyUI's input folder when only a painted part of the starting picture was redrawn, else null. */
  mask: string | null;
  /** The reference pictures it was made with (none when missing or empty). */
  refs?: StoredReference[];
  /** An edit: what it was told to change, and the edit model's id (see EDIT_MODELS); null otherwise. */
  instruction: string | null;
  editModel: string | null;
  moment: PictureMoment | null;
  /** Made by the Refine screen: hidden (see `inView`) unless pinned or the Pictures panel's switch is on. */
  temporary?: boolean;
  /** The chapter it was made for, or null for the story's cover. */
  chapterId: string | null;
  /** When its job finished (ms since 1970). */
  madeAt: number;
  /** How many pictures its job made together (ComfyUI's batch size); `index` is its place in that batch. */
  batch: number;
  mark: PictureMark | null;
  fresh: boolean;
  /** Its job finished while the chapter's page wasn't open, and the picture hasn't been touched since this page opened: it has a New badge. */
  isNew?: boolean;
};

/** A chapter's recorded jobs (newest first) as pictures; those not seen yet (finished while the page wasn't open) are fresh. */
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
      mask: job.mask ?? null,
      refs: job.refs ?? [],
      instruction: job.instruction ?? null,
      editModel: job.edit_model ?? null,
      moment: job.moment,
      ...(job.temporary && { temporary: true }),
      chapterId: job.chapter_id,
      madeAt: job.created_at,
      batch: job.images.length,
      mark: job.marks[index] ?? null,
      fresh: job.seen_at === null,
      isNew: job.seen_at === null,
    })),
  );
}

/** What tells pictures from the same prompt apart: the settings, and the seed when `withSeed` (the list under the pictures leaves it out; Info has it). */
export function pictureCaption(c: { seed: number; checkpoint: string; width: number; height: number; denoise: number | null; mask?: string | null; editModel?: string | null; temporary?: boolean; mark?: PictureMark | null }, withSeed = false): string {
  // The files come after the model's or checkpoint's, joined by " + ": an edit's speed-up, and the LoRAs (each with its strength).
  const [main, ...extras] = c.checkpoint.split(" + ");
  return [
    (c.editModel && editModel(c.editModel)?.name) || main.replace(/\.(safetensors|ckpt)$/i, ""),
    c.editModel && editFilesExtras(c.editModel, c.checkpoint).fast && "fast",
    loraCount(c.editModel ? editFilesExtras(c.editModel, c.checkpoint).loras : extras.filter((e) => /\(-?[\d.]+\)$/.test(e)).length),
    `${c.width} × ${c.height}`,
    withSeed && `seed ${c.seed}`,
    c.denoise !== null && `strength ${c.denoise}`,
    c.mask && "painted area",
    // A pinned temporary picture (an accepted Refine result) is a kept picture.
    c.temporary && c.mark !== "pinned" && "temporary",
  ]
    .filter(Boolean)
    .join(" · ");
}

const MOMENT_NAMES: Record<ImageMoment, string> = { start: "chapter start", end: "chapter end" };
const SLOT_NAMES: Record<string, string> = { header: "header picture", footer: "footer picture" };

/** The file path ComfyUI keeps a picture under. */
const filePath = (image: ComfyImage) => `${image.subfolder ? `${image.subfolder}/` : ""}${image.filename}`;

/** What a starting picture (`comfy:<file>`, `saved:<chapter id>:<slot>` or `saved:<story id>:cover`) was, in words. */
export function sourceText(source: string, titles: Record<string, string>): string {
  if (source.startsWith("comfy:")) return `ComfyUI picture ${source.slice("comfy:".length)}`;
  if (source.startsWith("codex:")) return "a saved codex picture";
  if (/^saved:.+:cover$/.test(source)) return "the story's saved cover";
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
  const chapter = p.chapterId !== null && titles[p.chapterId] ? `“${titles[p.chapterId]}”` : "A chapter that has been removed";
  return [
    p.chapterId === null
      ? { label: "For", value: p.moment === "codex" ? "a codex entry's picture" : "the story's cover" }
      : { label: "Chapter", value: p.moment === "start" || p.moment === "end" ? `${chapter}, ${MOMENT_NAMES[p.moment]}` : chapter },
    { label: "Made", value: new Date(p.madeAt).toLocaleString() },
    ...(p.editModel
      ? [{ label: "Edit model", value: `${editModel(p.editModel)?.name ?? p.editModel} (${p.checkpoint})` }]
      : [{ label: "Checkpoint", value: p.checkpoint || "(the workflow's own)" }]),
    { label: "Size", value: `${p.width} × ${p.height}` },
    { label: "Seed", value: String(p.seed) },
    ...(p.batch > 1 ? [{ label: "Batch", value: `picture ${p.index + 1} of ${p.batch} (batch size ${p.batch}, batch index ${p.index})` }] : []),
    ...(p.source ? [{ label: "Started from", value: sourceText(p.source, titles) }] : []),
    ...(p.denoise !== null ? [{ label: "Strength (denoise)", value: String(p.denoise) }] : []),
    ...(p.mask ? [{ label: "Area", value: "painted part only" }] : []),
    ...(p.refs?.length ? [{ label: "References", value: p.refs.map(referenceText).join(", ") }] : []),
    ...(p.temporary && p.mark !== "pinned" ? [{ label: "Temporary", value: "Refine (shown only on request, unless pinned)" }] : []),
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
type MadeFrom = Pick<Picture, "prompt" | "negative" | "checkpoint" | "width" | "height" | "denoise" | "source" | "mask" | "refs" | "instruction" | "editModel" | "moment" | "temporary">;

/** A job still being made, with a place kept for each of its pictures. */
export type PendingJob = MadeFrom & { key: string; count: number; progress: JobProgress; stop: () => void };

/**
 * Pictures from a starting picture are its size, which is only known once it is uploaded, so the size
 * only counts for pictures made from the prompt alone.
 */
const settingsOf = (m: MadeFrom) =>
  JSON.stringify([m.prompt, m.negative, m.checkpoint, m.moment, m.source, m.denoise, m.mask, m.instruction, m.editModel, (m.refs ?? []).map((r) => [r.source, r.role, r.weight]), !!m.temporary, m.source ? null : [m.width, m.height]]);

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

/** The gallery's views: pinned and new pictures, every picture but the trashed ones, and the trashed ones (marked "rejected"). */
export type PictureView = "shortlist" | "all" | "rejected";

/** A temporary picture (or job being made) shows only when the author asked for them, or the picture is pinned (kept). */
export const hiddenTemporary = (p: { temporary?: boolean; mark?: PictureMark | null }, includeTemporary: boolean): boolean => !!p.temporary && !includeTemporary && p.mark !== "pinned";

/**
 * `inUse`: the picture is the chapter's header or footer now, or the one being edited, so the first view shows it as if it were pinned.
 * `includeTemporary`: the "Include temporary inpainting images" switch; without it a temporary picture shows in no view unless pinned.
 */
export function inView(p: Picture, view: PictureView, inUse = false, includeTemporary = false): boolean {
  if (hiddenTemporary(p, includeTemporary)) return false;
  if (view === "rejected") return p.mark === "rejected";
  if (view === "all") return p.mark !== "rejected";
  return inUse || p.mark === "pinned" || (p.fresh && p.mark === null);
}
