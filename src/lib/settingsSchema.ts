import { z } from "zod";
import { PROVIDER_KINDS, providerInfo, type ProviderKind } from "./ai/providers";
import { EDIT_MODEL_IDS, EDIT_MODELS } from "./comfy/editModels";
import {
  DEFAULT_DENOISE,
  DEFAULT_DRAW_PRESETS,
  DEFAULT_EDIT_PRESETS,
  fileLabel,
  MAX_LORAS,
  MAX_PRESETS,
  newEditPreset,
  type DrawPreset,
  type EditPreset,
} from "./comfy/presets";

// Types, defaults and parsing, shared by the browser and the server (which stores the settings).

export type { DrawPreset, EditPreset, LoraSetting } from "./comfy/presets";

/** One server to talk to. There can be several of the same kind (say, two Ollama machines). */
export type Connection = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  /**
   * Ask ComfyUI to unload its models and free memory before each request to this connection, so a model
   * running on the same machine has the graphics memory. Does nothing while no ComfyUI address is set.
   */
  freeComfy: boolean;
};

/** A model on a particular connection. */
export type ModelRef = { connectionId: string; model: string };

/** The jobs a starred model can be offered for; each is a model picker (and, for some, a default) in the app. */
export const MODEL_USES = [
  { id: "write", label: "Writing chapters", hint: "the writing picker and the default model" },
  { id: "suggest", label: "Suggestions", hint: "ideas, choices and button text" },
  { id: "summary", label: "Summaries and small jobs", hint: "the cheaper model: summaries and codex scans" },
  { id: "picture", label: "Picture prompts", hint: "the Illustrate page" },
] as const;
export type ModelUse = (typeof MODEL_USES)[number]["id"];
const MODEL_USE_IDS = MODEL_USES.map((u) => u.id) as [ModelUse, ...ModelUse[]];

/** A model starred in Settings; these are what the pickers on the writing page offer. */
export type Favorite = ModelRef & {
  /** Optional nickname shown instead of the model id. */
  label: string;
  /** Ask this model not to use extended thinking / reasoning. Off for models that only work with it. */
  disableThinking: boolean;
  /** Jobs this model is not offered for. Empty (the default) means it is offered everywhere, including jobs added later. */
  hiddenFrom: ModelUse[];
};

export type Settings = {
  connections: Connection[];
  favorites: Favorite[];
  defaults: {
    /** Used for writing chapters, unless a draft picks another model. */
    main: ModelRef | null;
    /** Cheaper model for summaries, suggestions and other small jobs. Falls back to `main` when null. */
    cheap: ModelRef | null;
  };
  /** null = use the provider's default. */
  temperature: number | null;
  /** Rough budget for the prompt context, so small local models aren't overflowed. */
  contextTokens: number;
  /** After the AI writes a chapter, also suggest choices for its ending (one more call to the cheaper model). */
  autoSuggestChoices: boolean;
  /** What the outline shows after each chapter's name. */
  outline: OutlineOptions;
  /** How picture prompts are written: comma-separated tags (SDXL, Pony, SD 1.5) or plain sentences (Flux, SD3). */
  imagePromptStyle: ImagePromptStyle;
  /** Model that writes picture prompts on the Illustrate page; null uses the cheaper default. */
  imagePromptModel: ModelRef | null;
  /** The ComfyUI machine that makes pictures, and the choices last used on the Illustrate page. */
  comfy: ComfySettings;
};

export type ImagePromptStyle = "tags" | "natural";

/** The parts of the [...] section after each chapter's name in the outline; each is shown unless turned off. */
export type OutlineOptions = {
  /** The summary button on each chapter, and Show all summaries above the outline. */
  summary: boolean;
  /** The link to read the story down to this chapter. */
  readToHere: boolean;
  /** An icon, for a chapter with a header picture, that shows it. */
  headerPicture: boolean;
  /** The same for the footer picture. */
  footerPicture: boolean;
  /** A paintbrush that opens the chapter's Illustrate page. */
  illustrate: boolean;
};

export const OUTLINE_PARTS = [
  { id: "summary", label: "Summary", hint: "a button that shows the chapter's summary, and Show all summaries above the outline" },
  { id: "readToHere", label: "Read to here", hint: "a link to the story from the start down to the chapter, on one page" },
  { id: "headerPicture", label: "Header picture", hint: "an icon, for chapters that have one, that shows it in a popup" },
  { id: "footerPicture", label: "Footer picture", hint: "the same for the footer picture" },
  { id: "illustrate", label: "Illustrate", hint: "a paintbrush that opens the chapter's Illustrate page" },
] as const satisfies readonly { id: keyof OutlineOptions; label: string; hint: string }[];

export const DEFAULT_OUTLINE: OutlineOptions = { summary: true, readToHere: true, headerPicture: true, footerPicture: true, illustrate: true };

export type ComfySettings = {
  /** Where ComfyUI is, e.g. https://comfy.example.ts.net; "" when there is none. */
  url: string;
  width: number;
  height: number;
  /** The size of cover pictures, chosen on the cover page (taller than wide by default, like a book). */
  coverWidth: number;
  coverHeight: number;
  /** How many pictures to make at once. No longer used by the Illustrate page, which makes one per click. */
  count: number;
  /** Drawing presets (new pictures and Redraw); never empty. The first is the default for stories that choose none. */
  drawPresets: DrawPreset[];
  /** Edit presets, each for one edit model; every edit model has at least one. */
  editPresets: EditPreset[];
  /** The edit preset last used on the Illustrate page's Edit tab (an id from `editPresets`). */
  editPreset: string;
  /** The Pictures panel lists the oldest first (the newest at the bottom) instead of the newest first. */
  picturesOldestFirst: boolean;
  /** How many pictures one click of Queue asks for (one of `QUEUE_COUNTS`). */
  queueCount: number;
};

/** The numbers of pictures one click of Queue can ask for. */
export const QUEUE_COUNTS = [1, 2, 4, 5, 8] as const;

export const DEFAULT_SETTINGS: Settings = {
  connections: [],
  favorites: [],
  defaults: { main: null, cheap: null },
  temperature: null,
  contextTokens: 8000,
  autoSuggestChoices: false,
  outline: DEFAULT_OUTLINE,
  imagePromptStyle: "tags",
  imagePromptModel: null,
  comfy: { url: "", width: 1344, height: 768, coverWidth: 832, coverHeight: 1216, count: 4, drawPresets: DEFAULT_DRAW_PRESETS, editPresets: DEFAULT_EDIT_PRESETS, editPreset: "qwen-image-edit", picturesOldestFirst: false, queueCount: 1 },
};

// Each field falls back to its default when missing or invalid, so partial files still
// import cleanly. Broken list entries are dropped rather than failing the whole file.
const connectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().catch(""),
  kind: z.enum(PROVIDER_KINDS).catch("custom"),
  baseUrl: z.string().catch(""),
  apiKey: z.string().catch(""),
  freeComfy: z.boolean().catch(false),
});
const refSchema = z.object({ connectionId: z.string().min(1), model: z.string().trim().min(1) });
const favoriteSchema = refSchema.extend({
  label: z.string().catch(""),
  // Missing in settings from before it was per model; parseSettings fills it in from the old global switch.
  disableThinking: z.boolean().optional().catch(undefined),
  hiddenFrom: z
    .array(z.unknown())
    .catch([])
    .transform((xs) => MODEL_USE_IDS.filter((u) => xs.includes(u))),
});

const loraSchema = z.object({
  name: z.string().max(500),
  strength: z.number().min(-4).max(4).catch(1),
  on: z.boolean().catch(true),
});

/** The limits of each sampler setting in Settings. */
export const TUNING_LIMITS = {
  steps: { min: 1, max: 150, step: 1 },
  cfg: { min: 0, max: 30, step: 0.1 },
  shift: { min: 0, max: 20, step: 0.1 },
  guidance: { min: 0, max: 30, step: 0.1 },
  strength: { min: 0.05, max: 1, step: 0.05 },
} as const;

// A changed setting out of range, or of the wrong kind, is dropped, so the default applies again.
const tuned = (k: keyof typeof TUNING_LIMITS) => {
  const n = z.number().min(TUNING_LIMITS[k].min).max(TUNING_LIMITS[k].max);
  return (k === "steps" ? n.int() : n).optional().catch(undefined);
};
const samplerName = z.string().trim().min(1).max(100).optional().catch(undefined);
const samplerSchema = z.object({ steps: tuned("steps"), cfg: tuned("cfg"), sampler: samplerName, scheduler: samplerName });
const editTuningSchema = samplerSchema.extend({ strength: tuned("strength"), shift: tuned("shift"), guidance: tuned("guidance") });

/** Only the settings that are set, so a missing one isn't stored as `undefined`. */
const setOnly = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const listOf = <T>(item: z.ZodType<T>) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) => xs.flatMap((x) => {
      const r = item.safeParse(x);
      return r.success ? [r.data] : [];
    }));

const loraList = listOf(loraSchema).transform((xs) => xs.slice(0, MAX_LORAS));
const presetIdSchema = z.string().trim().min(1).max(100);
const PART_KEYS = new Set(EDIT_MODELS.flatMap((m) => m.parts.map((p) => p.key)));
const presetNameSchema = z.string().max(100).catch("");

const drawPresetSchema = z.object({
  id: presetIdSchema,
  name: presetNameSchema,
  promptStyle: z.enum(["tags", "natural"]).catch("tags"),
  prompt: z.string().max(4000).catch(""),
  negative: z.string().max(4000).catch(""),
  checkpoint: z.string().max(500).catch(""),
  workflow: z.string().max(500_000).catch(""),
  loras: loraList,
  sampler: samplerSchema.transform(setOnly).catch({}),
  denoise: z.number().min(0.05).max(1).catch(DEFAULT_DENOISE),
});
const editPresetSchema = z.object({
  id: presetIdSchema,
  name: presetNameSchema,
  model: z.enum(EDIT_MODEL_IDS),
  checkpoint: z.string().max(500).catch(""),
  // Only the parts edit models have, each with a file name.
  files: z
    .record(z.string(), z.unknown())
    .transform((r) =>
      Object.fromEntries(
        Object.entries(r).filter((e): e is [string, string] => PART_KEYS.has(e[0]) && typeof e[1] === "string" && e[1] !== "" && e[1].length <= 500),
      ),
    )
    .catch({}),
  fast: z.boolean().catch(true),
  loras: loraList,
  tuning: editTuningSchema.transform(setOnly).catch({}),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Picture settings from before presets (one workflow, one Redraw strength, one LoRA stack per edit model)
 * as presets: the same settings in a drawing preset for each of `checkpoints` (the ones stories used,
 * most used first; one "Default" without a checkpoint when there are none), and a "Default" edit preset
 * for each edit model, whose id is the model's. Settings that already have presets are returned as they are.
 */
export function upgradeComfy(comfy: unknown, checkpoints: string[] = []): unknown {
  if (!isRecord(comfy) || Array.isArray(comfy.drawPresets)) return comfy;
  const per = (key: string, model: string) => (isRecord(comfy[key]) ? (comfy[key] as Record<string, unknown>)[model] : undefined);
  const shared = { workflow: comfy.workflow, loras: [], sampler: comfy.redraw, denoise: comfy.denoise };
  const named = checkpoints.length > 0 ? checkpoints : [""];
  return {
    ...comfy,
    drawPresets: named.map((checkpoint, i) => ({
      id: drawPresetIdFor(i),
      name: named.length === 1 ? "Default" : fileLabel(checkpoint),
      checkpoint,
      ...shared,
    })),
    editPresets: EDIT_MODEL_IDS.map((model) => ({
      ...newEditPreset(model, "Default", model),
      fast: comfy.editFast,
      loras: per("editLoras", model),
      tuning: per("editTuning", model),
    })),
    editPreset: comfy.editModel,
  };
}

/** The id `upgradeComfy` gives its i-th drawing preset. */
export const drawPresetIdFor = (i: number) => (i === 0 ? "default" : `draw-${i + 1}`);

const settingsSchema = z.object({
  connections: listOf(connectionSchema),
  favorites: listOf(favoriteSchema),
  defaults: z
    .object({ main: refSchema.nullable().catch(null), cheap: refSchema.nullable().catch(null) })
    .catch(DEFAULT_SETTINGS.defaults),
  temperature: z.number().min(0).max(2).nullable().catch(null),
  contextTokens: z.number().int().min(1000).max(2_000_000).catch(DEFAULT_SETTINGS.contextTokens),
  autoSuggestChoices: z.boolean().catch(false),
  // A part that is missing or isn't true/false is shown, as before the options existed.
  outline: z
    .object({
      summary: z.boolean().catch(true),
      readToHere: z.boolean().catch(true),
      headerPicture: z.boolean().catch(true),
      footerPicture: z.boolean().catch(true),
      illustrate: z.boolean().catch(true),
    })
    .catch(DEFAULT_OUTLINE),
  imagePromptStyle: z.enum(["tags", "natural"]).catch("tags"),
  imagePromptModel: refSchema.nullable().catch(null),
  comfy: z
    .preprocess(
      (v) => upgradeComfy(v),
      z.object({
        url: z.string().catch(""),
        width: z.number().int().min(64).max(4096).catch(DEFAULT_SETTINGS.comfy.width),
        height: z.number().int().min(64).max(4096).catch(DEFAULT_SETTINGS.comfy.height),
        coverWidth: z.number().int().min(64).max(4096).catch(DEFAULT_SETTINGS.comfy.coverWidth),
        coverHeight: z.number().int().min(64).max(4096).catch(DEFAULT_SETTINGS.comfy.coverHeight),
        count: z.number().int().min(1).max(8).catch(DEFAULT_SETTINGS.comfy.count),
        drawPresets: listOf(drawPresetSchema),
        editPresets: listOf(editPresetSchema),
        editPreset: z.string().max(100).catch(DEFAULT_SETTINGS.comfy.editPreset),
        picturesOldestFirst: z.boolean().catch(false),
        queueCount: z
          .number()
          .refine((n) => (QUEUE_COUNTS as readonly number[]).includes(n))
          .catch(1),
      }),
    )
    .catch(DEFAULT_SETTINGS.comfy),
});

/** At most MAX_PRESETS of a kind, each id once. */
function distinctPresets<P extends { id: string }>(presets: P[]): P[] {
  const seen = new Set<string>();
  return presets.filter((p) => !seen.has(p.id) && seen.add(p.id)).slice(0, MAX_PRESETS);
}

/** The presets made sound: never no drawing preset, and at least one edit preset for every edit model. */
function soundPresets(comfy: ComfySettings): ComfySettings {
  const draw = distinctPresets(comfy.drawPresets);
  const edit = distinctPresets(comfy.editPresets);
  const ids = new Set(edit.map((p) => p.id));
  for (const model of EDIT_MODEL_IDS) {
    if (edit.some((p) => p.model === model)) continue;
    let id = model as string;
    for (let n = 2; ids.has(id); n++) id = `${model}-${n}`;
    ids.add(id);
    edit.push(newEditPreset(id, "Default", model));
  }
  return { ...comfy, drawPresets: draw.length > 0 ? draw : DEFAULT_DRAW_PRESETS, editPresets: edit };
}

export function parseSettings(raw: unknown): Settings {
  const parsed = settingsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  if (!parsed.success) return DEFAULT_SETTINGS;
  const s = parsed.data;
  // "Disable thinking" used to be one switch for every model; settings from then keep it on each starred model.
  const legacyThinking = isRecord(raw) && raw.disableThinking === true;
  // Drop duplicates, and anything pointing at a connection that no longer exists.
  const seen = new Set<string>();
  const connections = s.connections.filter((c) => !seen.has(c.id) && seen.add(c.id));
  const favs = new Set<string>();
  const favorites: Favorite[] = s.favorites
    .filter((f) => seen.has(f.connectionId) && !favs.has(refKey(f)) && favs.add(refKey(f)))
    .map((f) => ({
      connectionId: f.connectionId,
      model: f.model,
      label: f.label,
      disableThinking: f.disableThinking ?? legacyThinking,
      hiddenFrom: f.hiddenFrom,
    }));
  const live = (r: ModelRef | null) => (r && seen.has(r.connectionId) ? { connectionId: r.connectionId, model: r.model } : null);
  return {
    ...s,
    connections,
    favorites,
    defaults: { main: live(s.defaults.main), cheap: live(s.defaults.cheap) },
    imagePromptModel: live(s.imagePromptModel),
    comfy: soundPresets(s.comfy),
  };
}

// ---- helpers ----

/** A string that identifies a model ref, for <select> values and lookups. */
export function refKey(r: ModelRef): string {
  return JSON.stringify([r.connectionId, r.model]);
}

export function parseRefKey(key: string): ModelRef | null {
  try {
    const [connectionId, model] = JSON.parse(key);
    return typeof connectionId === "string" && typeof model === "string" ? { connectionId, model } : null;
  } catch {
    return null;
  }
}

export const sameRef = (a: ModelRef | null | undefined, b: ModelRef | null | undefined) =>
  !!a && !!b && a.connectionId === b.connectionId && a.model === b.model;

export function findConnection(s: Settings, id: string): Connection | undefined {
  return s.connections.find((c) => c.id === id);
}

/** The ref, if its connection still exists. */
export function usableRef(s: Settings, r: ModelRef | null | undefined): ModelRef | null {
  return r && findConnection(s, r.connectionId) ? r : null;
}

/** The starred model's settings, if it is starred. */
export function favoriteFor(s: Settings, r: ModelRef): Favorite | undefined {
  return s.favorites.find((f) => sameRef(f, r));
}

/** The starred models offered for a job (all of them unless a model opted out of it). */
export function favoritesFor(s: Settings, use: ModelUse): Favorite[] {
  return s.favorites.filter((f) => !f.hiddenFrom.includes(use));
}

/** A newly starred model: offered for every job, with thinking left as the model does it. */
export const newFavorite = (r: ModelRef): Favorite => ({ connectionId: r.connectionId, model: r.model, label: "", disableThinking: false, hiddenFrom: [] });

/** The default model for a kind of job. */
export function defaultRef(s: Settings, role: "main" | "cheap"): ModelRef | null {
  return role === "cheap" ? (s.defaults.cheap ?? s.defaults.main) : s.defaults.main;
}

/** How a model is named in the interface: its nickname or id, and the connection it's on. */
export function modelLabel(s: Settings, r: ModelRef): string {
  const fav = s.favorites.find((f) => sameRef(f, r));
  const name = fav?.label.trim() || r.model;
  const conn = findConnection(s, r.connectionId);
  return conn && s.connections.length > 1 ? `${name} · ${conn.name || providerInfo(conn.kind).label}` : name;
}

/** A new connection of the given kind with its preset filled in. */
export function newConnection(s: Settings, kind: ProviderKind): Connection {
  const base = providerInfo(kind).label;
  const taken = new Set(s.connections.map((c) => c.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  // crypto.randomUUID needs a secure context, which a LAN address over http isn't.
  const id = `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, kind, baseUrl: providerInfo(kind).defaultBaseUrl, apiKey: "", freeComfy: false };
}

/** Settings without the connection, its favorites, or defaults that used it. */
export function removeConnection(s: Settings, id: string): Settings {
  const keep = (r: ModelRef | null) => (r && r.connectionId !== id ? r : null);
  return {
    ...s,
    connections: s.connections.filter((c) => c.id !== id),
    favorites: s.favorites.filter((f) => f.connectionId !== id),
    defaults: { main: keep(s.defaults.main), cheap: keep(s.defaults.cheap) },
    imagePromptModel: keep(s.imagePromptModel),
  };
}

// ---- export / import ----

export function exportSettingsJson(s: Settings): string {
  return JSON.stringify({ storytime: 2, settings: s }, null, 2);
}

export function importSettingsJson(text: string): Settings {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !("settings" in data)) {
    throw new Error("This doesn't look like a StoryTime settings file");
  }
  return parseSettings((data as { settings: unknown }).settings);
}
