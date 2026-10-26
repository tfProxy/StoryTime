import { z } from "zod";
import { ApiError } from "@/lib/aiRuns/api";
import { getWorker } from "@/lib/worker";
import { changeTask } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ taskId: z.string().min(1).max(100), action: z.enum(["retry", "skip"]) });

// Retry a failed task, or skip a task, with the worker's lease. A step going on the run is waited for first.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  getWorker();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
  try {
    return Response.json(await changeTask(id, parsed.data.taskId, parsed.data.action));
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
