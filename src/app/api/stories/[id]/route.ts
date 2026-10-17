import { handlePost } from "@/lib/api";
import { editStory, EditStorySchema, getStory } from "@/lib/stories";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const story = getStory(id);
  if (!story) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(story);
}

// Edit the story's title and premise.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, EditStorySchema, (input) => editStory(id, input), 200);
}
