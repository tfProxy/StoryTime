import { handlePost } from "@/lib/api";
import { SaveFactsSchema, factsAlongPath, saveFacts } from "@/lib/facts";

export const dynamic = "force-dynamic";

// The facts of each chapter from the story's root down to this one (those read from the chapter's current text).
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = factsAlongPath(id);
  if (path.length === 0) return Response.json({ error: "That chapter does not exist" }, { status: 404 });
  return Response.json({ path });
}

// Save the facts read from a chapter (replacing the ones there). 409 when the chapter was edited meanwhile.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SaveFactsSchema, (input) => saveFacts(id, input.revision, input.facts), 200);
}
