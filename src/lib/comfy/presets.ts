// Named picture presets, set in Settings: drawing presets (new pictures and Redraw) and edit presets
// (one set for each edit model). Each has its own LoRAs and settings. A story chooses its default
// drawing preset on its details page, and a chapter can choose another on the Illustrate page. Pure code.
import { drawModel, FAMILY_NAMES, type DrawFamily, type DrawTuning } from "./drawModels";
import { EDIT_MODEL_IDS, type EditModelId, type EditTuning, type TextEncoderDevice } from "./editModels";

/** A LoRA in a preset's stack: its file in ComfyUI's `loras` folder, its strength, and whether it is used. */
export type LoraSetting = { name: string; strength: number; on: boolean };

/** The most LoRAs one preset's stack can hold. */
export const MAX_LORAS = 8;

/** The most presets of each kind. */
export const MAX_PRESETS = 40;

/** The Redraw strength a new drawing preset starts with. */
export const DEFAULT_DENOISE = 0.55;

/** How picture prompts are written: comma-separated tags (SDXL, Pony, SD 1.5) or plain sentences (Flux, SD3). */
export type PromptStyle = "tags" | "natural";

export const PROMPT_STYLE_NAMES: Record<PromptStyle, string> = {
  tags: "Tags (SDXL, Pony, SD 1.5)",
  natural: "Sentences (Flux, SD3)",
};

/** Whether a drawing preset draws with its family's built-in workflow: it has a family, and no workflow of its own (a pasted one overrides everything). */
export const usesFamily = (p: { family: DrawFamily; workflow: string }) => p.family !== "checkpoint" && !p.workflow.trim();

/** How new pictures are drawn, and redrawn from a picture. */
export type DrawPreset = {
  id: string;
  name: string;
  /** How prompts are written for this preset's model. */
  promptStyle: PromptStyle;
  /** Added to every prompt and negative prompt made with this preset (quality tags, for example); "" for none. */
  prompt: string;
  negative: string;
  /**
   * What kind of model it draws with: "checkpoint" (an SDXL-style all-in-one checkpoint, the built-in
   * SDXL workflow) or a family of separate files with its own built-in workflow (drawModels.ts).
   */
  family: DrawFamily;
  /** The checkpoint file of the "checkpoint" family (also what {{checkpoint}} is in your own workflow); "" until chosen. */
  checkpoint: string;
  /** The other families' files chosen for the model's parts, by part key (see drawModels.ts); a part not here is found by its name. */
  files: Record<string, string>;
  /** The other families' text encoder loader: "cpu" keeps it in system memory so the graphics card has room for the model. */
  textEncoderDevice: TextEncoderDevice;
  /** A workflow exported from ComfyUI in API format, as JSON; "" uses the family's built-in workflow (SDXL for a checkpoint). */
  workflow: string;
  /** Applied in order after the checkpoint (or the workflow's model loader). */
  loras: LoraSetting[];
  /** The built-in workflow's sampler settings that were changed; the rest are the family's defaults (BUILTIN_SAMPLER's for a checkpoint). */
  sampler: Partial<DrawTuning>;
  /** The strength the Redraw tab starts at: how far a redraw may change the picture, 0.05 to 1. */
  denoise: number;
};

/** How a picture is edited by instruction with one edit model. */
export type EditPreset = {
  id: string;
  name: string;
  model: EditModelId;
  /**
   * An all-in-one checkpoint (model, text encoder and VAE in one file, in ComfyUI's `checkpoints` folder)
   * to use instead of the model's own files, such as an uncensored fine-tune; "" for none.
   */
  checkpoint: string;
  /** Files chosen for the model's parts, by part key (see editModels.ts); a part not here uses the one found by its name. */
  files: Record<string, string>;
  /** Uses the model's speed-up (Qwen's Lightning LoRA) when ComfyUI has it. */
  fast: boolean;
  /** Where the text encoder is loaded: "cpu" keeps it in system memory so the graphics card has room for the model. */
  textEncoderDevice: TextEncoderDevice;
  /** Applied in order, after the speed-up. */
  loras: LoraSetting[];
  /** The model's settings that were changed, including the Edit tab's starting strength; the rest are the model's defaults. */
  tuning: Partial<EditTuning>;
};

export const newDrawPreset = (id: string, name: string, checkpoint = ""): DrawPreset => ({
  id, name, promptStyle: "tags", prompt: "", negative: "", family: "checkpoint", checkpoint, files: {}, textEncoderDevice: "default",
  workflow: "", loras: [], sampler: {}, denoise: DEFAULT_DENOISE,
});

export const newEditPreset = (id: string, name: string, model: EditModelId): EditPreset => ({
  id, name, model, checkpoint: "", files: {}, fast: true, textEncoderDevice: "default", loras: [], tuning: {},
});

/** The presets a fresh setup starts with: one for drawing, and one for each edit model (its id is the model's). */
export const DEFAULT_DRAW_PRESETS: DrawPreset[] = [newDrawPreset("default", "Default")];
export const DEFAULT_EDIT_PRESETS: EditPreset[] = EDIT_MODEL_IDS.map((m) => newEditPreset(m, "Default", m));

/** A new preset id. (crypto.randomUUID needs a secure context, which a LAN address over http isn't.) */
export const presetId = (kind: string) => `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** `name`, or "name 2", "name 3"… when another preset already has it. */
export function freeName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!used.has(name.trim().toLowerCase())) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

/** A preset's name as shown, with a stand-in when it has none. */
export const presetName = (p: { name: string }) => p.name.trim() || "Untitled preset";

/** The drawing preset to use: the first of `ids` that names one (a chapter's, then its story's), else the first preset. */
export function drawPresetFor(presets: DrawPreset[], ...ids: (string | null | undefined)[]): DrawPreset {
  for (const id of ids) {
    const found = id ? presets.find((p) => p.id === id) : undefined;
    if (found) return found;
  }
  return presets[0];
}

/** A checkpoint or LoRA file's name without its folder or extension, for short labels. */
export const fileLabel = (file: string) => file.split(/[\\/]/).pop()!.replace(/\.(safetensors|ckpt|pt|sft|gguf)$/i, "");

/**
 * The files pictures are drawn with, as the job log keeps them (in its checkpoint column): the checkpoint,
 * then " + " each LoRA with its strength, the way edits are kept (see editFilesText).
 */
export const drawFilesText = (checkpoint: string, loras: { name: string; strength: number }[]) =>
  [checkpoint, ...loras.map((l) => `${l.name} (${l.strength})`)].join(" + ");

/**
 * A drawing preset in a few words: its family (when it isn't a checkpoint) and model file, and how many LoRAs
 * it uses.
 */
export function drawPresetSummary(p: DrawPreset): string {
  const on = p.loras.filter((l) => l.on && l.name).length;
  const model =
    p.family === "checkpoint"
      ? [p.checkpoint ? fileLabel(p.checkpoint) : "no checkpoint"]
      : [drawModel(p.family)?.name ?? FAMILY_NAMES[p.family], p.files.model ? fileLabel(p.files.model) : "model found by name"];
  return [...model, on > 0 && `${on} LoRA${on === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
}
