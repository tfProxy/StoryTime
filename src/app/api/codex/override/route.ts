import { handlePost } from "@/lib/api";
import { OverrideSharedSchema, overrideSharedEntry } from "@/lib/codexDb";

// Change a linked entry's type, notes, keywords or "always include" for this story only, from a chapter on.
export async function POST(request: Request) {
  return handlePost(request, OverrideSharedSchema, overrideSharedEntry);
}
