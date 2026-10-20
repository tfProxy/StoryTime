import { handlePost } from "@/lib/api";
import { createFirstChapter, FirstChapterSchema } from "@/lib/stories";

// Posts the first chapter of a story that has none yet: { title, body, choices, summary?, path_summary? }.
// 409 when the story already has one.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, FirstChapterSchema, (input) => createFirstChapter(id, input));
}
