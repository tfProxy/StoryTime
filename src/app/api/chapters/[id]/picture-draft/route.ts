import { handlePost } from "@/lib/api";
import { getPictureDraft, PictureDraftSchema, savePictureDraft } from "@/lib/pictureDrafts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The Illustrate page's prompt boxes as last left for this chapter, one set per moment:
// { draft: { moment, start: {prompt, negative, scene, direction}, end: {…} } } (null when none were saved).
// `moment` is the one saved last.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ draft: getPictureDraft(id) });
}

// Replaces one moment's boxes and makes it the current one: { prompt, negative, scene, direction, moment };
// a missing field is saved empty.
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, PictureDraftSchema, (draft) => savePictureDraft(id, draft), 200);
}
