import { handlePost } from "@/lib/api";
import { queueAutoReview } from "@/lib/autoReview";
import { CodexChangesSchema, saveWithCodexChanges } from "@/lib/codexDb";
import { editChapter, EditChapterSchema, getChoices, getPath } from "@/lib/stories";

// Returns the chapter, its choices, and the full path from the story root.
// The browser uses the path to assemble AI context.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = getPath(id);
  if (path.length === 0) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ chapter: path[path.length - 1], path, choices: getChoices(id) });
}

// Edit a chapter. The previous version is kept as a revision.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(
    request,
    EditChapterSchema.and(CodexChangesSchema),
    (input) => {
      const saved = saveWithCodexChanges(input,() => editChapter(id, input), () => id);
      void queueAutoReview(id);
      return saved;
    },
    200,
  );
}
