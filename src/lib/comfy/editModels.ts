// Models that change a picture by following an instruction ("remove the logo on the shirt"), and the
// ComfyUI workflows StoryTime builds for them. Pure code, no network: the check of what ComfyUI has
// installed reads the answers of ComfyUI's /object_info, fetched by `checkComfy` in check.ts.
//
// Each model needs some files in ComfyUI's models folder (the README says where to get them) and some
// nodes, all of them part of ComfyUI itself in recent versions. A model can be used only when every node
// is there and a file is found for every part.
import {
  baseName, CLIP_L, comboOptions, findFile, FLUX_VAE, loaderReport, loraChain, missingOptionsOf, nodesOf, partChoices, partsState, pickPart,
  QWEN_TEXT_ENCODER, QWEN_VAE, switchToGgufLoaders, T5_XXL, UNET_GGUF,
  type LoaderInfo, type ModelLora, type ModelPart, type NeededOption, type NodeInfo, type PartCheck, type TextEncoderDevice,
} from "./modelParts";
import type { SamplerTuning, Workflow } from "./workflow";

// What edit models share with drawing models lives in modelParts.ts; these are re-exported for the code that always imported them here.
export { comboOptions, isGguf, TEXT_ENCODER_DEVICES } from "./modelParts";
export type { LoaderInfo, ModelPart, NodeInfo, PartCheck, TextEncoderDevice } from "./modelParts";

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
  /** The author's LoRA stack for this model, applied in order after any speed-up. */
  loras?: EditLora[];
  /** The model's settings (`editTuning`); its defaults when not given. */
  tuning?: EditTuning;
  /** Where the text encoder is loaded: ComfyUI's "default", or "cpu" to keep it in system memory. */
  textEncoderDevice?: TextEncoderDevice;
  /**
   * Reference pictures (names in ComfyUI's input folder, at most 2) shown to the model beside the starting
   * picture: Qwen takes them as images 2 and 3, Kontext uses the first as one more reference latent.
   */
  refs?: string[];
};

/** How many reference pictures an edit takes: Qwen-Image-Edit two (images 2 and 3), Kontext one. */
export const EDIT_REFS = { qwen: 2, kontext: 1 } as const;

/**
 * What an edit model runs with: the sampler's settings, the default strength the Edit tab starts at, and
 * the settings only some models have (Qwen's shift, Kontext's guidance).
 */
export type EditTuning = SamplerTuning & {
  /** The Edit tab's strength to start with (see EditParams.denoise). */
  strength: number;
  /** Qwen: ModelSamplingAuraFlow's shift. Higher spends more of the steps on the big shapes. */
  shift?: number;
  /** Kontext: FluxGuidance, how closely it follows the instruction. */
  guidance?: number;
};

/** The settings an edit model has beyond the sampler's. */
export type EditKnob = "shift" | "guidance";

/**
 * An optional file that makes a model faster, such as a Lightning LoRA: fewer steps at CFG 1. The model
 * works without it; with it, the Illustrate page offers a Fast box.
 */
export type SpeedUp = ModelPart & {
  /** What the setup check and the Fast box call it. */
  name: string;
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
  /** An optional file that makes it faster, if the model has one. */
  speedUp?: SpeedUp;
  /** What it runs with unless changed in Settings, including its extra settings (`shift`, `guidance`). */
  defaults: EditTuning;
  /**
   * The workflow, with the files found for each part (by part key). With `fast`, the file of the
   * speed-up (`files.speedUp`) is used too.
   */
  build: (files: Record<string, string>, p: EditParams, fast?: boolean) => Workflow;
};

/**
 * How many steps a Lightning LoRA is made for, from its file name ("…-Lightning-4steps-…" is 4), or 8
 * when the name doesn't say.
 */
export function lightningSteps(file: string): number {
  const n = Number(/(\d+)[-_ ]?steps?/i.exec(file)?.[1]);
  return Number.isInteger(n) && n > 0 && n <= 50 ? n : 8;
}

export const EDIT_MODEL_IDS = ["qwen-image-edit", "flux-kontext"] as const;
export type EditModelId = (typeof EDIT_MODEL_IDS)[number];

/** The picture is scaled to this many pixels (about one megapixel), the size both models were trained at. */
const EDIT_PIXELS = 1024 * 1024;

/** The size an edit of a picture is made at: its shape, at about one megapixel, in multiples of 16. */
export function editSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.sqrt(EDIT_PIXELS / (width * height));
  const round = (v: number) => Math.max(16, Math.round((v * scale) / 16) * 16);
  return { width: round(width), height: round(height) };
}

/** A LoRA in an edit model's stack: its file in ComfyUI's `loras` folder and how strongly it applies. */
export type EditLora = ModelLora;

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

/** Qwen-Image-Edit 2509's defaults, as in ComfyUI's own template: 20 steps of Euler at CFG 2.5, shift 3. */
const QWEN_DEFAULTS: EditTuning = { steps: 20, cfg: 2.5, sampler: "euler", scheduler: "simple", strength: 1, shift: 3 };
/** FLUX.1 Kontext dev's defaults: 20 steps of Euler at CFG 1, guidance 2.5. */
const KONTEXT_DEFAULTS: EditTuning = { steps: 20, cfg: 1, sampler: "euler", scheduler: "simple", strength: 1, guidance: 2.5 };

/** The sampler's inputs for an edit: the model's settings, or with a Lightning LoRA the steps it was made for at CFG 1. */
function samplerInputs(t: EditTuning, lightning: string | null) {
  return {
    steps: lightning ? lightningSteps(lightning) : t.steps,
    cfg: lightning ? 1 : t.cfg,
    sampler_name: t.sampler,
    scheduler: t.scheduler,
  };
}

/**
 * Qwen-Image-Edit 2509, with its settings (`p.tuning`). Fast, with the Lightning LoRA (`files.speedUp`):
 * the steps it was made for (4 or 8) at CFG 1.
 */
function qwenWorkflow(files: Record<string, string>, p: EditParams, fast = false): Workflow {
  const t = p.tuning ?? QWEN_DEFAULTS;
  const lightning = fast && files.speedUp ? files.speedUp : null;
  const chain = loraChain(["1", 0], lightning, p.loras);
  // Each reference is one more image for the text encoders ("image 2", "image 3" in the instruction).
  const refs = (p.refs ?? []).slice(0, EDIT_REFS.qwen);
  const refNodes: Workflow = Object.fromEntries(refs.map((image, i) => [`3${i}`, { class_type: "LoadImage", inputs: { image } }]));
  const refInputs = Object.fromEntries(refs.map((_, i) => [`image${i + 2}`, [`3${i}`, 0]]));
  const encode = (prompt: string) => ({
    class_type: "TextEncodeQwenImageEditPlus",
    inputs: { clip: ["2", 0], vae: ["3", 0], image1: ["11", 0], ...refInputs, prompt },
  });
  return {
    ...refNodes,
    "1": { class_type: "UNETLoader", inputs: { unet_name: files.model, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: files.textEncoder, type: "qwen_image", device: p.textEncoderDevice ?? "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    ...chain.nodes,
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: chain.model, shift: t.shift ?? QWEN_DEFAULTS.shift } },
    "5": { class_type: "CFGNorm", inputs: { model: ["4", 0], strength: 1 } },
    "6": encode(p.instruction),
    "7": encode(""),
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: p.seed, ...samplerInputs(t, lightning), denoise: p.denoise,
        model: ["5", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["13", 0],
      },
    },
    ...shared(p, ["3", 0], "8"),
  };
}

/** FLUX.1 Kontext dev, with its settings (`p.tuning`): the picture as a reference latent, and the guidance. */
function kontextWorkflow(files: Record<string, string>, p: EditParams): Workflow {
  const t = p.tuning ?? KONTEXT_DEFAULTS;
  const chain = loraChain(["1", 0], null, p.loras);
  // A reference is a second reference latent after the starting picture's: loaded, scaled to the size, encoded.
  const ref = (p.refs ?? []).slice(0, EDIT_REFS.kontext)[0];
  const refNodes: Workflow = ref
    ? {
        "30": { class_type: "LoadImage", inputs: { image: ref } },
        "31": { class_type: "ImageScale", inputs: { image: ["30", 0], upscale_method: "lanczos", width: p.width, height: p.height, crop: "disabled" } },
        "32": { class_type: "VAEEncode", inputs: { pixels: ["31", 0], vae: ["3", 0] } },
        "33": { class_type: "ReferenceLatent", inputs: { conditioning: ["5", 0], latent: ["32", 0] } },
      }
    : {};
  return {
    ...refNodes,
    "1": { class_type: "UNETLoader", inputs: { unet_name: files.model, weight_dtype: "default" } },
    ...chain.nodes,
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: files.clipL, clip_name2: files.t5, type: "flux", device: p.textEncoderDevice ?? "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.instruction } },
    "5": { class_type: "ReferenceLatent", inputs: { conditioning: ["4", 0], latent: ["12", 0] } },
    "6": { class_type: "FluxGuidance", inputs: { conditioning: [ref ? "33" : "5", 0], guidance: t.guidance ?? KONTEXT_DEFAULTS.guidance } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: p.seed, ...samplerInputs(t, null), denoise: p.denoise,
        model: chain.model, positive: ["6", 0], negative: ["7", 0], latent_image: ["13", 0],
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
        recommended: "qwen_image_edit_2509_fp8_e4m3fn.safetensors", match: /qwen[-_ ]?image[-_ ]?edit|qwen.*rapid[-_ ]?aio/i, output: 0,
        gguf: UNET_GGUF,
      },
      QWEN_TEXT_ENCODER,
      QWEN_VAE,
    ],
    speedUp: {
      key: "speedUp", name: "Lightning", label: "Lightning LoRA (optional, for fast edits)", folder: "loras", loader: "LoraLoaderModelOnly",
      input: "lora_name", recommended: "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors", match: /qwen[-_ ]?image[-_ ]?edit.*lightning/i, output: 0,
    },
    defaults: QWEN_DEFAULTS,
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
        recommended: "flux1-dev-kontext_fp8_scaled.safetensors", match: /kontext/i, output: 0,
        gguf: UNET_GGUF,
      },
      CLIP_L,
      T5_XXL,
      FLUX_VAE,
    ],
    defaults: KONTEXT_DEFAULTS,
    nodes: nodesOf(kontextWorkflow({}, SAMPLE)),
    options: [{ node: "DualCLIPLoader", input: "type", value: "flux" }],
    build: kontextWorkflow,
  },
];

export const editModel = (id: string): EditModel | undefined => EDIT_MODELS.find((m) => m.id === id);

/** The settings a model has beyond the sampler's, from its defaults. */
export const editKnobs = (model: EditModel): EditKnob[] => (["shift", "guidance"] as const).filter((k) => model.defaults[k] !== undefined);

/**
 * What a model runs with: its defaults with the settings changed in Settings (`changed`). Settings it
 * doesn't have (Kontext's shift) are left out.
 */
export function editTuning(model: EditModel, changed: Partial<EditTuning> = {}): EditTuning {
  const t: EditTuning = { ...model.defaults };
  for (const [k, v] of Object.entries(changed) as [keyof EditTuning, EditTuning[keyof EditTuning]][]) {
    if (v !== undefined && k in model.defaults) (t as Record<string, unknown>)[k] = v;
  }
  return t;
}

/**
 * The files an edit preset chose instead of the ones found by their names: an all-in-one checkpoint (the
 * model, text encoder and VAE in one file, from ComfyUI's `checkpoints` folder) or "", and by part key a
 * file for any part. With a checkpoint, a part not chosen uses the checkpoint's own.
 */
export type FileChoice = { checkpoint: string; files: Partial<Record<string, string>> };

export type EditCheck = {
  model: EditModel;
  /** Nodes the workflow needs that ComfyUI doesn't have (ComfyUI is too old, most likely). */
  missingNodes: string[];
  /** Choices a node should offer but doesn't, as "Node input: value". */
  missingOptions: string[];
  parts: PartCheck[];
  /**
   * The files to use, by part key, when every part was found; with `speedUp` when that was found too, and
   * `checkpoint` when a preset chose an all-in-one checkpoint (see presetCheck).
   */
  files: Record<string, string>;
  /** The preset's all-in-one checkpoint, and whether ComfyUI lists it; null without one. */
  checkpoint: { file: string; found: boolean } | null;
  /** Every all-in-one checkpoint ComfyUI lists (its `checkpoints` folder), for choosing one in Settings. */
  checkpoints: string[];
  /** Whether everything is there, so the model can be used. */
  ready: boolean;
  /** The optional speed-up and the file found for it (null when it isn't installed), for models that have one. */
  speedUp: PartCheck | null;
  /** Every LoRA file ComfyUI lists (its `loras` folder), for the author's stack; empty when it has no LoRA loader. */
  loras: string[];
  /** The samplers and schedulers ComfyUI's KSampler offers, for the choices in Settings. */
  samplers: string[];
  schedulers: string[];
  /** What ComfyUI says about each loader node the parts use (the GGUF ones too) that it has: the inputs it lists and the choices of its `device`. */
  loaders: Record<string, LoaderInfo>;
  /** The GGUF loader nodes of this model that ComfyUI doesn't have (ComfyUI-GGUF isn't installed). */
  ggufMissing: string[];
  /** The choices for where the text encoder is loaded, on the loader in use (the GGUF one for a .gguf file); empty when it has no such input. */
  devices: string[];
};

/** The node that loads a LoRA onto a model, for the speed-up and the author's stack. */
const LORA_LOADER = "LoraLoaderModelOnly";

/** The node that loads an all-in-one checkpoint. */
const CHECKPOINT_LOADER = "CheckpointLoaderSimple";

/** Every node the checks below need to ask ComfyUI about. */
export const EDIT_NODES = [
  ...new Set([
    LORA_LOADER,
    CHECKPOINT_LOADER,
    ...EDIT_MODELS.flatMap((m) => [
      ...m.nodes, ...m.parts.map((p) => p.loader), ...m.parts.flatMap((p) => (p.gguf ? [p.gguf.loader] : [])),
      ...m.options.map((o) => o.node), ...(m.speedUp ? [m.speedUp.loader] : []),
    ]),
  ]),
].sort();

const base = baseName;

/** The release number in a model's file name, such as "2509" in qwen_image_edit_2509_fp8.safetensors. */
const releaseOf = (file: string | undefined) => (file ? /(?:^|[^\d])(2\d{3})(?:[^\d]|$)/.exec(base(file))?.[1] : undefined);

/**
 * The files an edit is made with, as the job log keeps them (in its checkpoint column): the model's
 * file, and " + " the speed-up's when it is used.
 */
export const editFilesText = (check: EditCheck, fast: boolean, loras: EditLora[] = []) =>
  [check.files.checkpoint ?? check.files.model, ...(fast && check.files.speedUp ? [check.files.speedUp] : []), ...loras.map((l) => `${l.name} (${l.strength})`)].join(" + ");

/** What an edit's files (see editFilesText) say beyond the model: whether it was fast, and how many LoRAs of the author's it used. */
export function editFilesExtras(modelId: string, text: string): { fast: boolean; loras: number } {
  const [, ...extras] = text.split(" + ");
  const speedUp = editModel(modelId)?.speedUp;
  // The speed-up is added without a strength; the author's LoRAs always have one.
  const fast = extras.some((e) => !/\(-?[\d.]+\)$/.test(e) && (!speedUp || speedUp.match.test(e)));
  return { fast, loras: extras.filter((e) => /\(-?[\d.]+\)$/.test(e)).length };
}

/**
 * The author's stack for a model as it can be used now: the LoRAs switched on whose files ComfyUI still
 * lists. `missing` names the ones switched on that it doesn't.
 */
export function usableLoras(stack: { name: string; strength: number; on: boolean }[], available: string[]): { loras: EditLora[]; missing: string[] } {
  const on = stack.filter((l) => l.on && l.name);
  return {
    loras: on.filter((l) => available.includes(l.name)).map(({ name, strength }) => ({ name, strength })),
    missing: on.filter((l) => !available.includes(l.name)).map((l) => l.name),
  };
}

/** Whether each edit model can be used with the files found by their names, from what ComfyUI says about the nodes in EDIT_NODES. */
export function checkEditModels(info: Record<string, NodeInfo>): EditCheck[] {
  return EDIT_MODELS.map((model) => {
    const missingNodes = model.nodes.filter((n) => !info[n]);
    const missingOptions = missingOptionsOf(model.options, info);
    const s = model.speedUp;
    const { loaders, ggufMissing } = loaderReport(model.parts, info);
    const found: EditCheck = {
      model, missingNodes, missingOptions,
      parts: model.parts.map((part) => ({ part, file: null, choices: partChoices(part, info) })),
      loaders, ggufMissing, devices: [],
      files: {}, ready: false, checkpoint: null,
      checkpoints: comboOptions(info[CHECKPOINT_LOADER], "ckpt_name"),
      speedUp: s ? { part: s, file: null, choices: comboOptions(info[s.loader], s.input) } : null,
      loras: comboOptions(info[LORA_LOADER], "lora_name"),
      samplers: comboOptions(info.KSampler, "sampler_name"),
      schedulers: comboOptions(info.KSampler, "scheduler"),
    };
    return presetCheck(found, { checkpoint: "", files: {} });
  });
}

/**
 * Whether a model can be used with the files an edit preset chose (`choice`), and the files it uses: each
 * part's chosen file, else with an all-in-one checkpoint the checkpoint's own, else the one found by its
 * name. A part shares its loader with others (Flux's two text encoders), so when one of them is chosen
 * the others use files of their own too, not the checkpoint's.
 */
export function presetCheck(check: EditCheck, choice: FileChoice): EditCheck {
  const checkpoint = choice.checkpoint ? { file: choice.checkpoint, found: check.checkpoints.includes(choice.checkpoint) } : null;
  const chosen = (key: string) => choice.files[key] || undefined;
  // The model is always the checkpoint's; the others when nothing on their loader was chosen.
  const ownLoader = (part: ModelPart) =>
    part.output !== 0 && check.model.parts.some((q) => q.output === part.output && chosen(q.key));
  const parts: PartCheck[] = check.parts.map(({ part, choices }) => {
    const pick = checkpoint && part.output === 0 ? undefined : chosen(part.key);
    if (pick) return pickPart(part, choices, pick);
    if (checkpoint && !ownLoader(part)) return { part, choices, file: null, fromCheckpoint: true };
    return pickPart(part, choices);
  });
  // The GGUF loaders are needed only for the parts that use a .gguf file; the text encoder loader in use says where it can be loaded.
  const { ggufInstalled, devices } = partsState(parts, check.loaders);
  const ready =
    check.missingNodes.length === 0 &&
    check.missingOptions.length === 0 &&
    ggufInstalled &&
    (!checkpoint || checkpoint.found) &&
    parts.every((p) => p.file !== null || p.fromCheckpoint);
  const files: Record<string, string> = ready
    ? Object.fromEntries(parts.filter((p) => p.file !== null).map((p) => [p.part.key, p.file!]))
    : {};
  if (ready && checkpoint) files.checkpoint = checkpoint.file;
  // A speed-up made for the model's release (the 2509 LoRA for the 2509 model) is preferred.
  const s = check.speedUp;
  const speedUp = s ? { ...s, file: findFile(s.part, s.choices, releaseOf(files.model ?? files.checkpoint)) } : null;
  if (ready && speedUp?.file) files.speedUp = speedUp.file;
  return { ...check, parts, files, ready, checkpoint, speedUp, devices };
}

/** An edit preset's check: its model's, with the files it chose. Null when ComfyUI's answer has no such model. */
export function editPresetCheck(checks: EditCheck[], preset: FileChoice & { model: string }): EditCheck | null {
  const check = checks.find((c) => c.model.id === preset.model);
  return check ? presetCheck(check, preset) : null;
}

/**
 * The workflow for an edit, with the files of `check` (see presetCheck). With an all-in-one checkpoint,
 * node "1" loads it instead of the model, and the text encoder's and VAE's loaders give way to its
 * outputs unless the preset chose files for them.
 */
export function buildEdit(check: EditCheck, p: EditParams, fast?: boolean): Workflow {
  const wf = check.model.build(check.files, p, fast);
  switchToGgufLoaders(check.model.parts, check.files, check.loaders, wf);
  const ckpt = check.files.checkpoint;
  if (!ckpt) return wf;
  wf["1"] = { class_type: CHECKPOINT_LOADER, inputs: { ckpt_name: ckpt } };
  for (const output of [1, 2] as const) {
    const own = check.model.parts.some((q) => q.output === output && check.files[q.key]);
    if (own) continue;
    const loader = String(output + 1);
    delete wf[loader];
    for (const node of Object.values(wf)) {
      for (const [k, v] of Object.entries(node.inputs)) {
        if (Array.isArray(v) && v[0] === loader && v[1] === 0) node.inputs[k] = ["1", output];
      }
    }
  }
  return wf;
}
