import { handlePost } from "@/lib/api";
import { createFactOp, NewFactOpSchema } from "@/lib/codexDb";

// Append a fact change (set / retire) about a codex entry, anchored at a chapter.
export async function POST(request: Request) {
  return handlePost(request, NewFactOpSchema, createFactOp);
}
