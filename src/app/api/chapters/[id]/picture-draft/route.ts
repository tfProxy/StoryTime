import { handlePost } from "@/lib/api";
import { getPictureDraft, PictureDraftSchema, savePictureDraft } from "@/lib/pictureDrafts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The Illustrate page's prompt boxes as last left for this chapter: { draft } (null when none were saved).
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ draft: getPictureDraft(id) });
}

// Replaces them: { prompt, negative, scene, direction, moment }; a missing field is saved empty.
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, PictureDraftSchema, (draft) => savePictureDraft(id, draft), 200);
}
