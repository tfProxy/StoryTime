import { queueAutoReviewForChapters } from "@/lib/autoReview";
import { PostError } from "@/lib/stories";
import { createStoryFromImport } from "@/lib/textImportDb";

export const dynamic = "force-dynamic";

// "Create the story": makes the story from the import's saved plan and drops the import's draft. The codex check (and
// the other automatic checks that are on in Settings) is queued for the new chapters.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const made = createStoryFromImport(id);
    void queueAutoReviewForChapters(made.story_id, made.chapter_ids);
    return Response.json({ story_id: made.story_id, chapter_id: made.chapter_id }, { status: 201 });
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
