// Ollama's own (native) API, as opposed to the OpenAI-compatible one the app chats through. Browser code.
import type { Connection } from "../settingsSchema";

// How long freeing Ollama's memory may hold up a picture job, all calls together.
const FREE_TIMEOUT_MS = 3000;

/**
 * The root of Ollama's native API for a connection's address. The app stores Ollama's OpenAI-compatible
 * address (http://localhost:11434/v1), but /api/ps and /api/generate sit beside /v1, not under it.
 */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/**
 * Asks an Ollama server to unload the models it has loaded (GET /api/ps, then POST /api/generate with
 * `keep_alive: 0` for each), so a picture job on the same machine has the graphics memory. Never throws:
 * when Ollama is down, slow or refuses, the picture job goes ahead anyway. Says whether it unloaded anything.
 */
export async function freeOllamaMemory(baseUrl: string): Promise<boolean> {
  try {
    const root = ollamaRoot(baseUrl);
    if (!root) return false;
    const signal = AbortSignal.timeout(FREE_TIMEOUT_MS);
    const res = await fetch(`${root}/api/ps`, { signal });
    if (!res.ok) return false;
    const loaded: unknown = (await res.json())?.models;
    const names = (Array.isArray(loaded) ? loaded : [])
      .map((m) => (typeof m?.model === "string" ? m.model : m?.name))
      .filter((n): n is string => typeof n === "string" && n !== "");
    const results = await Promise.all(
      names.map(async (model) => {
        try {
          const r = await fetch(`${root}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, keep_alive: 0 }),
            signal,
          });
          return r.ok;
        } catch {
          return false;
        }
      }),
    );
    return results.some(Boolean);
  } catch {
    return false;
  }
}

/** Frees every Ollama connection that asks for it (`freeForPictures`), at the same time. */
export async function freeOllamaForPictures(connections: Connection[]): Promise<void> {
  const asking = connections.filter((c) => c.kind === "ollama" && c.freeForPictures && c.baseUrl.trim());
  await Promise.all(asking.map((c) => freeOllamaMemory(c.baseUrl)));
}
