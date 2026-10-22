// What drawing models and edit models share: a model is several files (a diffusion model, text encoders,
// a VAE) that ComfyUI's loader nodes list, any of which can be a .gguf file (ComfyUI-GGUF's loaders).
// Pure code, no network. editModels.ts and drawModels.ts build on it.
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
  /**
   * The loader (of the ComfyUI-GGUF custom nodes) that loads this part from a .gguf file, and its file input.
   * Its list is added to the part's choices; a .gguf file switches the part's loader node to it (see switchToGgufLoaders).
   */
  gguf?: { loader: string; input: string };
  /**
   * Which of an all-in-one checkpoint's outputs stands in for it (0 the model, 1 the text encoder, 2 the
   * VAE). It is also the workflow's loader node for it, less one: the model is node "1", the text encoder "2", the VAE "3".
   */
  output: 0 | 1 | 2;
};

/** A choice another node must offer, such as a text encoder type that only newer ComfyUIs know. */
export type NeededOption = { node: string; input: string; value: string };

export const TEXT_ENCODER_DEVICES = ["default", "cpu"] as const;
export type TextEncoderDevice = (typeof TEXT_ENCODER_DEVICES)[number];

/** A LoRA a model is drawn with: its file in ComfyUI's `loras` folder and how strongly it applies. */
export type ModelLora = { name: string; strength: number };

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

/** The names of the inputs a node lists, required or optional. */
const inputNames = (info: NodeInfo) => Object.keys({ ...info?.input?.optional, ...info?.input?.required });

/** The sorted, distinct node classes a workflow uses. */
export const nodesOf = (wf: Workflow) => [...new Set(Object.values(wf).map((n) => n.class_type))].sort();

/** The model loader of the ComfyUI-GGUF custom nodes; it lists .gguf files from `diffusion_models` and `unet`. */
export const UNET_GGUF = { loader: "UnetLoaderGGUF", input: "unet_name" };

/** Whether a file is a GGUF one, which needs the ComfyUI-GGUF loaders. */
export const isGguf = (file: string) => /\.gguf$/i.test(file);

const base = (f: string) => f.split(/[\\/]/).pop()!;
export { base as baseName };

// Parts both the edit models and the drawing models use.
export const QWEN_TEXT_ENCODER: ModelPart = {
  key: "textEncoder", label: "Qwen 2.5 VL text encoder", folder: "text_encoders", loader: "CLIPLoader", input: "clip_name",
  recommended: "qwen_2.5_vl_7b_fp8_scaled.safetensors", match: /qwen[-_]?2\.5[-_]?vl[-_]?7b/i, output: 1,
  gguf: { loader: "CLIPLoaderGGUF", input: "clip_name" },
};
export const QWEN_VAE: ModelPart = {
  key: "vae", label: "Qwen-Image VAE", folder: "vae", loader: "VAELoader", input: "vae_name",
  recommended: "qwen_image_vae.safetensors", match: /qwen[-_]?image[-_]?vae/i, output: 2,
};
export const CLIP_L: ModelPart = {
  key: "clipL", label: "CLIP-L text encoder", folder: "text_encoders", loader: "DualCLIPLoader", input: "clip_name1",
  recommended: "clip_l.safetensors", match: /(^|[\\/])clip_l[^\\/]*\.(safetensors|gguf)$/i, output: 1,
  gguf: { loader: "DualCLIPLoaderGGUF", input: "clip_name1" },
};
export const T5_XXL: ModelPart = {
  key: "t5", label: "T5-XXL text encoder", folder: "text_encoders", loader: "DualCLIPLoader", input: "clip_name2",
  recommended: "t5xxl_fp8_e4m3fn_scaled.safetensors", match: /t5[-_ ]?(v1_1[-_ ])?xxl/i, output: 1,
  gguf: { loader: "DualCLIPLoaderGGUF", input: "clip_name2" },
};
export const FLUX_VAE: ModelPart = {
  key: "vae", label: "FLUX VAE", folder: "vae", loader: "VAELoader", input: "vae_name",
  recommended: "ae.safetensors", match: /(^|[\\/])(ae|flux[-_]?ae|flux[-_]?vae|flux1[-_]?ae)\.(safetensors|sft)$/i, output: 2,
};

/**
 * One part of a model and the file used for it: the one a preset chose, else the one found by its name;
 * null when there is none (or, with `fromCheckpoint`, when the all-in-one checkpoint's own is used).
 */
export type PartCheck = {
  part: ModelPart;
  file: string | null;
  /** Every file its loader lists, for choosing one in Settings. */
  choices: string[];
  /** The file a preset chose for it, whether or not ComfyUI lists it. */
  chosen?: string;
  /** The preset's all-in-one checkpoint supplies it. */
  fromCheckpoint?: boolean;
};

/** What ComfyUI says about a loader node: the inputs it lists and the choices of its `device`. */
export type LoaderInfo = { inputs: string[]; devices: string[] };

/**
 * The file for a part among the ones a loader lists: one of the same release (such as 2509) as `release`
 * when given, else the recommended one, else the first that looks like it.
 */
export function findFile(part: ModelPart, choices: string[], release?: string): string | null {
  // A safetensors file is preferred to a GGUF one of the same kind; a GGUF text encoder's mmproj file is not a text encoder.
  const like = choices.filter((c) => part.match.test(c) && !/mmproj/i.test(c)).sort((a, b) => Number(isGguf(a)) - Number(isGguf(b)));
  return (release && like.find((c) => base(c).includes(release))) || choices.find((c) => base(c) === part.recommended) || like[0] || null;
}

/** A part's file: the one a preset chose (`pick`, found only if ComfyUI lists it), else the one found by its name. */
export function pickPart(part: ModelPart, choices: string[], pick?: string): PartCheck {
  if (pick) return { part, choices, chosen: pick, file: choices.includes(pick) ? pick : null };
  return { part, choices, file: findFile(part, choices) };
}

/** A part's choices: its loader's files, then the GGUF loader's (which also lists the others). */
export function partChoices(part: ModelPart, info: Record<string, NodeInfo>): string[] {
  return [...new Set([...comboOptions(info[part.loader], part.input), ...(part.gguf ? comboOptions(info[part.gguf.loader], part.gguf.input) : [])])];
}

/** What ComfyUI says about each loader node the parts use (the GGUF ones too) that it has, and the GGUF loaders it lacks. */
export function loaderReport(parts: ModelPart[], info: Record<string, NodeInfo>): { loaders: Record<string, LoaderInfo>; ggufMissing: string[] } {
  const ggufLoaders = [...new Set(parts.flatMap((p) => (p.gguf ? [p.gguf.loader] : [])))];
  const loaders: Record<string, LoaderInfo> = {};
  for (const name of [...parts.map((p) => p.loader), ...ggufLoaders]) {
    if (info[name]) loaders[name] = { inputs: inputNames(info[name]), devices: comboOptions(info[name], "device") };
  }
  return { loaders, ggufMissing: ggufLoaders.filter((n) => !info[n]) };
}

/** Choices a node should offer but doesn't, as "Node input: value". */
export function missingOptionsOf(options: NeededOption[], info: Record<string, NodeInfo>): string[] {
  return options.filter((o) => info[o.node] && !comboOptions(info[o.node], o.input).includes(o.value)).map((o) => `${o.node} ${o.input}: ${o.value}`);
}

/**
 * What the files found for the parts say about the loaders: whether the GGUF loaders are installed for
 * every part that uses a .gguf file, and where the text encoder can be loaded (the choices of `device` on
 * the loader in use, the GGUF one for a .gguf file; empty when it has no such input).
 */
export function partsState(parts: PartCheck[], loaders: Record<string, LoaderInfo>): { ggufInstalled: boolean; devices: string[] } {
  const ggufInstalled = parts.every((p) => !p.file || !isGguf(p.file) || !p.part.gguf || !!loaders[p.part.gguf.loader]);
  const encoders = parts.filter((p) => p.part.output === 1 && !p.fromCheckpoint);
  const encoderLoader = encoders.length === 0 ? null : encoders.some((p) => p.file && isGguf(p.file)) ? encoders[0].part.gguf?.loader : encoders[0].part.loader;
  return { ggufInstalled, devices: (encoderLoader && loaders[encoderLoader]?.devices) || [] };
}

/**
 * The LoRA loaders between the model loader (`from`) and what uses the model: the speed-up first (when
 * given), then the author's stack in order. Returns the nodes and the link to the last model.
 */
export function loraChain(from: [string, number], speedUp: string | null, stack: ModelLora[] = []): { nodes: Workflow; model: [string, number] } {
  const nodes: Workflow = {};
  let model = from;
  const add = (id: string, name: string, strength: number) => {
    nodes[id] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: name, strength_model: strength } };
    model = [id, 0];
  };
  if (speedUp) add("9", speedUp, 1);
  stack.forEach((l, i) => add(String(30 + i), l.name, l.strength));
  return { nodes, model };
}

/**
 * Switches the loader node of every part whose file is a .gguf to the ComfyUI-GGUF loader, keeping only
 * the inputs that node lists (the normal loaders' weight_dtype or device may not be there); the file
 * inputs are always kept. Then drops the text encoder's `device` when its loader doesn't list it or
 * doesn't offer the value. A loader ComfyUI told us nothing about keeps all its inputs.
 */
export function switchToGgufLoaders(parts: ModelPart[], files: Record<string, string>, loaders: Record<string, LoaderInfo>, wf: Workflow) {
  const fileInputs = new Set(parts.flatMap((q) => [q.input, ...(q.gguf ? [q.gguf.input] : [])]));
  for (const part of parts) {
    const file = files[part.key];
    const node = wf[String(part.output + 1)];
    if (!part.gguf || !file || !isGguf(file) || !node) continue;
    node.class_type = part.gguf.loader;
    const listed = loaders[part.gguf.loader]?.inputs;
    if (listed) node.inputs = Object.fromEntries(Object.entries(node.inputs).filter(([k]) => listed.includes(k) || fileInputs.has(k)));
  }
  const encoder = wf["2"];
  const info = encoder && parts.some((q) => q.output === 1) ? loaders[encoder.class_type] : undefined;
  if (info && "device" in encoder.inputs && (!info.inputs.includes("device") || (info.devices.length > 0 && !info.devices.includes(String(encoder.inputs.device))))) {
    delete encoder.inputs.device;
  }
}
