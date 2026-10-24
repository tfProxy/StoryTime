import { handlePost } from "@/lib/api";
import { reviewRun, ReviewRunSchema } from "@/lib/aiRuns";

// The owner's edits to a run waiting for a check of its plans; the run goes on afterwards.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, ReviewRunSchema, (input) => reviewRun(id, input), 200);
}
