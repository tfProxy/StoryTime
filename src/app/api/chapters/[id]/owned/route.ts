import { markOwned, PostError } from "@/lib/stories";

// "Remove the AI mark" (the writing desk's ⋯ menu): the chapter is the owner's writing now.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(markOwned(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
