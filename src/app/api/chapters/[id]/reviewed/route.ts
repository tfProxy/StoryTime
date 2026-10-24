import { markPathReviewed, markReviewed, PostError } from "@/lib/stories";

// Marks an AI-written chapter reviewed; with ?path=1, it and every AI chapter on the way from the story's start.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = new URL(request.url).searchParams.get("path") === "1";
  try {
    return Response.json(path ? markPathReviewed(id) : markReviewed(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
