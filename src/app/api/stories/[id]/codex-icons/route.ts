import { codexIcons } from "@/lib/codexIcons";

export const dynamic = "force-dynamic";

// The story's codex icons: { icons: { <entry id>: version } } for each entry that has one. The icon itself is at
// /api/stories/<id>/codex-icons/<entry id>?v=<version>.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json({ icons: codexIcons(id) });
}
