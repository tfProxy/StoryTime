import { choiceDraftKey, PostError, removeChoice } from "@/lib/stories";
import { stopGenerate } from "@/lib/worker/generate";

// Remove one unwritten choice from a chapter, with its draft (and any Generate writing into that draft).
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; choiceId: string }> }) {
  const { id, choiceId } = await ctx.params;
  try {
    const removed = removeChoice(id, choiceId);
    stopGenerate(choiceDraftKey(choiceId), { discard: true });
    return Response.json(removed);
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
