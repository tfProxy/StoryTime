import { getRetcon } from "@/lib/retcons";
import { PostError } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A retcon as its run reads it: { id, story_id, title, instruction, undone }.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(getRetcon(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
