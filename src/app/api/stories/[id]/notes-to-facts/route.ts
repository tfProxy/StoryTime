import { z } from "zod";
import { createRun, reviewTasks } from "@/lib/aiRuns";
import { ApiError } from "@/lib/aiRuns/api";
import { PostError, getStory } from "@/lib/stories";
import { getWorker } from "@/lib/worker";
import { queueRun } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  /** The chapter whose codex is read; the notes of its live entries are turned into facts. */
  chapter_id: z.string().min(1),
  /** Only these entries; all those with notes when absent. */
  entry_ids: z.array(z.string().min(1).max(100)).max(200).optional(),
});

// "Turn notes into facts": makes a review run with the "notes" check (one task for each entry that has notes, as of the
// chapter) and puts it in the work queue. { run_id, tasks }; with no entry to read: 200, { run_id: null, tasks: 0 }, no run.
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
  const { chapter_id, entry_ids } = parsed.data;
  try {
    const tasks = reviewTasks(id, chapter_id, "chapter", ["notes"], [], false, entry_ids);
    if (tasks.length === 0) return Response.json({ run_id: null, tasks: 0 });
    const { id: runId } = createRun({
      story_id: id,
      start_chapter_id: chapter_id,
      mode: "review",
      options: { checks: ["notes"], tagScope: "chapter", ...(entry_ids && { entryIds: entry_ids }) },
    });
    await queueRun(runId);
    return Response.json({ run_id: runId, tasks: tasks.length });
  } catch (e) {
    if (e instanceof PostError || e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
