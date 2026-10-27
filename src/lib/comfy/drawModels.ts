// Newer drawing models and the ComfyUI workflows StoryTime builds for them. Pure code, no network: the
// check of what ComfyUI has installed reads the answers of ComfyUI's /object_info, fetched by `checkComfy`
// in check.ts.
//
// Unlike an SDXL checkpoint, these load as separate files: a diffusion model (safetensors or .gguf), a text
// encoder (or two) and a VAE, which is what the edit models (editModels.ts) do too, so the parts, the GGUF
// loaders and the checks are the shared ones in modelParts.ts. A drawing preset chooses a family (`family`),
// and the files for its parts; a part it does not choose is found by its name.
//
// The workflows follow ComfyUI's own templates. Node "1" loads the model, "2" the text encoder(s) and "3"
// the VAE (modelParts.ts relies on that), LoRAs (model only) come after node "1", and the sampler is "8".
import {
  CLIP_L, comboOptions, FLUX_VAE, isGguf, loaderReport, loraChain, nodesOf, partChoices, partsState, pickPart, switchToGgufLoaders,
  QWEN_TEXT_ENCODER, QWEN_VAE, T5_XXL, UNET_GGUF,
  type LoaderInfo, type ModelLora, type ModelPart, type NeededOption, type NodeInfo, type PartCheck, type TextEncoderDevice,
} from "./modelParts";
import { addDifferentialDiffusion, fillUnderMask, growNoiseMask, partialSteps, redrawCropped, redrawOnlyMask, type FillKind, type SamplerTuning, type Workflow } from "./workflow";
import type { CropPlan } from "./inpaintRegion";

/** "checkpoint" is the SDXL-style all-in-one checkpoint of the built-in workflow; the rest are families of separate files. */
export const DRAW_FAMILIES = ["checkpoint", "zimage", "flux", "chroma", "qwen-image", "krea2"] as const;
export type DrawFamily = (typeof DRAW_FAMILIES)[number];
export type ModelFamily = Exclude<DrawFamily, "checkpoint">;

/** What the Model type menu calls each family. */
export const FAMILY_NAMES: Record<DrawFamily, string> = {
  checkpoint: "Checkpoint (SDXL, Pony, Illustrious, SD 1.5)",
  zimage: "Z-Image",
  flux: "Flux",
  chroma: "Chroma",
  "qwen-image": "Qwen-Image",
  krea2: "Krea 2 (Kroma)",
};

/** What a family's sampler runs with: the usual settings, and the ones only some families have. */
export type DrawTuning = SamplerTuning & {
  /** ModelSamplingAuraFlow's shift (Z-Image, Qwen-Image). Higher spends more of the steps on the big shapes. */
  shift?: number;
  /** FluxGuidance (Flux), how closely the prompt is followed. */
  guidance?: number;
  /** Krea 2: how much a text-to-image picture is scaled up and lightly redrawn (a second, 4 step pass); 1 is off. */
  upscale?: number;
};

export type DrawParams = {
  prompt: string;
  negative: string;
  seed: number;
  count: number;
  width: number;
  height: number;
  prefix: string;
  /** Redraw: the starting picture's name in ComfyUI's input folder, scaled to the size, and how far the sampler may change it (0 to 1). */
  image?: string;
  denoise?: number;
  /** Redraw only a painted area: the mask's name in ComfyUI's input folder (white = redraw). Only used with `image`. */
  mask?: string;
  /** Redraw only a painted area: how many pixels the sampled mask grows past the painted one (the paste-back keeps the painted one). */
  grow?: number;
  /** Redraw only a painted area: redraw a crop of the picture (the area plus context) at `sw` by `sh`, and paste it back. */
  crop?: CropPlan;
  /** Redraw only a painted area: what the sampler sees under it (see `fillUnderMask`); left out to keep the picture as it is. */
  fill?: FillKind;
  /** The preset's LoRAs, applied in order after the model loader. */
  loras?: ModelLora[];
  /** The family's settings (`drawTuning`); its defaults when not given. */
  tuning?: DrawTuning;
  /** Where the text encoder is loaded: ComfyUI's "default", or "cpu" to keep it in system memory. */
  textEncoderDevice?: TextEncoderDevice;
  /** The optional nodes ComfyUI has (see DrawModel.optionalNodes). */
  optionalNodes?: string[];
};

export type DrawModel = {
  id: ModelFamily;
  name: string;
  /** One line on what it is good at and how it is run. */
  blurb: string;
  parts: ModelPart[];
  /** Every node the workflow uses. */
  nodes: string[];
  /** Nodes the workflow uses when ComfyUI has them (it works without). */
  optionalNodes: string[];
  options: NeededOption[];
  /** What it runs with unless changed in Settings, including its extra settings (`shift`, `guidance`). */
  defaults: DrawTuning;
  /** Whether the negative prompt changes the picture (false at CFG 1, where the sampler ignores it). */
  negativeUsed: boolean;
  /** The workflow, with the files found for each part (by part key). */
  build: (files: Record<string, string>, p: DrawParams) => Workflow;
};

/** A picture is scaled to a multiple of 16 for Redraw: these models work on 16 pixel blocks. */
const snap16 = (v: number) => Math.max(16, Math.round(v / 16) * 16);

/** The latent the sampler starts from: an empty one, or the starting picture scaled and encoded. */
function startLatent(p: DrawParams): { nodes: Workflow; latent: [string, number] } {
  if (!p.image) {
    return { nodes: { "5": { class_type: "EmptySD3LatentImage", inputs: { width: p.width, height: p.height, batch_size: p.count } } }, latent: ["5", 0] };
  }
  return {
    nodes: {
      "10": { class_type: "LoadImage", inputs: { image: p.image } },
      "11": { class_type: "ImageScale", inputs: { image: ["10", 0], upscale_method: "lanczos", width: p.crop && p.mask ? p.crop.sw : snap16(p.width), height: p.crop && p.mask ? p.crop.sh : snap16(p.height), crop: "disabled" } },
      "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["3", 0] } },
      "13": { class_type: "RepeatLatentBatch", inputs: { samples: ["12", 0], amount: p.count } },
    },
    latent: ["13", 0],
  };
}

/** The sampler (node "8") and the nodes after it: decode and save. */
function sampleAndSave(p: DrawParams, t: DrawTuning, links: { model: [string, number]; positive: [string, number]; negative: [string, number]; latent: [string, number] }): Workflow {
  const sampler: Workflow[string] = {
    class_type: "KSampler",
    inputs: {
      seed: p.seed, steps: t.steps, cfg: t.cfg, sampler_name: t.sampler, scheduler: t.scheduler,
      denoise: p.image ? (p.denoise ?? 1) : 1,
      model: links.model, positive: links.positive, negative: links.negative, latent_image: links.latent,
    },
  };
  if (p.image) partialSteps(sampler);
  return {
    "8": sampler,
    "20": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "21": { class_type: "SaveImage", inputs: { filename_prefix: p.prefix, images: ["20", 0] } },
  };
}

const unetLoader = (files: Record<string, string>): Workflow[string] => ({ class_type: "UNETLoader", inputs: { unet_name: files.model, weight_dtype: "default" } });
const vaeLoader = (files: Record<string, string>): Workflow[string] => ({ class_type: "VAELoader", inputs: { vae_name: files.vae } });

// ---- Z-Image Turbo ----

/** Z-Image Turbo's defaults, as in ComfyUI's own template: 9 steps of res_multistep at CFG 1, shift 3. */
const ZIMAGE_DEFAULTS: DrawTuning = { steps: 9, cfg: 1, sampler: "res_multistep", scheduler: "simple", shift: 3 };

/** Z-Image Turbo: Qwen 3 4B as the text encoder (type lumina2), and no negative prompt (the negative is the positive zeroed out, at CFG 1). */
function zimageWorkflow(files: Record<string, string>, p: DrawParams): Workflow {
  const t = p.tuning ?? ZIMAGE_DEFAULTS;
  const chain = loraChain(["1", 0], null, p.loras);
  const start = startLatent(p);
  return {
    "1": unetLoader(files),
    "2": { class_type: "CLIPLoader", inputs: { clip_name: files.textEncoder, type: "lumina2", device: p.textEncoderDevice ?? "default" } },
    "3": vaeLoader(files),
    ...chain.nodes,
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: chain.model, shift: t.shift ?? ZIMAGE_DEFAULTS.shift } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.prompt } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["6", 0] } },
    ...start.nodes,
    ...sampleAndSave(p, t, { model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent: start.latent }),
  };
}

// ---- Flux ----

/** FLUX.1 dev's defaults: 20 steps of Euler at CFG 1 with a guidance of 3.5 (schnell wants 4 steps). */
const FLUX_DEFAULTS: DrawTuning = { steps: 20, cfg: 1, sampler: "euler", scheduler: "simple", guidance: 3.5 };

/** FLUX.1 (dev, schnell and their fine-tunes): CLIP-L and T5-XXL, FluxGuidance instead of CFG, and a zeroed-out negative. */
function fluxWorkflow(files: Record<string, string>, p: DrawParams): Workflow {
  const t = p.tuning ?? FLUX_DEFAULTS;
  const chain = loraChain(["1", 0], null, p.loras);
  const start = startLatent(p);
  return {
    "1": unetLoader(files),
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: files.clipL, clip_name2: files.t5, type: "flux", device: p.textEncoderDevice ?? "default" } },
    "3": vaeLoader(files),
    ...chain.nodes,
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.prompt } },
    "4": { class_type: "FluxGuidance", inputs: { conditioning: ["6", 0], guidance: t.guidance ?? FLUX_DEFAULTS.guidance } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["6", 0] } },
    ...start.nodes,
    ...sampleAndSave(p, t, { model: chain.model, positive: ["4", 0], negative: ["7", 0], latent: start.latent }),
  };
}

// ---- Chroma ----

/** Chroma's defaults, as in ComfyUI's own template: 26 steps of Euler beta at CFG 4. */
const CHROMA_DEFAULTS: DrawTuning = { steps: 26, cfg: 4, sampler: "euler", scheduler: "beta" };

/**
 * Chroma (built on FLUX.1 schnell, uncensored): T5-XXL alone as the text encoder (type chroma) and real CFG, so the
 * negative prompt matters. ComfyUI's template pads the prompt less with T5TokenizerOptions; it is used when ComfyUI has the node.
 */
function chromaWorkflow(files: Record<string, string>, p: DrawParams): Workflow {
  const t = p.tuning ?? CHROMA_DEFAULTS;
  const chain = loraChain(["1", 0], null, p.loras);
  const start = startLatent(p);
  const options = p.optionalNodes?.includes("T5TokenizerOptions");
  const clip: [string, number] = options ? ["4", 0] : ["2", 0];
  return {
    "1": unetLoader(files),
    "2": { class_type: "CLIPLoader", inputs: { clip_name: files.textEncoder, type: "chroma", device: p.textEncoderDevice ?? "default" } },
    "3": vaeLoader(files),
    ...chain.nodes,
    ...(options && { "4": { class_type: "T5TokenizerOptions", inputs: { clip: ["2", 0], min_padding: 1, min_length: 0 } } }),
    "6": { class_type: "CLIPTextEncode", inputs: { clip, text: p.prompt } },
    "7": { class_type: "CLIPTextEncode", inputs: { clip, text: p.negative } },
    ...start.nodes,
    ...sampleAndSave(p, t, { model: chain.model, positive: ["6", 0], negative: ["7", 0], latent: start.latent }),
  };
}

// ---- Qwen-Image ----

/** Qwen-Image's defaults, as in ComfyUI's own template: 20 steps of Euler at CFG 2.5, shift 3.1. */
const QWEN_DEFAULTS: DrawTuning = { steps: 20, cfg: 2.5, sampler: "euler", scheduler: "simple", shift: 3.1 };

/** Qwen-Image: a Qwen 2.5 VL text encoder (type qwen_image), ModelSamplingAuraFlow and a real negative prompt. */
function qwenImageWorkflow(files: Record<string, string>, p: DrawParams): Workflow {
  const t = p.tuning ?? QWEN_DEFAULTS;
  const chain = loraChain(["1", 0], null, p.loras);
  const start = startLatent(p);
  return {
    "1": unetLoader(files),
    "2": { class_type: "CLIPLoader", inputs: { clip_name: files.textEncoder, type: "qwen_image", device: p.textEncoderDevice ?? "default" } },
    "3": vaeLoader(files),
    ...chain.nodes,
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: chain.model, shift: t.shift ?? QWEN_DEFAULTS.shift } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.prompt } },
    "7": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.negative } },
    ...start.nodes,
    ...sampleAndSave(p, t, { model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent: start.latent }),
  };
}

// ---- Krea 2 (Kroma) ----

/** Kroma's defaults, as in its published workflow: 8 steps of Euler at CFG 1, then a 2x upscale (see `krea2Workflow`). */
const KREA2_DEFAULTS: DrawTuning = { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple", upscale: 2 };

/** The upscale pass's settings in that workflow: 4 steps of res_multistep beta at a denoise of 0.14. */
const KREA2_REFINE = { steps: 4, sampler: "res_multistep", scheduler: "beta", denoise: 0.14 };

/**
 * Krea 2 and its fine-tune Kroma: Qwen 3 VL 4B as the text encoder (type krea2), the Wan 2.1 VAE, and no negative
 * prompt (the negative is the positive zeroed out, at CFG 1). A text-to-image picture is then scaled up
 * (lanczos), encoded again and lightly redrawn by a second sampler, as in the published workflow; Redraw
 * pictures and an upscale of 1 skip that pass.
 */
function krea2Workflow(files: Record<string, string>, p: DrawParams): Workflow {
  const t = p.tuning ?? KREA2_DEFAULTS;
  const chain = loraChain(["1", 0], null, p.loras);
  const start = startLatent(p);
  const wf: Workflow = {
    "1": unetLoader(files),
    "2": { class_type: "CLIPLoader", inputs: { clip_name: files.textEncoder, type: "krea2", device: p.textEncoderDevice ?? "default" } },
    "3": vaeLoader(files),
    ...chain.nodes,
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.prompt } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["6", 0] } },
    ...start.nodes,
    ...sampleAndSave(p, t, { model: chain.model, positive: ["6", 0], negative: ["7", 0], latent: start.latent }),
  };
  const scale = t.upscale ?? KREA2_DEFAULTS.upscale!;
  if (!p.image && scale > 1) {
    Object.assign(wf, {
      "40": { class_type: "ImageScaleBy", inputs: { image: ["20", 0], upscale_method: "lanczos", scale_by: scale } },
      "41": { class_type: "VAEEncode", inputs: { pixels: ["40", 0], vae: ["3", 0] } },
      "42": {
        class_type: "KSampler",
        inputs: {
          seed: p.seed, steps: KREA2_REFINE.steps, cfg: 1, sampler_name: KREA2_REFINE.sampler, scheduler: KREA2_REFINE.scheduler,
          denoise: KREA2_REFINE.denoise, model: chain.model, positive: ["6", 0], negative: ["7", 0], latent_image: ["41", 0],
        },
      },
      "43": { class_type: "VAEDecode", inputs: { samples: ["42", 0], vae: ["3", 0] } },
    });
    wf["21"].inputs.images = ["43", 0];
  }
  return wf;
}

const SAMPLE: DrawParams = { prompt: "x", negative: "x", seed: 1, count: 1, width: 1024, height: 1024, prefix: "StoryTime" };

/** Every node a family's workflows use, text to image and Redraw. */
const nodesFor = (build: DrawModel["build"]) => nodesOf({ ...build({}, SAMPLE), ...build({}, { ...SAMPLE, image: "x.png" }) });

export const DRAW_MODELS: DrawModel[] = [
  {
    id: "zimage",
    name: "Z-Image",
    blurb: "Fast (9 steps) and light; the Turbo model draws a good picture in seconds and fits a 12 GB card whole. It ignores the negative prompt.",
    parts: [
      {
        key: "model", label: "Z-Image model", folder: "diffusion_models", loader: "UNETLoader", input: "unet_name",
        recommended: "z_image_turbo_bf16.safetensors", match: /z[-_ ]?image/i, output: 0, gguf: UNET_GGUF,
      },
      {
        key: "textEncoder", label: "Qwen 3 4B text encoder", folder: "text_encoders", loader: "CLIPLoader", input: "clip_name",
        recommended: "qwen_3_4b.safetensors", match: /qwen[-_]?3[-_]?4b/i, output: 1, gguf: { loader: "CLIPLoaderGGUF", input: "clip_name" },
      },
      FLUX_VAE,
    ],
    nodes: nodesFor(zimageWorkflow),
    optionalNodes: [],
    options: [{ node: "CLIPLoader", input: "type", value: "lumina2" }],
    defaults: ZIMAGE_DEFAULTS,
    negativeUsed: false,
    build: zimageWorkflow,
  },
  {
    id: "flux",
    name: "Flux",
    blurb: "FLUX.1 dev or schnell and their fine-tunes (including .gguf ones). It follows a guidance setting instead of CFG, so the negative prompt does nothing; for schnell set the steps to 4.",
    parts: [
      {
        key: "model", label: "FLUX.1 model", folder: "diffusion_models", loader: "UNETLoader", input: "unet_name",
        // Not the editing model (Kontext) or Chroma, which are made from it.
        recommended: "flux1-dev-fp8.safetensors", match: /^(?!.*(kontext|chroma)).*flux/i, output: 0, gguf: UNET_GGUF,
      },
      CLIP_L,
      T5_XXL,
      FLUX_VAE,
    ],
    nodes: nodesFor(fluxWorkflow),
    optionalNodes: [],
    options: [{ node: "DualCLIPLoader", input: "type", value: "flux" }],
    defaults: FLUX_DEFAULTS,
    negativeUsed: false,
    build: fluxWorkflow,
  },
  {
    id: "chroma",
    name: "Chroma",
    blurb: "An uncensored model built on FLUX.1 schnell. Unlike Flux it uses a real CFG (4), so the negative prompt matters.",
    parts: [
      {
        key: "model", label: "Chroma model", folder: "diffusion_models", loader: "UNETLoader", input: "unet_name",
        recommended: "Chroma1-HD.safetensors", match: /chroma/i, output: 0, gguf: UNET_GGUF,
      },
      {
        key: "textEncoder", label: "T5-XXL text encoder", folder: "text_encoders", loader: "CLIPLoader", input: "clip_name",
        recommended: "t5xxl_fp8_e4m3fn_scaled.safetensors", match: T5_XXL.match, output: 1, gguf: { loader: "CLIPLoaderGGUF", input: "clip_name" },
      },
      FLUX_VAE,
    ],
    nodes: nodesFor(chromaWorkflow),
    optionalNodes: ["T5TokenizerOptions"],
    options: [{ node: "CLIPLoader", input: "type", value: "chroma" }],
    defaults: CHROMA_DEFAULTS,
    negativeUsed: true,
    build: chromaWorkflow,
  },
  {
    id: "qwen-image",
    name: "Qwen-Image",
    blurb: "A large model (20 billion parameters) that follows long prompts closely and draws readable text. Heavy: use a GGUF quant and keep the text encoder on the CPU on a 12 GB card.",
    parts: [
      {
        key: "model", label: "Qwen-Image model", folder: "diffusion_models", loader: "UNETLoader", input: "unet_name",
        // Not Qwen-Image-Edit, the editing model made from it (Instruct uses that one).
        recommended: "qwen_image_fp8_e4m3fn.safetensors", match: /^(?!.*edit).*qwen[-_ ]?image/i, output: 0, gguf: UNET_GGUF,
      },
      QWEN_TEXT_ENCODER,
      QWEN_VAE,
    ],
    nodes: nodesFor(qwenImageWorkflow),
    optionalNodes: [],
    options: [{ node: "CLIPLoader", input: "type", value: "qwen_image" }],
    defaults: QWEN_DEFAULTS,
    negativeUsed: true,
    build: qwenImageWorkflow,
  },
  {
    id: "krea2",
    name: "Krea 2 (Kroma)",
    blurb: "Krea 2 and its Kroma fine-tune: photographic, 8 steps, and no negative prompt. Pictures are scaled up 2x and lightly redrawn by default (Upscale under Advanced; 1 turns it off). The Amateur slider is a LoRA: add AmateurSlider-KREA2 below (about 1.1; negative is more polished).",
    parts: [
      {
        key: "model", label: "Krea 2 / Kroma model", folder: "diffusion_models", loader: "UNETLoader", input: "unet_name",
        recommended: "kroma-v0.3.1-turbo-opd.safetensors", match: /kroma|krea/i, output: 0, gguf: UNET_GGUF,
      },
      {
        key: "textEncoder", label: "Qwen 3 VL 4B text encoder", folder: "text_encoders", loader: "CLIPLoader", input: "clip_name",
        recommended: "qwen3vl_4b_bf16.safetensors", match: /qwen[-_]?3[-_]?vl[-_]?4b/i, output: 1, gguf: { loader: "CLIPLoaderGGUF", input: "clip_name" },
      },
      {
        key: "vae", label: "Wan 2.1 VAE", folder: "vae", loader: "VAELoader", input: "vae_name",
        recommended: "wan_2.1_vae.safetensors", match: /wan[-_]?2\.1[-_]?vae/i, output: 2,
      },
    ],
    nodes: nodesFor(krea2Workflow),
    optionalNodes: [],
    options: [{ node: "CLIPLoader", input: "type", value: "krea2" }],
    defaults: KREA2_DEFAULTS,
    negativeUsed: false,
    build: krea2Workflow,
  },
];

export const drawModel = (family: string): DrawModel | undefined => DRAW_MODELS.find((m) => m.id === family);

/** The settings a family has beyond the sampler's, from its defaults. */
export const drawKnobs = (model: DrawModel) => (["shift", "guidance", "upscale"] as const).filter((k) => model.defaults[k] !== undefined);

/**
 * What a family runs with: its defaults with the settings changed in Settings (`changed`). Settings it
 * doesn't have (Z-Image's guidance) are left out.
 */
export function drawTuning(model: DrawModel, changed: Partial<DrawTuning> = {}): DrawTuning {
  const t: DrawTuning = { ...model.defaults };
  for (const [k, v] of Object.entries(changed) as [keyof DrawTuning, DrawTuning[keyof DrawTuning]][]) {
    if (v !== undefined && k in model.defaults) (t as Record<string, unknown>)[k] = v;
  }
  return t;
}

/** The files a drawing preset chose for a family's parts, by part key; a part not here is found by its name. */
export type FamilyFiles = { family: string; files: Record<string, string> };

export type FamilyCheck = {
  model: DrawModel;
  /** Nodes the workflow needs that ComfyUI doesn't have (ComfyUI is too old, most likely). */
  missingNodes: string[];
  /** Choices a node should offer but doesn't, as "Node input: value". */
  missingOptions: string[];
  parts: PartCheck[];
  /** The files to use, by part key, when every part was found. */
  files: Record<string, string>;
  /** Whether everything is there, so the family can be used. */
  ready: boolean;
  /** What ComfyUI says about each loader node the parts use (the GGUF ones too) that it has. */
  loaders: Record<string, LoaderInfo>;
  /** The GGUF loader nodes of this family that ComfyUI doesn't have (ComfyUI-GGUF isn't installed). */
  ggufMissing: string[];
  /** The choices for where the text encoder is loaded, on the loader in use; empty when it has no such input. */
  devices: string[];
  /** The optional nodes of the family that ComfyUI has. */
  optionalNodes: string[];
  /** The choices of the inputs `options` asks about, on their nodes and the GGUF loaders ("Node input"), for checking them once files are chosen. */
  optionLists: Record<string, string[]>;
};

const listKey = (node: string, input: string) => `${node} ${input}`;

/** Resolves a family's parts for the files a preset chose; the first call (from checkDrawFamilies) chooses none. */
function resolve(check: FamilyCheck, chosen: Record<string, string>): FamilyCheck {
  const parts = check.parts.map(({ part, choices }) => pickPart(part, choices, chosen[part.key] || undefined));
  const { ggufInstalled, devices } = partsState(parts, check.loaders);
  // A text encoder from a .gguf file is loaded by the GGUF loader, which must offer the type too.
  const missingOptions = check.model.options.flatMap((o) => {
    const via = parts.find((q) => q.part.loader === o.node && q.part.gguf && q.file && isGguf(q.file));
    const node = via?.part.gguf?.loader ?? o.node;
    return check.loaders[node] && !(check.optionLists[listKey(node, o.input)] ?? []).includes(o.value) ? [`${node} ${o.input}: ${o.value}`] : [];
  });
  const ready = check.missingNodes.length === 0 && missingOptions.length === 0 && ggufInstalled && parts.every((p) => p.file !== null);
  const files = ready ? Object.fromEntries(parts.map((p) => [p.part.key, p.file!])) : {};
  return { ...check, parts, files, ready, missingOptions, devices };
}

/** Every node the checks need to ask ComfyUI about. */
export const DRAW_NODES = [
  ...new Set(
    DRAW_MODELS.flatMap((m) => [
      ...m.nodes, ...m.optionalNodes, ...m.parts.map((p) => p.loader), ...m.parts.flatMap((p) => (p.gguf ? [p.gguf.loader] : [])),
      ...m.options.map((o) => o.node),
    ]),
  ),
].sort();

/** Whether each family can be used with the files found by their names, from what ComfyUI says about the nodes in DRAW_NODES. */
export function checkDrawFamilies(info: Record<string, NodeInfo>): FamilyCheck[] {
  return DRAW_MODELS.map((model) => {
    const { loaders, ggufMissing } = loaderReport(model.parts, info);
    const optionLists: Record<string, string[]> = {};
    for (const o of model.options) {
      for (const node of [o.node, ...model.parts.flatMap((p) => (p.loader === o.node && p.gguf ? [p.gguf.loader] : []))]) {
        optionLists[listKey(node, o.input)] = comboOptions(info[node], o.input);
      }
    }
    return resolve(
      {
        model, ggufMissing, loaders, optionLists, files: {}, ready: false, devices: [], missingOptions: [],
        missingNodes: model.nodes.filter((n) => !info[n]),
        parts: model.parts.map((part) => ({ part, file: null, choices: partChoices(part, info) })),
        optionalNodes: model.optionalNodes.filter((n) => info[n]),
      },
      {},
    );
  });
}

/** A drawing preset's check: its family's, with the files it chose. Null for the checkpoint family or when ComfyUI's answer has no such family. */
export function familyPresetCheck(checks: FamilyCheck[], preset: FamilyFiles): FamilyCheck | null {
  const check = checks.find((c) => c.model.id === preset.family);
  return check ? resolve(check, preset.files) : null;
}

/** What is wrong with a family's files and nodes, one sentence each; empty when it is ready. */
export function familyProblems(check: FamilyCheck): string[] {
  return [
    ...check.parts
      .filter((p) => p.file === null)
      .map((p) => (p.chosen ? `ComfyUI doesn't list ${p.chosen} (${p.part.label}).` : `No ${p.part.label} found in ComfyUI/models/${p.part.folder}.`)),
    ...(check.missingNodes.length > 0 ? [`ComfyUI doesn't have the nodes ${check.missingNodes.join(", ")}. Update ComfyUI.`] : []),
    ...(check.missingOptions.length > 0 ? [`ComfyUI is too old (${check.missingOptions.join("; ")}). Update ComfyUI.`] : []),
    ...(ggufNeeded(check).length > 0 ? [`A GGUF file is chosen but ComfyUI doesn't have ${ggufNeeded(check).join(", ")}. Install the ComfyUI-GGUF custom nodes.`] : []),
  ];
}

/** The GGUF loader nodes the chosen .gguf files need that ComfyUI doesn't have. */
export const ggufNeeded = (check: FamilyCheck): string[] => [
  ...new Set(check.parts.flatMap((p) => (p.file && isGguf(p.file) && p.part.gguf && !check.loaders[p.part.gguf.loader] ? [p.part.gguf.loader] : []))),
];

/** The workflow for a picture, with the files of `check` (see familyPresetCheck): the family's, with .gguf parts switched to the GGUF loaders. */
export function buildDraw(check: FamilyCheck, p: DrawParams): Workflow {
  const wf = check.model.build(check.files, { ...p, optionalNodes: check.optionalNodes });
  switchToGgufLoaders(check.model.parts, check.files, check.loaders, wf);
  if (p.image && p.mask) {
    if (p.crop) {
      // The crop is scaled by the workflow's own ImageScale ("11"); redrawCropped grows the mask itself, in the crop's pixels.
      redrawCropped(wf, { mask: p.mask, full: "10", repeat: "13", count: p.count, crop: p.crop, grow: p.grow ?? 0, scale: false });
    } else {
      // The scaled picture ("11") is pasted back outside the mask, so it matches the decoded pictures' size.
      redrawOnlyMask(wf, p.mask, "11", "13");
      growNoiseMask(wf, p.grow ?? 0);
    }
    addDifferentialDiffusion(wf);
    // The family's scaler ("11") makes the encoded picture: the crop's size, or the picture's snapped to 16.
    fillUnderMask(wf, { kind: p.fill ?? "keep", size: p.crop ? { w: p.crop.sw, h: p.crop.sh } : { w: snap16(p.width), h: snap16(p.height) } });
  }
  return wf;
}
