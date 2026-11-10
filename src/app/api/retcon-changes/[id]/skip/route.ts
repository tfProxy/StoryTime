import { skipChange } from "@/lib/retcons";
import { PostError } from "@/lib/stories";

export const dynamic = "force-dynamic";

// Leave a chapter as it is: the proposed change is set aside.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(skipChange(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
