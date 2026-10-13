import { foldCodex } from "@/lib/codex";
import { getCodexOps } from "@/lib/codexDb";
import { getPath } from "@/lib/stories";

// The codex as of this chapter: live entries, plus every op on the path (for history).
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (getPath(id).length === 0) return Response.json({ error: "Not found" }, { status: 404 });
  const ops = getCodexOps(id);
  return Response.json({ entries: foldCodex(ops), ops });
}
