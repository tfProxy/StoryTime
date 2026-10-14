import { handlePost } from "@/lib/api";
import { CodexChangesSchema, saveWithCodexChanges } from "@/lib/codexDb";
import { createChapter, NewChapterSchema } from "@/lib/stories";

export async function POST(request: Request) {
  return handlePost(request, NewChapterSchema.and(CodexChangesSchema), (input) =>
    saveWithCodexChanges(input.codex_changes, input.author_name, () => createChapter(input), (r) => r.chapter_id),
  );
}
