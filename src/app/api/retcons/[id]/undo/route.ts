import { getRun } from "@/lib/aiRuns";
import { retconRunId, undoRetcon } from "@/lib/retcons";
import { PostError } from "@/lib/stories";
import { getWorker } from "@/lib/worker";
import { endRun } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Undo a retcon: its run is stopped if it is still going, then the chapters and the codex fact are put back.
// { restored, kept: [titles of chapters edited since, which keep their text] }.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  getWorker();
  const { id } = await ctx.params;
  try {
    const runId = retconRunId(id);
    if (runId) {
      let status: string | null = null;
      try {
        status = getRun(runId).status;
      } catch {
        // the run is gone
      }
      if (status && status !== "done" && status !== "stopped") await endRun(runId);
    }
    return Response.json(undoRetcon(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
