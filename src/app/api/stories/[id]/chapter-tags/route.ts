import { getStory } from "@/lib/stories";
import { chapterTags } from "@/lib/tags";

// The tags on a story's chapters: { chapter_tags }. `?chapter=<id>` limits it to one chapter.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const chapterId = new URL(request.url).searchParams.get("chapter") || undefined;
  return Response.json({ chapter_tags: chapterTags(id, { chapterId }) });
}
