// Ollama's own (native) API, as opposed to the OpenAI-compatible one the app chats through. Used from the browser and
// the server; it needs plain `fetch`, which both have.
import { defaultRef, findConnection, sameRef, type Connection, type ModelRef, type Settings } from "../settingsSchema";

// How long freeing Ollama's memory may hold up a picture job, all calls together.
const FREE_TIMEOUT_MS = 3000;
// How long asking which models are loaded may hold up a summary or suggestions.
const LOADED_TIMEOUT_MS = 2000;

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

/** Ollama names a model without a tag "<name>:latest", in /api/ps as everywhere else. */
const tagged = (name: string) => (name.includes(":") ? name : `${name}:latest`);

/** The models an Ollama server has in memory now (GET /api/ps), or null when it can't be asked. Never throws. */
export async function loadedOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<Set<string> | null> {
  try {
    const root = ollamaRoot(baseUrl);
    if (!root) return null;
    const timeout = AbortSignal.timeout(LOADED_TIMEOUT_MS);
    const res = await fetch(`${root}/api/ps`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) return null;
    const loaded: unknown = (await res.json())?.models;
    if (!Array.isArray(loaded)) return null;
    const names = loaded.flatMap((m) => [m?.model, m?.name]).filter((n): n is string => typeof n === "string" && n !== "");
    return new Set(names.map(tagged));
  } catch {
    return null;
  }
}

/**
 * The model for a small job (a summary, suggested choices) right after `writer` wrote a chapter. When the writing model
 * is on Ollama and still loaded, and the small-job model is another one on the same Ollama server that isn't loaded,
 * the writing model does the small job too, so Ollama doesn't swap it out and back in for the next chapter. Otherwise
 * (another server, a cloud model, Ollama not answering) the small-job model, as before. `null` refs mean the defaults.
 */
export async function modelAfterWriting(
  settings: Settings,
  writer: ModelRef | null | undefined,
  small: ModelRef | null | undefined,
  signal?: AbortSignal,
): Promise<{ role: "main" | "cheap"; model: ModelRef | null }> {
  const asked = { role: "cheap" as const, model: small ?? null };
  const w = writer ?? defaultRef(settings, "main");
  const s = small ?? defaultRef(settings, "cheap");
  if (!w || !s || sameRef(w, s)) return asked;
  const wc = findConnection(settings, w.connectionId);
  const sc = findConnection(settings, s.connectionId);
  if (!wc || !sc || wc.kind !== "ollama" || sc.kind !== "ollama" || ollamaRoot(wc.baseUrl) !== ollamaRoot(sc.baseUrl)) return asked;
  const loaded = await loadedOllamaModels(wc.baseUrl, signal);
  if (!loaded || !loaded.has(tagged(w.model.trim())) || loaded.has(tagged(s.model.trim()))) return asked;
  return { role: "main", model: w };
}

/** Frees every Ollama connection that asks for it (`freeForPictures`), at the same time. */
export async function freeOllamaForPictures(connections: Connection[]): Promise<void> {
  const asking = connections.filter((c) => c.kind === "ollama" && c.freeForPictures && c.baseUrl.trim());
  await Promise.all(asking.map((c) => freeOllamaMemory(c.baseUrl)));
}
