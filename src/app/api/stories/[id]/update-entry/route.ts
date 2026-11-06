import { z } from "zod";
import { createRun, reviewTasks } from "@/lib/aiRuns";
import { ApiError } from "@/lib/aiRuns/api";
import { PostError, getStory } from "@/lib/stories";
import { getWorker } from "@/lib/worker";
import { queueRun } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  /** The chapter the entry is viewed at: the chapters on the way to it are read. */
  chapter_id: z.string().min(1),
  entry_id: z.string().min(1).max(100),
});

// "Update from the story": makes a review run with the "update" check (one task for each chapter on the way to the
// chapter that names the entry since its last change, read for that entry alone) and puts it in the work queue.
// { run_id, tasks }; 409 when no chapter names the entry since its last change.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  getWorker();
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const { chapter_id, entry_id } = parsed.data;
  try {
    const tasks = reviewTasks(id, chapter_id, "path", ["update"], [], false, [entry_id]);
    const { id: runId } = createRun({
      story_id: id,
      start_chapter_id: chapter_id,
      mode: "review",
      options: { checks: ["update"], tagScope: "path", entryIds: [entry_id] },
    });
    await queueRun(runId);
    return Response.json({ run_id: runId, tasks: tasks.length });
  } catch (e) {
    if (e instanceof PostError || e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
