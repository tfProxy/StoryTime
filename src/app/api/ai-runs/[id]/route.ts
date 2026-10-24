import { handlePost } from "@/lib/api";
import { getRun, UpdateRunSchema, updateRun } from "@/lib/aiRuns";
import { PostError } from "@/lib/stories";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(getRun(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

// Saves what the tab holding the run did: its tasks, status and so on. Needs the lease token and the run's version.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, UpdateRunSchema, (input) => updateRun(id, input), 200);
}
