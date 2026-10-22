import { handlePost } from "@/lib/api";
import { ChapterFixedSchema, getChapterFixed, setChapterFixed } from "@/lib/stories";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The text the chapter's picture prompts always include: { fixed }.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ fixed: getChapterFixed(id) });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, ChapterFixedSchema, (input) => setChapterFixed(id, input), 200);
}
