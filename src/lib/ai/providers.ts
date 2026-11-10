// Connection presets. Only two wire protocols exist: "openai" (also spoken by Ollama,
// LM Studio, OpenRouter, ...) and "anthropic".
export type ProviderKind = "openai" | "ollama" | "openrouter" | "featherless" | "nanogpt" | "anthropic" | "custom";
export type Protocol = "openai" | "anthropic";

export type ProviderInfo = {
  id: ProviderKind;
  label: string;
  protocol: Protocol;
  defaultBaseUrl: string;
  needsKey: boolean;
  hint: string;
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "ollama",
    label: "Ollama",
    protocol: "openai",
    defaultBaseUrl: "http://localhost:11434/v1",
    needsKey: false,
    hint: "Ollama must allow this site's origin: set the OLLAMA_ORIGINS environment variable (for example to this site's address, or *) and restart Ollama.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    hint: "Use “Test connection” to list OpenRouter's models, then star the ones you want to use.",
  },
  {
    id: "featherless",
    label: "Featherless",
    protocol: "openai",
    defaultBaseUrl: "https://api.featherless.ai/v1",
    needsKey: true,
    hint: "Use “Test connection” to list Featherless's models (there are thousands; search for the one you want), then star the ones you want to use.",
  },
  {
    id: "nanogpt",
    label: "NanoGPT",
    protocol: "openai",
    defaultBaseUrl: "https://nano-gpt.com/api/v1",
    needsKey: true,
    hint: "Use “Test connection” to list NanoGPT's models (there are hundreds; search for the one you want), then star the ones you want to use.",
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
    hint: "Use “Test connection” to list the models your key can use, then star the ones you want.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    needsKey: true,
    hint: "Requests go straight from your browser to Anthropic using your key.",
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible)",
    protocol: "openai",
    defaultBaseUrl: "",
    needsKey: false,
    hint: "Any server that speaks the OpenAI chat API (LM Studio, llama.cpp, ...). It must allow cross-origin requests from this site.",
  },
];

export const PROVIDER_KINDS = PROVIDERS.map((p) => p.id) as [ProviderKind, ...ProviderKind[]];

/**
 * The listed model id a typed name stands for: the same id, or one that differs only in case or in spaces and
 * underscores where the id has dashes (NanoGPT's site shows "TheDrummer/Artemis v1.1" for "TheDrummer/Artemis-v1.1").
 * Null when nothing matches.
 */
export function matchModelId(name: string, ids: readonly string[]): string | null {
  const typed = name.trim();
  if (ids.includes(typed)) return typed;
  const lower = typed.toLowerCase();
  const byCase = ids.find((id) => id.toLowerCase() === lower);
  if (byCase) return byCase;
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "-");
  return ids.find((id) => norm(id) === norm(typed)) ?? null;
}

export function providerInfo(id: ProviderKind): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}
