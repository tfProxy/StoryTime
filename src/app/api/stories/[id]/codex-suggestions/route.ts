import { handlePost } from "@/lib/api";
import { aiFactCounts, DismissOpenSchema, dismissOpenSuggestions, listSuggestions, openSuggestionCounts } from "@/lib/codexSuggestions";
import { getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// Dismiss every suggestion still waiting in the story: { dismissed }. { entry_id } keeps it to one entry's, and
// { chapter_ids } to the suggestions made from those chapters.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return handlePost(request, DismissOpenSchema, (only) => dismissOpenSuggestions(id, only), 200);
}

// The codex inbox of a story: { suggestions, counts }. ?status=open|accepted|dismissed and ?chapter=<id> narrow the list;
// `counts` is always the open ones (not stale): { total, byChapter }, plus aiByChapter: the facts the AI applied on its
// own at each chapter that are waiting for the owner's approval.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (status !== null && status !== "open" && status !== "accepted" && status !== "dismissed") {
    return Response.json({ error: "status must be open, accepted or dismissed" }, { status: 400 });
  }
  return Response.json({
    suggestions: listSuggestions(id, { ...(status && { status }), ...(params.get("chapter") && { chapterId: params.get("chapter")! }) }),
    counts: { ...openSuggestionCounts(id), aiByChapter: aiFactCounts(id) },
  });
}
