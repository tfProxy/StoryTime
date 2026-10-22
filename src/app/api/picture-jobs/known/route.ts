import { handlePost } from "@/lib/api";
import { KnownJobsSchema, knownPromptIds } from "@/lib/pictureJobs";

export const dynamic = "force-dynamic";

// Which of the given ComfyUI job ids are already in the log, and which of the given chapter ids exist:
// `{prompt_ids: [...], chapter_ids?: [...]}` gives `{known: [...], chapters: [...]}`.
export async function POST(request: Request) {
  return handlePost(request, KnownJobsSchema, knownPromptIds, 200);
}
