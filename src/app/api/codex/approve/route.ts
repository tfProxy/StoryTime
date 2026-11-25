import { handlePost } from "@/lib/api";
import { ApproveFactsInput, approveAiFacts } from "@/lib/codexDb";

// The owner approves facts the AI wrote on its own ({ ids: fact-change ids }): { approved }. They lose the AI mark.
// With { edit: { aspect, form, text } } (one id), the fact is reworded in place before it is approved.
export async function POST(request: Request) {
  return handlePost(request, ApproveFactsInput, approveAiFacts, 200);
}
