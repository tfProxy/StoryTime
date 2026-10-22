import { reviewIssues } from "@/lib/review";
import { getStory } from "@/lib/stories";

// The free (no AI) checks on a story: { issues: ReviewIssue[] }.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ issues: reviewIssues(id) });
}
