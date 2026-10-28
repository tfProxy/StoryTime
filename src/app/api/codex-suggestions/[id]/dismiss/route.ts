import { dismissSuggestion } from "@/lib/codexSuggestions";
import { PostError } from "@/lib/stories";

// Dismiss an open suggestion: { ok: true }. No body needed. 404 / 409 when it is unknown or decided already.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(dismissSuggestion(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
