import { handlePost } from "@/lib/api";
import { AcceptEditsSchema, acceptSuggestion } from "@/lib/codexSuggestions";

// Write a suggestion into the codex at its chapter: { entry_id }. The body may carry the owner's edits
// ({ aspect?, form?, text? }) and an anchor_chapter_id (an earlier chapter on the suggestion chapter's path to take
// effect from; 400 for any other), or be empty. 409 when it was decided already, the chapter was edited, or the fact is gone.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.text();
  const again = new Request(request.url, { method: "POST", body: body.trim() === "" ? "{}" : body });
  return handlePost(again, AcceptEditsSchema, (edits) => acceptSuggestion(id, edits), 200);
}
