import { handlePost } from "@/lib/api";
import { PostError } from "@/lib/stories";
import { DecideChapterTagSchema, decideChapterTag, removeChapterTag } from "@/lib/tags";

// Approve or reject a chapter tag (optionally with a corrected value, or remembering a rejection as an example).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, DecideChapterTagSchema, (input) => decideChapterTag(id, input), 200);
}

// Delete a chapter tag.
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    removeChapterTag(id);
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return Response.json({ ok: true });
}
