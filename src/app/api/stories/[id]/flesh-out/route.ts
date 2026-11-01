import { z } from "zod";
import { createRun, reviewTasks } from "@/lib/aiRuns";
import { ApiError } from "@/lib/aiRuns/api";
import { PostError, getStory } from "@/lib/stories";
import { getWorker } from "@/lib/worker";
import { queueRun } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  /** The chapter whose codex is read; the facts it suggests take effect from it. */
  chapter_id: z.string().min(1),
  entry_id: z.string().min(1).max(100),
  /** "invent" (default) adds new details; "close" only elaborates on what the chapters show. */
  mode: z.enum(["invent", "close"]).default("invent"),
  /** What the author wants more of. */
  hint: z.string().trim().max(200).optional(),
});

// "Flesh out": makes a review run with the "expand" check (one task for the entry, as of the chapter) and puts it in the
// work queue. { run_id, tasks }; when the entry isn't in the codex at the chapter: 200, { run_id: null, tasks: 0 }, no run.
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
  const { chapter_id, entry_id, mode, hint } = parsed.data;
  try {
    const tasks = reviewTasks(id, chapter_id, "chapter", ["expand"], [], false, [entry_id], { mode, hint });
    if (tasks.length === 0) return Response.json({ run_id: null, tasks: 0 });
    const { id: runId } = createRun({
      story_id: id,
      start_chapter_id: chapter_id,
      mode: "review",
      options: { checks: ["expand"], tagScope: "chapter", entryIds: [entry_id], expandMode: mode, ...(hint && { expandHint: hint }) },
    });
    await queueRun(runId);
    return Response.json({ run_id: runId, tasks: tasks.length });
  } catch (e) {
    if (e instanceof PostError || e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
