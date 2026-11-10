import { createRun } from "@/lib/aiRuns";
import { ApiError } from "@/lib/aiRuns/api";
import { createRetcon, listRetcons, NewRetconSchema, setRetconRun } from "@/lib/retcons";
import { PostError, getStory } from "@/lib/stories";
import { getWorker } from "@/lib/worker";
import { queueRun } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A story's retcons, newest first, with their proposed changes.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ retcons: listRetcons(id) });
}

// Starts a retcon: makes the codex change (for a codex retcon), then a review run with the "retcon" check that reads
// the chapters it chose, and puts the run in the work queue. { id, run_id (null when there is nothing to read), reads }.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  getWorker();
  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = NewRetconSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
  }
  try {
    const { id: retconId, preview } = createRetcon(id, parsed.data);
    if (preview.chapters.length === 0) return Response.json({ id: retconId, run_id: null, reads: 0 }, { status: 201 });
    const { id: runId } = createRun({ story_id: id, start_chapter_id: preview.start.id, mode: "review", options: { checks: ["retcon"], tagScope: "subtree", retconId } });
    setRetconRun(retconId, runId);
    await queueRun(runId);
    return Response.json({ id: retconId, run_id: runId, reads: preview.chapters.length }, { status: 201 });
  } catch (e) {
    if (e instanceof PostError || e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
