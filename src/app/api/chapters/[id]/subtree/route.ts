import { getSubtree } from "@/lib/tree";

export const dynamic = "force-dynamic";

// The chapter and what is written below it, ?depth=N levels down (0 to 8, default 1); depths count from the chapter.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raw = new URL(request.url).searchParams.get("depth");
  const depth = raw === null ? 1 : Number(raw);
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) return Response.json({ error: "depth must be a whole number from 0 to 8" }, { status: 400 });
  const tree = getSubtree(id, depth);
  if (!tree) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(tree);
}
