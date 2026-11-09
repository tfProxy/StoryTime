import { handlePost } from "@/lib/api";
import { ChapterWritingSchema, getChapterWriting, setChapterWriting } from "@/lib/chapterWriting";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// How the chapter was written (direction prompt, generated versions, length, models): { writing }, null if not kept.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ writing: getChapterWriting(id) });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, ChapterWritingSchema, (input) => setChapterWriting(id, input), 200);
}
