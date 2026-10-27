import { z } from "zod";
import { listModels } from "@/lib/ai/client";
import { comfyVersion, listCheckpoints } from "@/lib/comfy/client";
import { PROVIDER_KINDS } from "@/lib/ai/providers";
import type { Connection } from "@/lib/settingsSchema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("comfy"), url: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("ai"), provider: z.enum(PROVIDER_KINDS), baseUrl: z.string().trim().min(1).max(500), apiKey: z.string().max(500).default("") }),
]);

const isWeb = (url: string) => /^https?:\/\//i.test(url);

// Settings › "Test from server": reaches ComfyUI or an AI provider from this server, which is where the work queue
// makes its requests, so an address that works in the browser but not from the NAS is found here. The answer is
// always 200 with `ok` and a sentence.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give {kind: 'comfy', url} or {kind: 'ai', provider, baseUrl, apiKey}" }, { status: 400 });
  const body = parsed.data;
  const address = body.kind === "comfy" ? body.url : body.baseUrl;
  if (!isWeb(address)) return Response.json({ ok: false, text: "The address must start with http:// or https://." });
  try {
    if (body.kind === "comfy") {
      const version = await comfyVersion(body.url);
      const checkpoints = await listCheckpoints(body.url);
      return Response.json({ ok: true, text: `The server reached ComfyUI ${version}. ${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"} available.` });
    }
    const connection = { kind: body.provider, baseUrl: body.baseUrl, apiKey: body.apiKey } as Connection;
    const models = await listModels(connection);
    return Response.json({ ok: true, text: `The server reached it. ${models.length} model${models.length === 1 ? "" : "s"} available.` });
  } catch (e) {
    // (The clients' messages go on about the browser's CORS settings, which don't apply to the server: only the first sentence is kept.)
    const why = (e instanceof Error ? e.message : String(e)).split(/(?<=\.)\s/)[0];
    return Response.json({ ok: false, text: `The server couldn't reach ${address}: ${why}` });
  }
}
