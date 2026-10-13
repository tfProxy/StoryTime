// Provider presets. Only two wire protocols exist: "openai" (also spoken by Ollama,
// LM Studio, OpenRouter, ...) and "anthropic".
export type ProviderId = "openai" | "ollama" | "anthropic" | "custom";
export type Protocol = "openai" | "anthropic";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  protocol: Protocol;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultSummaryModel: string;
  needsKey: boolean;
  hint: string;
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "",
    defaultSummaryModel: "",
    needsKey: true,
    hint: "Use “Test connection” to list the models your key can use, then pick one.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    protocol: "openai",
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModel: "",
    defaultSummaryModel: "",
    needsKey: false,
    hint: "Ollama must allow this site's origin: set the OLLAMA_ORIGINS environment variable (for example to this site's address, or *) and restart Ollama.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5-5",
    defaultSummaryModel: "claude-haiku-5-5",
    needsKey: true,
    hint: "Requests go straight from your browser to Anthropic using your key.",
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible)",
    protocol: "openai",
    defaultBaseUrl: "",
    defaultModel: "",
    defaultSummaryModel: "",
    needsKey: false,
    hint: "Any server that speaks the OpenAI chat API (LM Studio, OpenRouter, llama.cpp, ...). It must allow cross-origin requests from this site.",
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id)!;
}
