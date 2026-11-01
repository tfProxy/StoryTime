import { handlePost } from "@/lib/api";
import { ShareEntrySchema, shareEntry } from "@/lib/codexDb";

// Turn a story's own entry into a shared one and link the story's entry to it.
export async function POST(request: Request) {
  return handlePost(request, ShareEntrySchema, shareEntry);
}
