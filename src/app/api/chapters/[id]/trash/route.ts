import { PostError, trashBranch } from "@/lib/stories";

// Moves the chapter and everything below it to the trash. Nothing is deleted; /restore brings it back.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(trashBranch(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
