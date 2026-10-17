import { handlePost } from "@/lib/api";
import { addChoice, AddChoiceSchema } from "@/lib/stories";

// Add one unwritten choice to a chapter.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, AddChoiceSchema, (input) => addChoice(id, input), 201);
}
