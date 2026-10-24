import { markRunReviewed } from "@/lib/aiRuns";
import { PostError } from "@/lib/stories";

// Marks every chapter the run wrote as reviewed.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(markRunReviewed(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
