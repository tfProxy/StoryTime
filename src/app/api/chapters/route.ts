import { handlePost } from "@/lib/api";
import { queueAutoReview } from "@/lib/autoReview";
import { CodexChangesSchema, saveWithCodexChanges } from "@/lib/codexDb";
import { createChapter, DeskPostSchema, NewChapterSchema, setOwnSummary } from "@/lib/stories";

export async function POST(request: Request) {
  return handlePost(request, NewChapterSchema.and(CodexChangesSchema).and(DeskPostSchema), (input) => {
    const posted = saveWithCodexChanges(input,() => createChapter(input), (r) => r.chapter_id);
    if (input.summary_mine && input.summary) setOwnSummary(posted.chapter_id, { mine: true });
    void queueAutoReview(posted.chapter_id, { rewriteSummary: input.rewrite_summary, summaryModel: input.summary_model });
    return posted;
  });
}
