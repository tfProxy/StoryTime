import { handlePost } from "@/lib/api";
import { ApproveFactsSchema, undoAiFacts } from "@/lib/codexDb";

// The owner takes back facts the AI wrote on its own ({ ids: fact-change ids }): { undone }. Each fact reads as it did
// before, and the suggestion behind it is dismissed so the AI doesn't apply it again.
export async function POST(request: Request) {
  return handlePost(request, ApproveFactsSchema, undoAiFacts, 200);
}
