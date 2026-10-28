import { reopenSuggestion } from "@/lib/codexSuggestions";
import { PostError } from "@/lib/stories";

// Put a dismissed suggestion back in the inbox: { ok: true }. No body needed. 404 / 409 unless it is dismissed.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(reopenSuggestion(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
