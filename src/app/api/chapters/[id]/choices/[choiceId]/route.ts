import { PostError, removeChoice } from "@/lib/stories";

// Remove one unwritten choice from a chapter.
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; choiceId: string }> }) {
  const { id, choiceId } = await ctx.params;
  try {
    return Response.json(removeChoice(id, choiceId));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
