import { getChapter, getRevisions } from "@/lib/stories";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getChapter(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(getRevisions(id));
}
