// ComfyUI workflows in "API format": an object of nodes keyed by id, each { class_type, inputs }.
// An input is a value, or a link [nodeId, outputIndex] to another node. Pure code, no network.
//
// A workflow gets the picture's settings in one of two ways:
// - placeholders: any input that is exactly "{{seed}}", "{{width}}", "{{height}}" or "{{count}}"
//   becomes that number, and "{{prompt}}", "{{negative}}" and "{{checkpoint}}" are replaced inside
//   any text input;
// - or, when there are no placeholders, the usual nodes are found and filled in: the checkpoint
//   loader, the empty latent image, the sampler's seed, and the text encoders feeding the sampler.
//
// Starting from a picture (image to image): "{{image}}" is the name of the picture uploaded to ComfyUI
// (put it in a LoadImage node) and "{{denoise}}" is the strength, 0 to 1. The built-in workflow has an
// image variant. A workflow without placeholders has its empty latent image replaced by the picture
// (LoadImage, VAEEncode, RepeatLatentBatch) and its samplers' `denoise` set.
//
// Redrawing only a painted area (inpainting): `mask` is a picture already in ComfyUI's input folder, the
// same size as the starting one, white where to redraw and black where to keep. The built-in workflow has
// a mask variant. "{{mask}}" is the mask's name (put it in a LoadImageMask node). A workflow without
// placeholders gets the mask applied to the latent (SetLatentNoiseMask) and the new pictures pasted back
// over the original outside the mask (InvertMask, ImageCompositeMasked) before they are saved.
//
// Either way, the saved pictures' file name prefix (`filename_prefix`) is set when it is "StoryTime",
// the built-in workflow's prefix, or contains "{{prefix}}". Any other prefix is left alone.

import { withReferences, type RefInput, type RefMode } from "./ipAdapter";
import type { CropPlan } from "./inpaintRegion";

export type WorkflowNode = { class_type: string; inputs: Record<string, unknown>; _meta?: unknown };
export type Workflow = Record<string, WorkflowNode>;

export type PictureParams = {
  prompt: string;
  negative: string;
  checkpoint: string;
  width: number;
  height: number;
  count: number;
  seed: number;
  /** Where ComfyUI files the pictures; see `filenamePrefix`. Without it they keep the default prefix. */
  prefix?: string;
  /** Image to image: the starting picture's name in ComfyUI's input folder. The size then comes from the picture. */
  image?: string;
  /** Inpainting: the mask's name in ComfyUI's input folder (white = redraw). Only used together with `image`. */
  mask?: string;
  /** Inpainting: how many pixels the sampled mask grows past the painted one (the paste-back keeps the painted one). */
  grow?: number;
  /** Inpainting: redraw from this crop of the picture (the painted area plus context), scaled to its `sw` by `sh`, and paste it back. Not used by workflows with placeholders. */
  crop?: CropPlan;
  /** Inpainting: what the sampler sees under the painted area (see `fillUnderMask`); left out to keep the picture as it is. */
  fill?: FillKind;
  /** Image to image: how far the pictures may drift from the starting one, 0 to 1 (default 1). */
  denoise?: number;
  /** The built-in workflow's sampler settings (from the preset); other workflows keep their own. */
  sampler?: SamplerTuning;
  /** The preset's LoRAs, applied in order after the checkpoint (see `addLoras`). */
  loras?: { name: string; strength: number }[];
  /** Reference pictures (already in ComfyUI's input folder), put in front of the sampler's model with IP-Adapter; needs `ipAdapter`. */
  refs?: RefInput[];
  /** The IP-Adapter and CLIP Vision file names to use for `refs`, and how non-style references are followed (see `withReferences`). */
  ipAdapter?: { ipadapter: string; clipVision: string; mode?: RefMode; end?: number };
};

/** What a sampler runs with: its steps, CFG, sampler and scheduler (names as ComfyUI's KSampler lists them). */
export type SamplerTuning = { steps: number; cfg: number; sampler: string; scheduler: string };

/** The built-in workflow's sampler settings, unless changed in Settings: 30 steps of DPM++ 2M Karras at CFG 6. */
export const BUILTIN_SAMPLER: SamplerTuning = { steps: 30, cfg: 6, sampler: "dpmpp_2m", scheduler: "karras" };

/** The built-in workflow's sampler settings with the ones changed in Settings. */
export const builtinSampler = (changed: Partial<SamplerTuning> = {}): SamplerTuning => ({ ...BUILTIN_SAMPLER, ...changed });

const DEFAULT_PREFIX = "StoryTime";

/** The file name prefix for a chapter's pictures (or, with no chapter, the story's covers, or a codex entry's), so they can be found in ComfyUI's output folder. */
export const filenamePrefix = (storyId: string, chapterId: string | null, entryId: string | null = null) =>
  `${DEFAULT_PREFIX}/${storyId}/${entryId ? `codex/${entryId}` : (chapterId ?? "cover")}`;

/** What a workflow lets StoryTime set, for showing in Settings. */
export type WorkflowFit = {
  mode: "builtin" | "placeholders" | "detected";
  prompt: boolean;
  negative: boolean;
  checkpoint: boolean;
  size: boolean;
  count: boolean;
  seed: boolean;
  /** Whether it can start from a picture. */
  image: boolean;
  /** Whether it can redraw only part of a picture (needs a picture to start from). */
  mask: boolean;
  /** Whether it can take reference pictures (IP-Adapter in front of the sampler's model); placeholder workflows can't. */
  refs: boolean;
};

/** Text-to-image with an SDXL checkpoint: 30 steps of DPM++ 2M Karras at CFG 6 (BUILTIN_SAMPLER; Settings can change them). */
export const BUILTIN_WORKFLOW: Workflow = {
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: "{{seed}}", steps: 30, cfg: 6, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1,
      model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
    },
  },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{checkpoint}}" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: "{{height}}", batch_size: "{{count}}" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "{{negative}}", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "StoryTime", images: ["8", 0] } },
};

/** The built-in workflow starting from a picture: its latent comes from the picture, not an empty image. */
export const BUILTIN_IMG2IMG: Workflow = {
  ...Object.fromEntries(Object.entries(BUILTIN_WORKFLOW).filter(([id]) => id !== "5")),
  "3": { class_type: "KSampler", inputs: { ...BUILTIN_WORKFLOW["3"].inputs, denoise: "{{denoise}}", latent_image: ["12", 0] } },
  "10": { class_type: "LoadImage", inputs: { image: "{{image}}" } },
  "11": { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["4", 2] } },
  "12": { class_type: "RepeatLatentBatch", inputs: { samples: ["11", 0], amount: "{{count}}" } },
};

/**
 * The built-in image workflow redrawing only a painted area: the mask limits the latent's noise, and the
 * new pictures are pasted over the original wherever the mask is black. The destination is the new batch
 * and the source the original, because ComfyUI repeats the source to the destination's batch size.
 */
export const BUILTIN_INPAINT: Workflow = {
  ...BUILTIN_IMG2IMG,
  "3": { class_type: "KSampler", inputs: { ...BUILTIN_IMG2IMG["3"].inputs, latent_image: ["14", 0] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "StoryTime", images: ["16", 0] } },
  "13": { class_type: "LoadImageMask", inputs: { image: "{{mask}}", channel: "red" } },
  "14": { class_type: "SetLatentNoiseMask", inputs: { samples: ["12", 0], mask: ["13", 0] } },
  "15": { class_type: "InvertMask", inputs: { mask: ["13", 0] } },
  "16": { class_type: "ImageCompositeMasked", inputs: { destination: ["8", 0], source: ["10", 0], x: 0, y: 0, resize_source: false, mask: ["15", 0] } },
};

export class WorkflowError extends Error {}

/** Reads a workflow pasted into Settings; "" means the built-in one. Throws WorkflowError explaining what is wrong. */
export function parseWorkflow(text: string): Workflow {
  if (!text.trim()) return BUILTIN_WORKFLOW;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkflowError("The workflow isn't valid JSON. In ComfyUI, use Workflow › Export (API) and paste the whole file.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WorkflowError("The workflow should be a JSON object of nodes.");
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.nodes) && Array.isArray(obj.links)) {
    throw new WorkflowError("That is ComfyUI's regular workflow file. StoryTime needs the API format: in ComfyUI, use Workflow › Export (API).");
  }
  const nodes = Object.entries(obj);
  if (nodes.length === 0) throw new WorkflowError("The workflow has no nodes.");
  for (const [id, n] of nodes) {
    const node = n as Partial<WorkflowNode> | null;
    if (!node || typeof node !== "object" || typeof node.class_type !== "string" || !node.inputs || typeof node.inputs !== "object") {
      throw new WorkflowError(`Node ${id} in the workflow has no class_type or inputs; is this the API format?`);
    }
  }
  return obj as Workflow;
}

const NUMBER_SLOTS = { "{{seed}}": "seed", "{{width}}": "width", "{{height}}": "height", "{{count}}": "count", "{{denoise}}": "denoise" } as const;
const TEXT_SLOTS = { "{{prompt}}": "prompt", "{{negative}}": "negative", "{{checkpoint}}": "checkpoint", "{{image}}": "image", "{{mask}}": "mask" } as const;

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

function placeholdersIn(wf: Workflow): Set<string> {
  const found = new Set<string>();
  for (const node of Object.values(wf)) {
    for (const v of Object.values(node.inputs)) {
      if (typeof v !== "string") continue;
      for (const key of [...Object.keys(NUMBER_SLOTS), ...Object.keys(TEXT_SLOTS)]) if (v.includes(key)) found.add(key);
    }
  }
  return found;
}

const SAMPLERS = /^(KSampler|KSamplerAdvanced|SamplerCustom|SamplerCustomAdvanced)$/;
const LATENTS = /^Empty.*LatentImage$/;
const SEED_INPUTS = ["seed", "noise_seed"];

/** The text-encoder node a conditioning input ends up at, following links back through other nodes. */
function textEncoderFor(wf: Workflow, link: unknown, seen = new Set<string>()): string | null {
  if (!isLink(link) || seen.has(link[0])) return null;
  seen.add(link[0]);
  const node = wf[link[0]];
  if (!node) return null;
  if (/TextEncode/.test(node.class_type)) return link[0];
  // Pass through nodes like FluxGuidance or ConditioningCombine, and guiders (BasicGuider, CFGGuider).
  for (const key of ["conditioning", "positive", "conditioning_1", "guider"]) {
    const next = textEncoderFor(wf, node.inputs[key], seen);
    if (next) return next;
  }
  return null;
}

/** The positive and negative prompt nodes, found from the samplers (and guiders) in the workflow. */
function promptNodes(wf: Workflow): { positive: string | null; negative: string | null } {
  let positive: string | null = null;
  let negative: string | null = null;
  for (const node of Object.values(wf)) {
    if (!SAMPLERS.test(node.class_type) && !/Guider$/.test(node.class_type)) continue;
    positive ??= textEncoderFor(wf, node.inputs.positive) ?? textEncoderFor(wf, node.inputs.conditioning) ?? textEncoderFor(wf, node.inputs.guider);
    negative ??= textEncoderFor(wf, node.inputs.negative);
  }
  return { positive, negative: negative === positive ? null : negative };
}

const hasDenoise = (n: WorkflowNode) => typeof n.inputs.denoise === "number";

/** Where the VAE comes from, as a link: the decoder's own, else the checkpoint's. */
function vaeSource(wf: Workflow): [string, number] | null {
  for (const node of Object.values(wf)) if (node.class_type === "VAEDecode" && isLink(node.inputs.vae)) return node.inputs.vae;
  const loader = Object.entries(wf).find(([, n]) => n.class_type === "CheckpointLoaderSimple");
  return loader ? [loader[0], 2] : null;
}

/** What the workflow lets StoryTime set. */
export function describeWorkflow(wf: Workflow): WorkflowFit {
  if (wf === BUILTIN_WORKFLOW) return { mode: "builtin", prompt: true, negative: true, checkpoint: true, size: true, count: true, seed: true, image: true, mask: true, refs: true };
  const found = placeholdersIn(wf);
  if (found.size > 0) {
    return {
      mode: "placeholders",
      prompt: found.has("{{prompt}}"),
      negative: found.has("{{negative}}"),
      checkpoint: found.has("{{checkpoint}}"),
      size: found.has("{{width}}") && found.has("{{height}}"),
      count: found.has("{{count}}"),
      seed: found.has("{{seed}}"),
      image: found.has("{{image}}"),
      mask: found.has("{{mask}}"),
      refs: false,
    };
  }
  const nodes = Object.values(wf);
  const { positive, negative } = promptNodes(wf);
  const image = nodes.some((n) => LATENTS.test(n.class_type)) && vaeSource(wf) !== null && nodes.some(hasDenoise);
  return {
    mode: "detected",
    prompt: positive !== null,
    negative: negative !== null,
    checkpoint: nodes.some((n) => n.class_type === "CheckpointLoaderSimple"),
    size: nodes.some((n) => LATENTS.test(n.class_type)),
    count: nodes.some((n) => LATENTS.test(n.class_type)),
    seed: nodes.some((n) => SEED_INPUTS.some((k) => typeof n.inputs[k] === "number")),
    image,
    mask: image,
    refs: nodes.some((n) => /^(KSampler|KSamplerAdvanced)$/.test(n.class_type) && isLink(n.inputs.model)),
  };
}

/** Sets the file name prefix of the saved pictures, where the workflow lets StoryTime choose it. */
function setPrefix(wf: Workflow, prefix: string) {
  for (const node of Object.values(wf)) {
    const v = node.inputs.filename_prefix;
    if (typeof v !== "string") continue;
    if (v.includes("{{prefix}}")) node.inputs.filename_prefix = v.split("{{prefix}}").join(prefix);
    else if (v === DEFAULT_PREFIX) node.inputs.filename_prefix = prefix;
  }
}

/** Steps a redraw at `denoise` runs: the share of `steps` it needs, but at least 4 (or all of them if fewer). */
export const stepsToRun = (steps: number, denoise: number) => Math.min(steps, Math.max(Math.round(steps * denoise), Math.min(steps, 4)));

/**
 * Turns a KSampler that starts from a picture (denoise below 1) into a KSamplerAdvanced that starts part way
 * through its steps. ComfyUI's KSampler would run all of `steps` on a longer schedule; this runs only
 * stepsToRun(steps, denoise). Everything else about the node is kept, and its id, so links to it still work.
 */
export function partialSteps(node: WorkflowNode) {
  const i = node.inputs;
  const denoise = i.denoise;
  if (node.class_type !== "KSampler" || typeof denoise !== "number" || !(denoise > 0 && denoise < 1)) return;
  const steps = i.steps as number;
  node.class_type = "KSamplerAdvanced";
  node.inputs = {
    add_noise: "enable", noise_seed: i.seed, steps, cfg: i.cfg, sampler_name: i.sampler_name, scheduler: i.scheduler,
    start_at_step: steps - stepsToRun(steps, denoise), end_at_step: 10000, return_with_leftover_noise: "disable",
    model: i.model, positive: i.positive, negative: i.negative, latent_image: i.latent_image,
  };
}

/** A copy of the workflow with the picture's settings filled in. Throws WorkflowError if the prompt has nowhere to go. */
export function fillWorkflow(wf: Workflow, p: PictureParams): Workflow {
  const builtin = wf === BUILTIN_WORKFLOW;
  const refs = p.refs ?? [];
  if (refs.length > 0) {
    if (!describeWorkflow(wf).refs) {
      throw new WorkflowError("This workflow can't take reference pictures: it has placeholders, so StoryTime can't tell where the sampler's model comes from. Take the references out, or use a workflow without placeholders.");
    }
    if (!p.ipAdapter) throw new WorkflowError("Reference pictures need the IP-Adapter and CLIP Vision files, and none were given.");
  }
  // The built-in workflow with a crop starts from the plain image variant: the static inpaint graph has no place for a crop.
  const cropped = !!(p.image && p.mask && p.crop && builtin);
  let out = fillSettings(p.image && builtin ? (p.mask && !cropped ? BUILTIN_INPAINT : BUILTIN_IMG2IMG) : wf, cropped ? { ...p, mask: undefined } : p);
  if (cropped) redrawCropped(out, { mask: p.mask!, full: "10", repeat: "12", count: p.count, crop: p.crop!, grow: p.grow ?? 0, scale: true });
  if (builtin && p.sampler) {
    const { steps, cfg, sampler, scheduler } = p.sampler;
    Object.assign(out["3"].inputs, { steps, cfg, sampler_name: sampler, scheduler });
  }
  if (builtin && p.image) partialSteps(out["3"]);
  addLoras(out, p.loras ?? []);
  // After the LoRAs, so the references' adapters wrap the model the sampler really uses.
  if (refs.length > 0) out = withReferences(out, refs, p.ipAdapter!);
  // Our own graphs get the grown mask and Differential Diffusion; a workflow with placeholders is left as its author wired it.
  if (p.image && p.mask && (builtin || placeholdersIn(wf).size === 0)) {
    // A cropped redraw (redrawCropped) has grown its mask already, in the crop's pixels.
    if (!p.crop) growNoiseMask(out, p.grow ?? 0);
    addDifferentialDiffusion(out);
    // Not cropped: the picture is encoded at its own size; cropped: at the crop's scaled size.
    fillUnderMask(out, { kind: p.fill ?? "keep", size: p.crop ? { w: p.crop.sw, h: p.crop.sh } : { w: p.width, h: p.height } });
  }
  setPrefix(out, p.prefix ?? DEFAULT_PREFIX);
  return out;
}

/** Loaders a workflow's model can come from, for `addLoras`: a checkpoint (model and CLIP), or a diffusion model alone. */
const MODEL_LOADERS = /^(UNETLoader|UnetLoaderGGUF)$/;

/**
 * Puts LoRA loaders, in order, between the workflow's checkpoint loader and everything that used its model
 * and CLIP (LoraLoader). A workflow that loads a diffusion model on its own (Flux, say) gets them on the
 * model alone (LoraLoaderModelOnly). Throws WorkflowError when it has neither loader.
 */
export function addLoras(wf: Workflow, loras: { name: string; strength: number }[]) {
  if (loras.length === 0) return;
  const find = (test: (n: WorkflowNode) => boolean) => Object.entries(wf).find(([, n]) => test(n))?.[0];
  const ckpt = find((n) => n.class_type === "CheckpointLoaderSimple");
  const from = ckpt ?? find((n) => MODEL_LOADERS.test(n.class_type));
  if (!from) {
    throw new WorkflowError("Couldn't add the preset's LoRAs: the workflow has no Load Checkpoint or Load Diffusion Model node. Take them out of the preset, or add them in ComfyUI.");
  }
  const ids = loras.map((_, i) => `storytime_lora_${i + 1}`);
  const last = ids[ids.length - 1];
  for (const node of Object.values(wf)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (!isLink(v) || v[0] !== from) continue;
      if (v[1] === 0) node.inputs[k] = [last, 0];
      else if (ckpt && v[1] === 1) node.inputs[k] = [last, 1];
    }
  }
  let model: [string, number] = [from, 0];
  let clip: [string, number] = [from, 1];
  loras.forEach((l, i) => {
    wf[ids[i]] = ckpt
      ? { class_type: "LoraLoader", inputs: { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength } }
      : { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: l.name, strength_model: l.strength } };
    model = [ids[i], 0];
    clip = [ids[i], 1];
  });
}

/** Replaces the empty latent image with the starting picture, and sets how far the samplers may change it. */
function startFromImage(wf: Workflow, p: PictureParams & { image: string }) {
  const empties = Object.entries(wf).filter(([, n]) => LATENTS.test(n.class_type)).map(([id]) => id);
  const vae = vaeSource(wf);
  const samplers = Object.values(wf).filter(hasDenoise);
  if (empties.length === 0 || !vae || samplers.length === 0) {
    throw new WorkflowError(
      "Couldn't work out how to start this workflow from a picture. Put {{image}} in a Load Image node and {{denoise}} in the sampler's denoise, and export it again.",
    );
  }
  const [load, encode, repeat] = ["storytime_image", "storytime_encode", "storytime_repeat"];
  wf[load] = { class_type: "LoadImage", inputs: { image: p.image } };
  wf[encode] = { class_type: "VAEEncode", inputs: { pixels: [load, 0], vae } };
  wf[repeat] = { class_type: "RepeatLatentBatch", inputs: { samples: [encode, 0], amount: p.count } };
  for (const node of Object.values(wf)) {
    for (const [k, v] of Object.entries(node.inputs)) if (isLink(v) && empties.includes(v[0])) node.inputs[k] = [repeat, 0];
  }
  for (const id of empties) delete wf[id];
  for (const node of samplers) node.inputs.denoise = p.denoise ?? 1;
  if (p.mask) {
    if (p.crop) redrawCropped(wf, { mask: p.mask, full: load, repeat, count: p.count, crop: p.crop, grow: p.grow ?? 0, scale: true });
    else redrawOnlyMask(wf, p.mask, load, repeat);
  }
}

/**
 * Limits the redraw to the mask: the picture's latent gets the mask as its noise mask, and each saved
 * picture is pasted over the original wherever the mask is black, so the rest stays exactly as it was.
 */
export function redrawOnlyMask(wf: Workflow, mask: string, load: string, repeat: string) {
  const [loadMask, noiseMask, invert] = ["storytime_mask", "storytime_noise_mask", "storytime_mask_invert"];
  for (const node of Object.values(wf)) {
    for (const [k, v] of Object.entries(node.inputs)) if (isLink(v) && v[0] === repeat) node.inputs[k] = [noiseMask, 0];
  }
  wf[loadMask] = { class_type: "LoadImageMask", inputs: { image: mask, channel: "red" } };
  wf[noiseMask] = { class_type: "SetLatentNoiseMask", inputs: { samples: [repeat, 0], mask: [loadMask, 0] } };
  wf[invert] = { class_type: "InvertMask", inputs: { mask: [loadMask, 0] } };
  const saves = Object.entries(wf).filter(([, n]) => /^(SaveImage|PreviewImage)$/.test(n.class_type));
  saves.forEach(([id, save], i) => {
    const link = save.inputs.images;
    if (!isLink(link) || wf[link[0]]?.class_type !== "VAEDecode") return;
    const paste = `storytime_paste_${i + 1}`;
    wf[paste] = { class_type: "ImageCompositeMasked", inputs: { destination: link, source: [load, 0], x: 0, y: 0, resize_source: false, mask: [invert, 0] } };
    wf[id].inputs.images = [paste, 0];
  });
}

/**
 * Redraws only a crop of the picture (the painted area plus context) and pastes it back. `full` is the id of the
 * LoadImage holding the whole picture and `repeat` the RepeatLatentBatch of the encoded start. The crop is
 * scaled to `crop.sw` by `crop.sh` here when `scale` is true; with false the workflow scales it itself (a
 * family's ImageScale), and only needs to read from the crop. The painted mask is cropped and scaled the same
 * way and grown (in the crop's pixels) for sampling. Each saved picture is the redrawn crop scaled back to
 * `crop.w` by `crop.h` and pasted over the original, repeated to the batch, where the un-grown mask is white.
 */
export function redrawCropped(
  wf: Workflow,
  o: { mask: string; full: string; repeat: string; count: number; crop: CropPlan; grow: number; scale: boolean },
) {
  const { crop, full, repeat } = o;
  const [cropId, cropScale, loadMask, maskCrop, maskImg, maskScaled, maskSmall, noiseMask] = [
    "storytime_crop", "storytime_crop_scale", "storytime_mask", "storytime_mask_crop", "storytime_mask_img", "storytime_mask_scaled",
    "storytime_mask_small", "storytime_noise_mask",
  ];
  const into = o.scale ? cropScale : cropId;
  // Re-point first: whatever read the full picture (the encoder, or a family's scaler) reads the crop instead,
  // and so does whatever read the encoded start (the sampler) now read the noise mask. The nodes added below
  // read the full picture and the start themselves, so they must not be re-pointed.
  for (const node of Object.values(wf)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (!isLink(v)) continue;
      if (v[0] === full && v[1] === 0) node.inputs[k] = [into, 0];
      else if (v[0] === repeat && v[1] === 0) node.inputs[k] = [noiseMask, 0];
    }
  }
  wf[cropId] = { class_type: "ImageCrop", inputs: { image: [full, 0], width: crop.w, height: crop.h, x: crop.x, y: crop.y } };
  if (o.scale) {
    wf[cropScale] = { class_type: "ImageScale", inputs: { image: [cropId, 0], upscale_method: "lanczos", width: crop.sw, height: crop.sh, crop: "disabled" } };
  }
  wf[loadMask] = { class_type: "LoadImageMask", inputs: { image: o.mask, channel: "red" } };
  wf[maskCrop] = { class_type: "CropMask", inputs: { mask: [loadMask, 0], x: crop.x, y: crop.y, width: crop.w, height: crop.h } };
  wf[maskImg] = { class_type: "MaskToImage", inputs: { mask: [maskCrop, 0] } };
  wf[maskScaled] = { class_type: "ImageScale", inputs: { image: [maskImg, 0], upscale_method: "bilinear", width: crop.sw, height: crop.sh, crop: "disabled" } };
  wf[maskSmall] = { class_type: "ImageToMask", inputs: { image: [maskScaled, 0], channel: "red" } };
  wf[noiseMask] = { class_type: "SetLatentNoiseMask", inputs: { samples: [repeat, 0], mask: [maskSmall, 0] } };
  growNoiseMask(wf, Math.round(o.grow * crop.scale));
  const saves = Object.entries(wf).filter(([, n]) => /^(SaveImage|PreviewImage)$/.test(n.class_type));
  saves.forEach(([id, save], i) => {
    const link = save.inputs.images;
    if (!isLink(link) || wf[link[0]]?.class_type !== "VAEDecode") return;
    const [back, again, paste] = [`storytime_back_${i + 1}`, `storytime_full_${i + 1}`, `storytime_paste_${i + 1}`];
    wf[back] = { class_type: "ImageScale", inputs: { image: link, upscale_method: "lanczos", width: crop.w, height: crop.h, crop: "disabled" } };
    wf[again] = { class_type: "RepeatImageBatch", inputs: { image: [full, 0], amount: o.count } };
    wf[paste] = { class_type: "ImageCompositeMasked", inputs: { destination: [again, 0], source: [back, 0], x: crop.x, y: crop.y, resize_source: false, mask: [maskCrop, 0] } };
    wf[id].inputs.images = [paste, 0];
  });
}

/**
 * Makes each SetLatentNoiseMask sample over the mask grown by `grow` pixels (GrowMask), so the seam falls
 * inside redrawn pixels. The paste-back in `redrawOnlyMask` keeps the un-grown mask.
 */
export function growNoiseMask(wf: Workflow, grow: number) {
  if (!(grow > 0)) return;
  let n = 0;
  for (const node of Object.values(wf)) {
    if (node.class_type !== "SetLatentNoiseMask" || !isLink(node.inputs.mask)) continue;
    n++;
    const id = `storytime_grow_${n}`;
    wf[id] = { class_type: "GrowMask", inputs: { mask: node.inputs.mask, expand: grow, tapered_corners: true } };
    node.inputs.mask = [id, 0];
  }
}

/**
 * Puts a DifferentialDiffusion node in front of every sampler's model (one per distinct model link), so the
 * soft edge of the mask means less change near the edge.
 */
export function addDifferentialDiffusion(wf: Workflow) {
  const made = new Map<string, string>();
  for (const node of Object.values(wf)) {
    if (!/^(KSampler|KSamplerAdvanced)$/.test(node.class_type)) continue;
    const model = node.inputs.model;
    if (!isLink(model)) continue;
    const key = `${model[0]}:${model[1]}`;
    let id = made.get(key);
    if (!id) {
      id = `storytime_dd_${made.size + 1}`;
      made.set(key, id);
      wf[id] = { class_type: "DifferentialDiffusion", inputs: { model } };
    }
    node.inputs.model = [id, 0];
  }
}

/** What the sampler sees under the painted area: the picture as it is, a blurred copy, or flat grey. */
export type FillKind = "keep" | "blur" | "grey";

/**
 * Fills the painted area of the picture that is encoded (not the pasted-back one) with a blurred copy of it or
 * flat grey, so removing an object does not redraw the object. Finds the encoder through the noise mask:
 * SetLatentNoiseMask, its RepeatLatentBatch, its VAEEncode. The fill is composited over the encoder's pixels
 * through the noise mask as it stands (grown already), so call this after `growNoiseMask`. `size` is the
 * size of the encoded picture. Does nothing for "keep", or when the graph has no such chain.
 */
export function fillUnderMask(wf: Workflow, o: { kind: FillKind; size: { w: number; h: number } }) {
  if (o.kind === "keep") return;
  const noise = Object.values(wf).find((n) => n.class_type === "SetLatentNoiseMask");
  const repeatLink = noise?.inputs.samples;
  const maskLink = noise?.inputs.mask;
  if (!noise || !isLink(repeatLink) || !isLink(maskLink)) return;
  const repeat = wf[repeatLink[0]];
  const encodeLink = repeat?.class_type === "RepeatLatentBatch" ? repeat.inputs.samples : null;
  const encode = isLink(encodeLink) ? wf[encodeLink[0]] : null;
  const pixels = encode?.class_type === "VAEEncode" ? encode.inputs.pixels : null;
  if (!encode || !isLink(pixels)) return;
  const [small, fill, paste] = ["storytime_fill_small", "storytime_fill", "storytime_fill_paste"];
  const { w, h } = o.size;
  if (o.kind === "grey") {
    wf[fill] = { class_type: "EmptyImage", inputs: { width: w, height: h, batch_size: 1, color: 8421504 } };
  } else {
    wf[small] = { class_type: "ImageScaleBy", inputs: { image: pixels, upscale_method: "area", scale_by: 0.0625 } };
    wf[fill] = { class_type: "ImageScale", inputs: { image: [small, 0], upscale_method: "bilinear", width: w, height: h, crop: "disabled" } };
  }
  wf[paste] = { class_type: "ImageCompositeMasked", inputs: { destination: pixels, source: [fill, 0], x: 0, y: 0, resize_source: false, mask: maskLink } };
  encode.inputs.pixels = [paste, 0];
}

function fillSettings(wf: Workflow, p: PictureParams): Workflow {
  const out: Workflow = JSON.parse(JSON.stringify(wf));
  const found = placeholdersIn(out);
  if (found.size > 0) {
    if (!found.has("{{prompt}}")) throw new WorkflowError("The workflow has placeholders but no {{prompt}}, so the prompt has nowhere to go.");
    if (found.has("{{image}}") && !p.image) throw new WorkflowError("This workflow starts from a picture ({{image}}), so choose a picture to start from first.");
    if (p.image && !found.has("{{image}}")) {
      throw new WorkflowError("This workflow has placeholders but no {{image}}, so it can't start from a picture. Put {{image}} in a Load Image node and {{denoise}} in the sampler.");
    }
    if (p.image && p.mask && !found.has("{{mask}}")) {
      throw new WorkflowError("This workflow has placeholders but no {{mask}}, so it can't redraw only part of a picture. Put {{mask}} in a Load Image (as Mask) node, and use its mask output for the sampler's latent (Set Latent Noise Mask).");
    }
    const value = { ...p, image: p.image ?? "", mask: p.image ? p.mask ?? "" : "", denoise: p.denoise ?? 1 };
    for (const node of Object.values(out)) {
      for (const [k, v] of Object.entries(node.inputs)) {
        if (typeof v !== "string") continue;
        if (v in NUMBER_SLOTS) node.inputs[k] = value[NUMBER_SLOTS[v as keyof typeof NUMBER_SLOTS]];
        else node.inputs[k] = v.replace(/\{\{(prompt|negative|checkpoint|image|mask)\}\}/g, (_, key: "prompt" | "negative" | "checkpoint" | "image" | "mask") => value[key]);
      }
    }
    return out;
  }

  const { positive, negative } = promptNodes(out);
  if (!positive) {
    throw new WorkflowError("Couldn't find where the prompt goes in the workflow. Put {{prompt}} in the positive prompt's text and export it again.");
  }
  const setText = (id: string, text: string) => {
    const inputs = out[id].inputs;
    for (const key of ["text", "text_g", "text_l", "clip_l", "t5xxl"]) if (typeof inputs[key] === "string") inputs[key] = text;
  };
  setText(positive, p.prompt);
  if (negative) setText(negative, p.negative);
  for (const node of Object.values(out)) {
    if (node.class_type === "CheckpointLoaderSimple" && p.checkpoint) node.inputs.ckpt_name = p.checkpoint;
    if (LATENTS.test(node.class_type)) {
      node.inputs.width = p.width;
      node.inputs.height = p.height;
      node.inputs.batch_size = p.count;
    }
    for (const k of SEED_INPUTS) if (typeof node.inputs[k] === "number") node.inputs[k] = p.seed;
  }
  if (p.image) startFromImage(out, { ...p, image: p.image });
  return out;
}

/** A random seed in the range ComfyUI accepts (kept below 2^48 so it stays exact in JavaScript). */
export const randomSeed = () => Math.floor(Math.random() * 2 ** 48);
