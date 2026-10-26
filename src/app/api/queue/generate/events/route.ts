import { getWorker } from "@/lib/worker";
import { subscribe } from "@/lib/worker/bus";
import { genChannel, generateProgress } from "@/lib/worker/generate";
import { sseResponse } from "@/lib/worker/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events for the Generate of the draft `?key=`: the text so far if it is going, then each text, and the end.
export async function GET(request: Request) {
  getWorker();
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return Response.json({ error: "key is required" }, { status: 400 });
  return sseResponse(request, (send) => {
    const stop = subscribe(genChannel(key), send);
    const now = generateProgress(key);
    if (now) send(now);
    return stop;
  });
}
