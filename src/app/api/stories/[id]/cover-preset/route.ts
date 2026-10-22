import { handlePost } from "@/lib/api";
import { CoverPresetSchema, getCoverPreset, setCoverPreset } from "@/lib/coverPictures";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The drawing preset the story's cover pictures use: { draw_preset } (an id from Settings), or null to use the story's.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ draw_preset: getCoverPreset(id) });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, CoverPresetSchema, (input) => setCoverPreset(id, input), 200);
}
