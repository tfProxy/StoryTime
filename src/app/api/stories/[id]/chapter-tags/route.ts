import { getStory } from "@/lib/stories";
import { chapterTags, checkedTagIdsByChapter } from "@/lib/tags";

// The tags on a story's chapters: { chapter_tags, checked }. `?chapter=<id>` limits chapter_tags to one chapter.
// checked maps a chapter id to the tag ids it was checked for at its current revision.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const chapterId = new URL(request.url).searchParams.get("chapter") || undefined;
  return Response.json({ chapter_tags: chapterTags(id, { chapterId }), checked: Object.fromEntries(checkedTagIdsByChapter(id)) });
}
