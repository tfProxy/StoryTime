import { z } from "zod";
import { PROVIDER_KINDS, providerInfo, type ProviderKind } from "./ai/providers";

// Types, defaults and parsing, shared by the browser and the server (which stores the settings).

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

/** A model starred in Settings; these are what the pickers on the writing page offer. */
export type Favorite = ModelRef & {
  /** Optional nickname shown instead of the model id. */
  label: string;
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
  /** Ask the model not to use extended thinking / reasoning. */
  disableThinking: boolean;
  /** After the AI writes a chapter, also suggest choices for its ending (one more call to the cheaper model). */
  autoSuggestChoices: boolean;
  /** How picture prompts are written: comma-separated tags (SDXL, Pony, SD 1.5) or plain sentences (Flux, SD3). */
  imagePromptStyle: ImagePromptStyle;
  /** Model that writes picture prompts on the Illustrate page; null uses the cheaper default. */
  imagePromptModel: ModelRef | null;
  /** The ComfyUI machine that makes pictures, and the choices last used on the Illustrate page. */
  comfy: ComfySettings;
};

export type ImagePromptStyle = "tags" | "natural";

export type ComfySettings = {
  /** Where ComfyUI is, e.g. https://comfy.example.ts.net; "" when there is none. */
  url: string;
  /** A workflow exported from ComfyUI in API format, as JSON; "" uses the built-in SDXL workflow. */
  workflow: string;
  checkpoint: string;
  width: number;
  height: number;
  /** How many pictures to make at once. */
  count: number;
  /** Image to image: how far a picture may change from the one it starts from, 0.05 (barely) to 1 (completely). */
  denoise: number;
};

export const DEFAULT_SETTINGS: Settings = {
  connections: [],
  favorites: [],
  defaults: { main: null, cheap: null },
  temperature: null,
  contextTokens: 8000,
  disableThinking: false,
  autoSuggestChoices: false,
  imagePromptStyle: "tags",
  imagePromptModel: null,
  comfy: { url: "", workflow: "", checkpoint: "", width: 1344, height: 768, count: 4, denoise: 0.55 },
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
const favoriteSchema = refSchema.extend({ label: z.string().catch("") });

const listOf = <T>(item: z.ZodType<T>) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) => xs.flatMap((x) => {
      const r = item.safeParse(x);
      return r.success ? [r.data] : [];
    }));

const settingsSchema = z.object({
  connections: listOf(connectionSchema),
  favorites: listOf(favoriteSchema),
  defaults: z
    .object({ main: refSchema.nullable().catch(null), cheap: refSchema.nullable().catch(null) })
    .catch(DEFAULT_SETTINGS.defaults),
  temperature: z.number().min(0).max(2).nullable().catch(null),
  contextTokens: z.number().int().min(1000).max(2_000_000).catch(DEFAULT_SETTINGS.contextTokens),
  disableThinking: z.boolean().catch(false),
  autoSuggestChoices: z.boolean().catch(false),
  imagePromptStyle: z.enum(["tags", "natural"]).catch("tags"),
  imagePromptModel: refSchema.nullable().catch(null),
  comfy: z
    .object({
      url: z.string().catch(""),
      workflow: z.string().max(500_000).catch(""),
      checkpoint: z.string().catch(""),
      width: z.number().int().min(64).max(4096).catch(DEFAULT_SETTINGS.comfy.width),
      height: z.number().int().min(64).max(4096).catch(DEFAULT_SETTINGS.comfy.height),
      count: z.number().int().min(1).max(8).catch(DEFAULT_SETTINGS.comfy.count),
      denoise: z.number().min(0.05).max(1).catch(DEFAULT_SETTINGS.comfy.denoise),
    })
    .catch(DEFAULT_SETTINGS.comfy),
});

export function parseSettings(raw: unknown): Settings {
  const parsed = settingsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  if (!parsed.success) return DEFAULT_SETTINGS;
  const s = parsed.data;
  // Drop duplicates, and anything pointing at a connection that no longer exists.
  const seen = new Set<string>();
  const connections = s.connections.filter((c) => !seen.has(c.id) && seen.add(c.id));
  const favs = new Set<string>();
  const favorites = s.favorites.filter((f) => seen.has(f.connectionId) && !favs.has(refKey(f)) && favs.add(refKey(f)));
  const live = (r: ModelRef | null) => (r && seen.has(r.connectionId) ? { connectionId: r.connectionId, model: r.model } : null);
  return {
    ...s,
    connections,
    favorites,
    defaults: { main: live(s.defaults.main), cheap: live(s.defaults.cheap) },
    imagePromptModel: live(s.imagePromptModel),
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
