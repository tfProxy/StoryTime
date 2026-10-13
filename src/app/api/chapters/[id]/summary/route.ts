import { handlePost } from "@/lib/api";
import { fillSummaries, SetSummarySchema } from "@/lib/stories";

// Fill in a missing summary for a chapter. Existing summaries are never overwritten here.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SetSummarySchema, (input) => fillSummaries(id, input), 200);
}
