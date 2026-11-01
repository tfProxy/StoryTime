import { handlePost } from "@/lib/api";
import { LinkSharedSchema, linkSharedEntry } from "@/lib/codexDb";

// Add a shared entry to a story from a chapter on.
export async function POST(request: Request) {
  return handlePost(request, LinkSharedSchema, linkSharedEntry);
}
