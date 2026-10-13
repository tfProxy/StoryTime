// Browser-side LLM client. Requests go directly from the user's browser to the provider,
// so API keys never touch the StoryTime server.
import { providerInfo, type ProviderId } from "./providers";
import { activeProviderSettings, type Settings } from "../settings";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  system?: string;
  messages: ChatMessage[];
  /** Use the cheaper summary model instead of the main model. */
  useSummaryModel?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
};

export class AiError extends Error {}

type Resolved = {
  id: ProviderId;
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number | null;
  disableThinking: boolean;
};

function resolve(settings: Settings, useSummaryModel = false): Resolved {
  const info = providerInfo(settings.activeProvider);
  const p = activeProviderSettings(settings);
  const model = (useSummaryModel && p.summaryModel.trim()) || p.model.trim();
  if (!p.baseUrl.trim()) throw new AiError("No server URL is set for this provider. Open Settings.");
  if (info.needsKey && !p.apiKey.trim()) throw new AiError(`No API key is set for ${info.label}. Open Settings.`);
  if (!model) throw new AiError("No model is chosen. Open Settings and pick one.");
  return {
    id: info.id,
    protocol: info.protocol,
    baseUrl: p.baseUrl.trim().replace(/\/+$/, ""),
    apiKey: p.apiKey.trim(),
    model,
    temperature: settings.temperature,
    disableThinking: settings.disableThinking,
  };
}

function headers(r: Pick<Resolved, "protocol" | "apiKey">): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (r.protocol === "anthropic") {
    h["x-api-key"] = r.apiKey;
    h["anthropic-version"] = "2023-06-01";
    // Required by Anthropic for calls made straight from a browser.
    h["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (r.apiKey) {
    h["Authorization"] = `Bearer ${r.apiKey}`;
  }
  return h;
}

async function send(url: string, init: RequestInit, hint: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    // fetch only throws a bare TypeError for network failures and blocked CORS requests.
    throw new AiError(`Couldn't reach ${url}. ${hint}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        detail = j?.error?.message ?? j?.error ?? j?.message ?? text;
      } catch {
        detail = text;
      }
    } catch {
      // ignore
    }
    throw new AiError(`${res.status} ${res.statusText}${detail ? `: ${String(detail).slice(0, 300)}` : ""}`);
  }
  return res;
}

/** Yields the `data:` payloads of a server-sent-events response. */
async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new AiError("The server returned no response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
        for (const line of event.split(/\r?\n/)) {
          if (line.startsWith("data:")) yield line.slice(5).trim();
        }
      }
    }
    for (const line of buf.split(/\r?\n/)) {
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}

const CORS_HINT =
  "The server may be down, the URL may be wrong, or it may not allow requests from this site (CORS). For Ollama, set OLLAMA_ORIGINS and restart it.";

/** Streams the model's reply as text chunks. */
export async function* streamChat(settings: Settings, req: ChatRequest): AsyncGenerator<string> {
  const r = resolve(settings, req.useSummaryModel);

  if (r.protocol === "anthropic") {
    const body: Record<string, unknown> = {
      model: r.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      messages: req.messages,
    };
    if (req.system) body.system = req.system;
    if (r.disableThinking) body.thinking = { type: "disabled" };
    if (r.temperature !== null) body.temperature = r.temperature;
    const res = await send(
      `${r.baseUrl}/messages`,
      { method: "POST", headers: headers(r), body: JSON.stringify(body), signal: req.signal },
      CORS_HINT,
    );
    for await (const data of sseData(res)) {
      let evt: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt.type === "error") throw new AiError(evt.error?.message ?? "The model returned an error");
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
        yield evt.delta.text;
      }
    }
    return;
  }

  const messages = req.system ? [{ role: "system", content: req.system }, ...req.messages] : req.messages;
  const body: Record<string, unknown> = { model: r.model, stream: true, messages };
  if (r.temperature !== null) body.temperature = r.temperature;
  if (r.disableThinking) body.reasoning_effort = "none";
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  const res = await send(
    `${r.baseUrl}/chat/completions`,
    { method: "POST", headers: headers(r), body: JSON.stringify(body), signal: req.signal },
    CORS_HINT,
  );
  for await (const data of sseData(res)) {
    if (data === "[DONE]") return;
    let evt: { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } };
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    if (evt.error) throw new AiError(evt.error.message ?? "The model returned an error");
    const piece = evt.choices?.[0]?.delta?.content;
    if (piece) yield piece;
  }
}

/** Convenience: collect a whole reply, optionally reporting progress. */
export async function completeChat(
  settings: Settings,
  req: ChatRequest,
  onText?: (soFar: string) => void,
): Promise<string> {
  let out = "";
  for await (const piece of streamChat(settings, req)) {
    out += piece;
    onText?.(out);
  }
  return out;
}

/** Lists model ids from the provider; doubles as a connection test. */
export async function listModels(settings: Settings): Promise<string[]> {
  const info = providerInfo(settings.activeProvider);
  const p = activeProviderSettings(settings);
  if (!p.baseUrl.trim()) throw new AiError("Enter a server URL first");
  if (info.needsKey && !p.apiKey.trim()) throw new AiError("Enter an API key first");
  const base = p.baseUrl.trim().replace(/\/+$/, "");
  const res = await send(
    info.protocol === "anthropic" ? `${base}/models?limit=100` : `${base}/models`,
    { headers: headers({ protocol: info.protocol, apiKey: p.apiKey.trim() }) },
    CORS_HINT,
  );
  const json = (await res.json()) as { data?: { id: string }[]; models?: { name: string }[] };
  const ids = json.data?.map((m) => m.id) ?? json.models?.map((m) => m.name) ?? [];
  return ids.sort();
}
