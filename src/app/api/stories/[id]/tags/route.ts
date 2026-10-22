import { z } from "zod";
import { handlePost } from "@/lib/api";
import { getStory } from "@/lib/stories";
import { listTags, setStoryTag, storyTags } from "@/lib/tags";

// All live tags and the ids switched on for this story: { tags, enabled }.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ tags: listTags(), enabled: storyTags(id) });
}

const SetStoryTagSchema = z.object({ tag_id: z.string().min(1), on: z.boolean() });

// Switch a tag on or off for this story; returns the enabled ids.
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(
    request,
    SetStoryTagSchema,
    (input) => {
      setStoryTag(id, input.tag_id, input.on);
      return { enabled: storyTags(id) };
    },
    200,
  );
}
