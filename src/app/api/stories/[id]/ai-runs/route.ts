import { listRuns, RUN_MODES, type RunMode } from "@/lib/aiRuns";
import { getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A story's runs, newest first, with task counts instead of tasks; ?start=<chapter id> and ?mode= narrow it.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const mode = q.get("mode");
  if (mode !== null && !(RUN_MODES as readonly string[]).includes(mode)) return Response.json({ error: "mode must be fill, tree, arc, pictures or tags" }, { status: 400 });
  return Response.json({ runs: listRuns(id, { startChapterId: q.get("start") ?? undefined, mode: (mode as RunMode | null) ?? undefined }) });
}
