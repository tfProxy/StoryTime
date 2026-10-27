import { handlePost } from "@/lib/api";
import { SaveVerdictSchema, saveVerdict, storyVerdicts } from "@/lib/continuityVerdicts";
import { getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// The AI's verdicts on the story's continuity clashes: { verdicts }, each with its fingerprint.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ verdicts: storyVerdicts(id) });
}

// Save (or replace) the verdict on one clash.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SaveVerdictSchema, (input) => saveVerdict(id, input), 200);
}
