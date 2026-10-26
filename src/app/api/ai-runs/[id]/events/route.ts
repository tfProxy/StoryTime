import { getRun } from "@/lib/aiRuns";
import { getWorker } from "@/lib/worker";
import { subscribe } from "@/lib/worker/bus";
import { runChannel } from "@/lib/worker/runs";
import { sseResponse } from "@/lib/worker/sse";
import { PostError } from "@/lib/stories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events for a run: the run as saved now, then each step event and each save.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  getWorker();
  const { id } = await ctx.params;
  let run;
  try {
    run = getRun(id);
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return sseResponse(request, (send) => {
    const stop = subscribe(runChannel(id), send);
    send({ type: "run", run });
    return stop;
  });
}
