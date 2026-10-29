import { PostError, restoreBranch } from "@/lib/stories";

// Brings a trashed branch back (the chapters trashed together with it). If its choice has a chapter now,
// the branch hangs from a new choice "<label> (old)".
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(restoreBranch(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
