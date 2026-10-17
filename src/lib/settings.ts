"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { PROVIDERS, providerInfo, type ProviderId } from "./ai/providers";

// Everything here lives only in this browser's localStorage. Nothing is sent to the StoryTime server.

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

const KEY = "storytime.settings.v1";
const listeners = new Set<() => void>();

// useSyncExternalStore needs a referentially stable snapshot, so cache by the raw string.
let cachedRaw: string | null | undefined;
let cachedValue: Settings = DEFAULT_SETTINGS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): Settings {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedValue = raw ? parseSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
    } catch {
      cachedValue = DEFAULT_SETTINGS;
    }
  }
  return cachedValue;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns false if the browser refused to store the settings. */
export function saveSettings(next: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  listeners.forEach((l) => l());
  return true;
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SETTINGS);
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
