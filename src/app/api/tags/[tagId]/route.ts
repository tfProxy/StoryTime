import { handlePost } from "@/lib/api";
import { PostError } from "@/lib/stories";
import { removeTag, updateTag, UpdateTagSchema } from "@/lib/tags";

// Change a tag's definition (any of its fields).
export async function PATCH(request: Request, ctx: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await ctx.params;
  return handlePost(request, UpdateTagSchema, (input) => updateTag(tagId, input), 200);
}

// Remove a tag from the library; its chapter tags stay but are hidden.
export async function DELETE(_request: Request, ctx: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await ctx.params;
  try {
    removeTag(tagId);
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return Response.json({ ok: true });
}
