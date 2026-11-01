import { handlePost } from "@/lib/api";
import { ResetSharedFactSchema, resetSharedFact } from "@/lib/codexDb";

// Take this story's changes to a shared entry's fact back, so it reads as the shared entry has it.
export async function POST(request: Request) {
  return handlePost(request, ResetSharedFactSchema, resetSharedFact, 200);
}
