// Connection presets. Only two wire protocols exist: "openai" (also spoken by Ollama,
// LM Studio, OpenRouter, ...) and "anthropic".
export type ProviderKind = "openai" | "ollama" | "openrouter" | "anthropic" | "custom";
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

export function providerInfo(id: ProviderKind): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}
