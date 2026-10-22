import { handlePost } from "@/lib/api";
import { SuggestTagsSchema, suggestTags } from "@/lib/tags";

// Store the AI's tag suggestions for a chapter revision: { added, kept }. 409 if the chapter was edited meanwhile.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SuggestTagsSchema, (input) => suggestTags(id, input.revision, input.suggestions, input.checked_tag_ids), 200);
}
