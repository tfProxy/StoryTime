import { handlePost } from "@/lib/api";
import { ChapterPresetSchema, getChapterPreset, setChapterPreset } from "@/lib/stories";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The drawing preset the chapter's pictures use: { draw_preset } (an id from Settings), or null to use the story's.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ draw_preset: getChapterPreset(id) });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, ChapterPresetSchema, (input) => setChapterPreset(id, input), 200);
}
