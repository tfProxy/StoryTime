import { handlePost } from "@/lib/api";
import { KnownJobsSchema, knownPromptIds } from "@/lib/pictureJobs";

export const dynamic = "force-dynamic";

// Which of the given ComfyUI job ids are already in the log: `{prompt_ids: [...]}` gives `{known: [...]}`.
export async function POST(request: Request) {
  return handlePost(request, KnownJobsSchema, knownPromptIds, 200);
}
