// What a Fill missing pictures run does for one picture: write its prompt, build the picture job the way the
// Illustrate page does for one text-to-image picture, and save the result as the chapter's header or footer.
// The drawing itself goes through the app's picture queue (see `WorkQueue`), so it is recorded in the job log and
// shows in the header; this file only prepares and finishes it.
import { combinePrompts, withArtStyle, withoutGiven, writeImagePrompt, type ImagePrompt } from "../ai/imagePrompt";
import type { AiSourceIds } from "../ai/client";
import { fetchImage, type ComfyImage } from "../comfy/client";
import { drawPresetFamily, drawPresetIpAdapter, toEditModels, type EditModels } from "../comfy/editModelsData";
import { modelChecksFor } from "../comfy/check";
import { familyProblems } from "../comfy/drawModels";
import { usableLoras } from "../comfy/editModels";
import { ipAdapterProblem } from "../comfy/ipAdapter";
import type { JobInput } from "../comfy/makeJob";
import { drawPresetFor, usesFamily, type DrawPreset } from "../comfy/presets";
import { asReference, type Reference } from "../comfy/references";
import { fromCodex, fromComfyImage, fromSaved } from "../comfy/startPicture";
import { describeWorkflow, parseWorkflow } from "../comfy/workflow";
import { chapterTarget, coverTarget, savedPictureApi } from "../pictureTarget";
import { prepareImage } from "../prepareImage";
import type { Settings } from "../settingsSchema";
import type { StoredReference } from "../comfy/references";
import { getContext, type ChapterContext, type Fetch } from "./api";
import type { PictureTask, RunOptions } from "./types";

/** Saved pictures keep at most this many pixels on their longest side, like uploads. */
const MAX_SIDE = 1600;

/** What a picture's prompt and job are made from. */
export type PictureSetup = {
  story: { id: string; title: string; premise: string; art_style: string; draw_preset: string | null; style_ref: StoredReference | null };
  /** The chapter's own drawing preset (an id from Settings), or null to follow the story's. */
  chapterPreset: string | null;
  /** Text the chapter's prompts always include. */
  fixed: string;
  /** The story down to the chapter, with the codex as of it. */
  context: ChapterContext;
};

async function getJson<T>(f: Fetch, url: string): Promise<T> {
  const res = await f(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `The request failed (${res.status})`);
  return data as T;
}

export async function loadSetup(f: Fetch, chapterId: string): Promise<PictureSetup> {
  const context = await getContext(f, chapterId);
  const [story, preset, fixed] = await Promise.all([
    getJson<PictureSetup["story"]>(f, `/api/stories/${context.story.id}`),
    getJson<{ draw_preset: string | null }>(f, `/api/chapters/${chapterId}/picture-preset`),
    getJson<{ fixed: string }>(f, `/api/chapters/${chapterId}/picture-fixed`),
  ]);
  return { story, chapterPreset: preset.draw_preset, fixed: fixed.fixed, context };
}

/** The drawing preset the chapter's pictures use: its own, else the story's, else the first. */
export const presetOf = (settings: Settings, setup: PictureSetup): DrawPreset => drawPresetFor(settings.comfy.drawPresets, setup.chapterPreset, setup.story.draw_preset);

/** The moment a slot's picture shows: the chapter's start for a header, its middle for a middle picture, its end for a footer. */
export const momentOf = (slot: PictureTask["slot"]) => (slot === "header" ? ("start" as const) : slot === "middle" ? ("middle" as const) : ("end" as const));

/** Whether the chapter already has this picture (made by hand meanwhile, or by an earlier run). */
export async function hasPicture(f: Fetch, chapterId: string, slot: PictureTask["slot"]): Promise<boolean> {
  const res = await f(`/api/chapters/${chapterId}/images/${slot}`, { method: "HEAD" });
  return res.ok;
}

/** What the prompt writer made, as the prompt boxes hold it (the preset's and the chapter's always-included text are added when the picture is drawn). */
export type WrittenPrompt = { prompt: string; negative: string; scene: string };

/** The picture prompt for a slot, written by the cheaper model from the story down to the chapter, and kept as that moment's prompt boxes so the Illustrate page shows what was used. */
export async function writePicturePrompt(
  settings: Settings,
  f: Fetch,
  setup: PictureSetup,
  task: PictureTask,
  options: RunOptions,
  deps: { write?: typeof writeImagePrompt; signal?: AbortSignal; source?: AiSourceIds } = {},
): Promise<WrittenPrompt> {
  const draw = presetOf(settings, setup);
  const style = draw.promptStyle;
  const write = deps.write ?? writeImagePrompt;
  const made: ImagePrompt = await write(settings, {
    story: { title: setup.story.title, premise: setup.story.premise },
    path: setup.context.path,
    codex: setup.context.codex,
    moment: momentOf(task.slot),
    direction: "",
    style,
    fixed: combinePrompts(style, setup.fixed, draw.prompt),
    model: options.suggestModel ?? null,
    signal: deps.signal,
    source: deps.source,
  });
  const prompt = withArtStyle(withoutGiven(made.prompt, [setup.fixed, draw.prompt], style), setup.story.art_style, style);
  const negative = withoutGiven(made.negative, [draw.negative], style);
  const res = await f(`/api/chapters/${task.chapterId}/picture-draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, negative, scene: made.scene, direction: "", moment: momentOf(task.slot) }),
  });
  if (!res.ok) throw new Error(`Couldn't keep the prompt for the Illustrate page (${res.status})`);
  return { prompt, negative, scene: made.scene };
}

/** The story's style picture as a reference, when its source can be found again. */
function styleReference(setup: PictureSetup, comfyUrl: string): Reference | null {
  const stored = setup.story.style_ref;
  if (!stored) return null;
  const { source } = stored;
  let picture = null;
  if (source.startsWith("codex:")) picture = fromCodex(setup.story.id, source.slice("codex:".length));
  else if (source.startsWith("comfy:") && comfyUrl) {
    const path = source.slice("comfy:".length);
    const cut = path.lastIndexOf("/");
    picture = fromComfyImage(comfyUrl, { filename: path.slice(cut + 1), subfolder: cut < 0 ? "" : path.slice(0, cut), type: "output" });
  } else if (source.startsWith("saved:")) {
    const [, owner, slot] = source.split(":");
    if (slot === "cover") picture = fromSaved(coverTarget(owner), "cover", Date.now());
    else if (slot === "header" || slot === "middle" || slot === "footer") picture = fromSaved(chapterTarget(setup.story.id, owner), slot, Date.now());
  }
  return picture ? asReference(picture, stored.label, "style", stored.weight) : null;
}

/** Whether the drawing preset's workflow can take reference pictures. */
function workflowCanRefs(workflow: string): boolean {
  try {
    return describeWorkflow(parseWorkflow(workflow)).refs;
  } catch {
    return false;
  }
}

/** What ComfyUI has installed, asked once per address. */
export async function loadModels(comfyUrl: string): Promise<EditModels> {
  try {
    return toEditModels(await modelChecksFor(comfyUrl));
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export type PictureJob = {
  input: JobInput;
  /** What the Pictures panel shows for the job while it is made. */
  prompt: string;
  negative: string;
};

/**
 * The picture job for a slot, built as the Illustrate page builds one text-to-image picture (`ComfyGenerate.ask`): the
 * prompt boxes with the preset's text and the chapter's always-included text added, the preset's LoRAs that ComfyUI
 * has, the family's check, the size from Settings (with its multiplier), no starting picture, no edit. Reference
 * pictures only when the run asks for them and the preset can use them, otherwise none and no complaint.
 * Returns a problem to stop the run with when the picture can't be made at all.
 */
export function buildPictureJob(
  settings: Settings,
  setup: PictureSetup,
  task: PictureTask,
  written: { prompt: string; negative: string },
  models: EditModels,
  options: RunOptions,
  session: string,
): { job: PictureJob } | { problem: string } {
  const comfy0 = settings.comfy;
  if (!comfy0.url.trim()) return { problem: "ComfyUI isn't set up. Add its address in Settings first." };
  if (models.state === "error") return { problem: `Couldn't ask ComfyUI what it has: ${models.message}` };
  if (models.state === "checking") return { problem: "Still asking ComfyUI what it has. Try again in a moment." };
  const draw = presetOf(settings, setup);
  const style = draw.promptStyle;
  const fromFamily = usesFamily(draw);
  const family = drawPresetFamily(models, draw);
  if (fromFamily && (!family || !family.ready)) {
    return { problem: `The drawing preset “${draw.name}” can't draw yet. ${family ? familyProblems(family).join(" ") : "ComfyUI hasn't said which files it has."} Settings › Drawing has the details.` };
  }
  // The size from Settings, times the multiplier, to a multiple of 16.
  const scale = comfy0.sizeScale;
  const scaled = (n: number) => (scale === 1 ? n : Math.max(64, Math.round((n * scale) / 16) * 16));
  const comfy = { ...comfy0, width: scaled(comfy0.width), height: scaled(comfy0.height) };
  const prompt = draw.prompt.trim() || setup.fixed.trim() ? combinePrompts(style, draw.prompt, setup.fixed, written.prompt) : written.prompt;
  const negative = draw.negative.trim() ? combinePrompts(style, written.negative, draw.negative) : written.negative;
  const loras = usableLoras(draw.loras, models.loras).loras;
  const ipAdapter = drawPresetIpAdapter(models, draw);
  // References (D12): the story's style picture, and for a footer the chapter's header. None when the preset can't use them.
  let refs: Reference[] | undefined;
  if (options.useRefs && !fromFamily && workflowCanRefs(draw.workflow) && !ipAdapterProblem(ipAdapter)) {
    const style0 = styleReference(setup, comfy.url);
    const header = task.slot === "footer" ? asReference(fromSaved(chapterTarget(setup.story.id, task.chapterId), "header", Date.now()), "Header picture", "place") : null;
    refs = [style0, header].filter((r): r is Reference => !!r);
    if (refs.length === 0) refs = undefined;
  }
  const input: JobInput = {
    prompt,
    negative,
    moment: momentOf(task.slot),
    comfy,
    draw,
    drawLoras: loras,
    family: fromFamily ? family : null,
    redraw: draw.denoise,
    start: null,
    edit: null,
    seed: null,
    refs,
    ipAdapter,
    session,
    base: task.id,
  };
  return { job: { input, prompt, negative } };
}

/** Saves a drawn picture as the chapter's header or footer, as the Illustrate page's “Use as” does (which also pins it and keeps its prompt with it). */
export async function savePicture(
  f: Fetch,
  comfyUrl: string,
  task: PictureTask,
  image: ComfyImage,
  jobId: string | null,
  index: number,
  /** Scales and re-encodes the picture: the browser's by default; the server passes its own, which has no canvas. */
  prepare: (file: Blob, maxSide: number) => Promise<Blob> = prepareImage,
): Promise<void> {
  const blob = await prepare(await fetchImage(comfyUrl, image), MAX_SIDE);
  const target = chapterTarget("", task.chapterId);
  const api = savedPictureApi(target, task.slot);
  const url = jobId ? `${api}?job=${encodeURIComponent(jobId)}&index=${index}` : api;
  const res = await f(url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Couldn't save the picture (${res.status})`);
}
