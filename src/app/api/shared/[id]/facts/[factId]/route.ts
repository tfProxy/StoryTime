import { handlePost } from "@/lib/api";
import { PostError } from "@/lib/stories";
import { removeSharedFact, SharedFactSchema, updateSharedFact } from "@/lib/sharedCodex";

// Change a fact of a shared entry, in every story that links to it.
export async function PUT(request: Request, ctx: { params: Promise<{ id: string; factId: string }> }) {
  const { id, factId } = await ctx.params;
  return handlePost(request, SharedFactSchema, (fact) => updateSharedFact(id, factId, fact), 200);
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; factId: string }> }) {
  const { id, factId } = await ctx.params;
  try {
    return Response.json(removeSharedFact(id, factId));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
