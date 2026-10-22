import { handlePost } from "@/lib/api";
import { addTagExample, TagExampleSchema } from "@/lib/tags";

// Add an example (text, whether the tag applies, optional note) to a tag; returns the tag.
export async function POST(request: Request, ctx: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await ctx.params;
  return handlePost(request, TagExampleSchema, (input) => addTagExample(tagId, input));
}
