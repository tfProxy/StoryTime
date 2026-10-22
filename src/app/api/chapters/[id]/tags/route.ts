import { handlePost } from "@/lib/api";
import { AddChapterTagSchema, addChapterTag } from "@/lib/tags";

// Tag a chapter by hand (approved at once).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, AddChapterTagSchema, (input) => addChapterTag(id, input.tag_id, input.value));
}
