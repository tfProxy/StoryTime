import { applyAll } from "@/lib/retcons";
import { PostError } from "@/lib/stories";

export const dynamic = "force-dynamic";

// Accept every open change of a retcon that still applies: { applied, failed: [chapter titles] }.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(applyAll(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
