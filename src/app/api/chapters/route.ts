import { handlePost } from "@/lib/api";
import { queueAutoReview } from "@/lib/autoReview";
import { CodexChangesSchema, saveWithCodexChanges } from "@/lib/codexDb";
import { createChapter, NewChapterSchema } from "@/lib/stories";

export async function POST(request: Request) {
  return handlePost(request, NewChapterSchema.and(CodexChangesSchema), (input) => {
    const posted = saveWithCodexChanges(input.codex_changes, () => createChapter(input), (r) => r.chapter_id);
    void queueAutoReview(posted.chapter_id);
    return posted;
  });
}
