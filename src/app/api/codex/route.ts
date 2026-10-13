import { handlePost } from "@/lib/api";
import { createCodexOp, NewCodexOpSchema } from "@/lib/codexDb";

// Append a codex change (create / replace / retire) anchored at a chapter.
export async function POST(request: Request) {
  return handlePost(request, NewCodexOpSchema, createCodexOp);
}
