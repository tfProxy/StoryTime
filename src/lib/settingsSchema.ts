import { z } from "zod";
import { PROVIDERS, providerInfo, type ProviderId } from "./ai/providers";

// Types, defaults and parsing, shared by the browser and the server (which stores the settings).

export type ProviderSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Cheaper model for summaries and other small jobs. Falls back to `model` when empty. */
  summaryModel: string;
};

export type Settings = {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  /** null = use the provider's default. */
  temperature: number | null;
  /** Rough budget for the prompt context, so small local models aren't overflowed. */
  contextTokens: number;
  /** Ask the model not to use extended thinking / reasoning. */
  disableThinking: boolean;
};

function defaultProvider(id: ProviderId): ProviderSettings {
  const p = providerInfo(id);
  return { baseUrl: p.defaultBaseUrl, apiKey: "", model: p.defaultModel, summaryModel: p.defaultSummaryModel };
}

export const DEFAULT_SETTINGS: Settings = {
  activeProvider: "anthropic",
  providers: Object.fromEntries(PROVIDERS.map((p) => [p.id, defaultProvider(p.id)])) as Record<
    ProviderId,
    ProviderSettings
  >,
  temperature: null,
  contextTokens: 8000,
  disableThinking: false,
};

// Each field falls back to its default when missing or invalid, so partial or older
// files still import cleanly.
const providerSchema = (id: ProviderId) => {
  const d = defaultProvider(id);
  return z
    .object({
      baseUrl: z.string().catch(d.baseUrl),
      apiKey: z.string().catch(d.apiKey),
      model: z.string().catch(d.model),
      summaryModel: z.string().catch(d.summaryModel),
    })
    .catch(d);
};

const settingsSchema = z.object({
  activeProvider: z.enum(["openai", "ollama", "anthropic", "custom"]).catch(DEFAULT_SETTINGS.activeProvider),
  providers: z
    .object({
      openai: providerSchema("openai"),
      ollama: providerSchema("ollama"),
      anthropic: providerSchema("anthropic"),
      custom: providerSchema("custom"),
    })
    .catch(DEFAULT_SETTINGS.providers),
  temperature: z.number().min(0).max(2).nullable().catch(null),
  contextTokens: z.number().int().min(1000).max(2_000_000).catch(DEFAULT_SETTINGS.contextTokens),
  disableThinking: z.boolean().catch(false),
});

export function parseSettings(raw: unknown): Settings {
  const parsed = settingsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function activeProviderSettings(s: Settings): ProviderSettings {
  return s.providers[s.activeProvider];
}

// ---- export / import ----

export function exportSettingsJson(s: Settings): string {
  return JSON.stringify({ storytime: 1, settings: s }, null, 2);
}

export function importSettingsJson(text: string): Settings {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !("settings" in data)) {
    throw new Error("This doesn't look like a StoryTime settings file");
  }
  return parseSettings((data as { settings: unknown }).settings);
}
