import { handlePost } from "@/lib/api";
import { SaveSuggestionsSchema, saveSuggestions } from "@/lib/codexSuggestions";

export const dynamic = "force-dynamic";

// Save the suggestions the AI made from a chapter revision (replacing the chapter's open ones): { saved }.
// 404 for an unknown chapter, 409 when the chapter was edited meanwhile.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SaveSuggestionsSchema, (input) => saveSuggestions(id, input.revision, input.suggestions), 200);
}
