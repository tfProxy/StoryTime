// Models that change a picture by following an instruction ("remove the logo on the shirt"), and the
// ComfyUI workflows StoryTime builds for them. Pure code, no network: the check of what ComfyUI has
// installed reads the answers of ComfyUI's /object_info, fetched by `checkComfy` in check.ts.
//
// Each model needs some files in ComfyUI's models folder (the README says where to get them) and some
// nodes, all of them part of ComfyUI itself in recent versions. A model can be used only when every node
// is there and a file is found for every part.
import type { Workflow } from "./workflow";

/** One file a model needs, and the loader node whose list of choices shows whether ComfyUI has it. */
export type ModelPart = {
  key: string;
  /** What the file is, for the setup check. */
  label: string;
  /** Where it goes, under ComfyUI's `models` folder. */
  folder: string;
  /** The loader node and its input that lists the files of that folder. */
  loader: string;
  input: string;
  /** The file the README tells you to download, preferred when it is there. */
  recommended: string;
  /** Other names the same kind of file goes by (another precision, a newer release), used when the recommended one isn't there. */
  match: RegExp;
};

/** A choice another node must offer, such as a text encoder type that only newer ComfyUIs know. */
type NeededOption = { node: string; input: string; value: string };

export type EditParams = {
  /** The starting picture's name in ComfyUI's input folder. */
  image: string;
  instruction: string;
  seed: number;
  count: number;
  /** The size to make, from `editSize`. */
  width: number;
  height: number;
  prefix: string;
  /**
   * How far the sampler may move from the starting picture, 0 to 1. At 1 it starts from pure noise and
   * follows the instruction freely; lower, it starts from the picture with some noise on it, so the result
   * stays closer to it.
   */
  denoise: number;
};

export type EditModel = {
  id: EditModelId;
  name: string;
  /** One line on what it is good at. */
  blurb: string;
  parts: ModelPart[];
  /** Every node the workflow uses. */
  nodes: string[];
  options: NeededOption[];
  /** The workflow, with the files found for each part (by part key). */
  build: (files: Record<string, string>, p: EditParams) => Workflow;
};

export const EDIT_MODEL_IDS = ["qwen-image-edit", "flux-kontext"] as const;
export type EditModelId = (typeof EDIT_MODEL_IDS)[number];

const nodesOf = (wf: Workflow) => [...new Set(Object.values(wf).map((n) => n.class_type))].sort();

/** The picture is scaled to this many pixels (about one megapixel), the size both models were trained at. */
const EDIT_PIXELS = 1024 * 1024;

/** The size an edit of a picture is made at: its shape, at about one megapixel, in multiples of 16. */
export function editSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.sqrt(EDIT_PIXELS / (width * height));
  const round = (v: number) => Math.max(16, Math.round((v * scale) / 16) * 16);
  return { width: round(width), height: round(height) };
}

/** The nodes both workflows start and end with: the starting picture, scaled and encoded, and the saved result. */
function shared(p: EditParams, vae: [string, number], sampler: string): Workflow {
  return {
    "10": { class_type: "LoadImage", inputs: { image: p.image } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], upscale_method: "lanczos", width: p.width, height: p.height, crop: "disabled" } },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae } },
    "13": { class_type: "RepeatLatentBatch", inputs: { samples: ["12", 0], amount: p.count } },
    "20": { class_type: "VAEDecode", inputs: { samples: [sampler, 0], vae } },
    "21": { class_type: "SaveImage", inputs: { filename_prefix: p.prefix, images: ["20", 0] } },
  };
}

/** Qwen-Image-Edit 2509: 20 steps of Euler at CFG 2.5, as in ComfyUI's own template. */
function qwenWorkflow(files: Record<string, string>, p: EditParams): Workflow {
  const encode = (prompt: string) => ({
    class_type: "TextEncodeQwenImageEditPlus",
    inputs: { clip: ["2", 0], vae: ["3", 0], image1: ["11", 0], prompt },
  });
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: files.model, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: files.textEncoder, type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "5": { class_type: "CFGNorm", inputs: { model: ["4", 0], strength: 1 } },
    "6": encode(p.instruction),
    "7": encode(""),
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: p.seed, steps: 20, cfg: 2.5, sampler_name: "euler", scheduler: "simple", denoise: p.denoise,
        model: ["5", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["13", 0],
      },
    },
    ...shared(p, ["3", 0], "8"),
  };
}

/** FLUX.1 Kontext dev: the picture as a reference latent, guidance 2.5, 20 steps of Euler at CFG 1. */
function kontextWorkflow(files: Record<string, string>, p: EditParams): Workflow {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: files.model, weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: files.clipL, clip_name2: files.t5, type: "flux", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.instruction } },
    "5": { class_type: "ReferenceLatent", inputs: { conditioning: ["4", 0], latent: ["12", 0] } },
    "6": { class_type: "FluxGuidance", inputs: { conditioning: ["5", 0], guidance: 2.5 } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: p.seed, steps: 20, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: p.denoise,
        model: ["1", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["13", 0],
      },
    },
    ...shared(p, ["3", 0], "8"),
  };
}

const SAMPLE: EditParams = { image: "x.png", instruction: "x", seed: 1, count: 1, width: 1024, height: 1024, prefix: "StoryTime", denoise: 1 };

export const EDIT_MODELS: EditModel[] = [
  {
    id: "qwen-image-edit",
    name: "Qwen-Image-Edit",
    blurb: "Best at precise changes: removing or adding things, changing text and clothes.",
    parts: [
      {
        key: "model", label: "Qwen-Image-Edit 2509 model", folder: "diffusion_models", loader: "UNETLoader", input: "unet_name",
        recommended: "qwen_image_edit_2509_fp8_e4m3fn.safetensors", match: /qwen[-_ ]?image[-_ ]?edit/i,
      },
      {
        key: "textEncoder", label: "Qwen 2.5 VL text encoder", folder: "text_encoders", loader: "CLIPLoader", input: "clip_name",
        recommended: "qwen_2.5_vl_7b_fp8_scaled.safetensors", match: /qwen[-_]?2\.5[-_]?vl[-_]?7b/i,
      },
      {
        key: "vae", label: "Qwen-Image VAE", folder: "vae", loader: "VAELoader", input: "vae_name",
        recommended: "qwen_image_vae.safetensors", match: /qwen[-_]?image[-_]?vae/i,
      },
    ],
    nodes: nodesOf(qwenWorkflow({}, SAMPLE)),
    options: [{ node: "CLIPLoader", input: "type", value: "qwen_image" }],
    build: qwenWorkflow,
  },
  {
    id: "flux-kontext",
    name: "FLUX.1 Kontext",
    blurb: "Lighter; good at keeping a character the same while changing the scene or the style.",
    parts: [
      {
        key: "model", label: "FLUX.1 Kontext dev model", folder: "diffusion_models", loader: "UNETLoader", input: "unet_name",
        recommended: "flux1-dev-kontext_fp8_scaled.safetensors", match: /kontext/i,
      },
      {
        key: "clipL", label: "CLIP-L text encoder", folder: "text_encoders", loader: "DualCLIPLoader", input: "clip_name1",
        recommended: "clip_l.safetensors", match: /(^|[\\/])clip_l[^\\/]*\.safetensors$/i,
      },
      {
        key: "t5", label: "T5-XXL text encoder", folder: "text_encoders", loader: "DualCLIPLoader", input: "clip_name2",
        recommended: "t5xxl_fp8_e4m3fn_scaled.safetensors", match: /t5xxl/i,
      },
      {
        key: "vae", label: "FLUX VAE", folder: "vae", loader: "VAELoader", input: "vae_name",
        recommended: "ae.safetensors", match: /(^|[\\/])(ae|flux[-_]?ae|flux[-_]?vae|flux1[-_]?ae)\.(safetensors|sft)$/i,
      },
    ],
    nodes: nodesOf(kontextWorkflow({}, SAMPLE)),
    options: [{ node: "DualCLIPLoader", input: "type", value: "flux" }],
    build: kontextWorkflow,
  },
];

export const editModel = (id: string): EditModel | undefined => EDIT_MODELS.find((m) => m.id === id);

/** What ComfyUI's /object_info says about one node, or null when ComfyUI doesn't have it. */
export type NodeInfo = { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } } | null;

/**
 * The choices a node's input offers, such as the files a loader can load. ComfyUI has written these
 * two ways: `[[choices…], {…}]`, and (newer) `["COMBO", { options: [choices…] }]`.
 */
export function comboOptions(info: NodeInfo, input: string): string[] {
  const spec = info?.input?.required?.[input] ?? info?.input?.optional?.[input];
  if (!Array.isArray(spec)) return [];
  const list = Array.isArray(spec[0]) ? spec[0] : (spec[1] as { options?: unknown } | undefined)?.options;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

/** One part of a model and the file found for it, or null when ComfyUI has none. */
export type PartCheck = { part: ModelPart; file: string | null };

export type EditCheck = {
  model: EditModel;
  /** Nodes the workflow needs that ComfyUI doesn't have (ComfyUI is too old, most likely). */
  missingNodes: string[];
  /** Choices a node should offer but doesn't, as "Node input: value". */
  missingOptions: string[];
  parts: PartCheck[];
  /** The files to use, by part key, when every part was found. */
  files: Record<string, string>;
  /** Whether everything is there, so the model can be used. */
  ready: boolean;
};

/** Every node the checks below need to ask ComfyUI about. */
export const EDIT_NODES = [...new Set(EDIT_MODELS.flatMap((m) => [...m.nodes, ...m.parts.map((p) => p.loader), ...m.options.map((o) => o.node)]))].sort();

/** The file for a part among the ones a loader lists: the recommended one, else the first that looks like it. */
function findFile(part: ModelPart, choices: string[]): string | null {
  const base = (f: string) => f.split(/[\\/]/).pop()!;
  return choices.find((c) => base(c) === part.recommended) ?? choices.find((c) => part.match.test(c)) ?? null;
}

/** Whether each edit model can be used, from what ComfyUI says about the nodes in EDIT_NODES. */
export function checkEditModels(info: Record<string, NodeInfo>): EditCheck[] {
  return EDIT_MODELS.map((model) => {
    const missingNodes = model.nodes.filter((n) => !info[n]);
    const missingOptions = model.options
      .filter((o) => info[o.node] && !comboOptions(info[o.node], o.input).includes(o.value))
      .map((o) => `${o.node} ${o.input}: ${o.value}`);
    const parts = model.parts.map((part) => ({ part, file: findFile(part, comboOptions(info[part.loader], part.input)) }));
    const ready = missingNodes.length === 0 && missingOptions.length === 0 && parts.every((p) => p.file !== null);
    const files = ready ? Object.fromEntries(parts.map((p) => [p.part.key, p.file!])) : {};
    return { model, missingNodes, missingOptions, parts, files, ready };
  });
}
