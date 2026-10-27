// Settings › "Test from server": asks the StoryTime server to reach ComfyUI or an AI provider, since the server is the one
// that makes the work queue's requests (POST /api/queue/check).
import type { ProviderKind } from "./ai/providers";

export type ServerCheck = { ok: boolean; text: string };

export async function checkFromServer(
  what: { kind: "comfy"; url: string } | { kind: "ai"; provider: ProviderKind; baseUrl: string; apiKey: string },
): Promise<ServerCheck> {
  try {
    const res = await fetch("/api/queue/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(what) });
    const data = (await res.json().catch(() => null)) as (Partial<ServerCheck> & { error?: string }) | null;
    if (!res.ok) return { ok: false, text: data?.error ?? `The check failed (${res.status})` };
    return { ok: !!data?.ok, text: data?.text ?? "No answer from the server." };
  } catch (e) {
    return { ok: false, text: `Couldn't ask the StoryTime server: ${e instanceof Error ? e.message : String(e)}` };
  }
}
