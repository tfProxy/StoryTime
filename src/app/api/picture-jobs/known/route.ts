import { handlePost } from "@/lib/api";
import { KnownJobsSchema, knownPromptIds } from "@/lib/pictureJobs";

export const dynamic = "force-dynamic";

// Which of the given ComfyUI job ids are already in the log, and which of the given chapter and story ids
// exist: `{prompt_ids: [...], chapter_ids?: [...], story_ids?: [...]}` gives `{known, chapters, stories}`.
export async function POST(request: Request) {
  return handlePost(request, KnownJobsSchema, knownPromptIds, 200);
}
