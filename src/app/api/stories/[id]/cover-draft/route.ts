import { handlePost } from "@/lib/api";
import { CoverDraftSchema, getCoverDraft, saveCoverDraft } from "@/lib/coverPictures";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The cover page's prompt boxes as last left: { draft: { prompt, negative, scene, direction, source, path_chapter_id } }
// (null when none were saved). `source` is what the prompt is written from: premise, opening or path.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ draft: getCoverDraft(id) });
}

// Replaces the boxes; a missing field is saved empty (source: premise).
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, CoverDraftSchema, (draft) => saveCoverDraft(id, draft), 200);
}
