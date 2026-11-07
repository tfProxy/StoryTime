import { handlePost } from "@/lib/api";
import { ApproveFactsSchema, approveAiFacts } from "@/lib/codexDb";

// The owner approves facts the AI wrote on its own ({ ids: fact-change ids }): { approved }. They lose the AI mark.
export async function POST(request: Request) {
  return handlePost(request, ApproveFactsSchema, approveAiFacts, 200);
}
