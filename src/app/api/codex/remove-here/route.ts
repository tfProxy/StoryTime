import { handlePost } from "@/lib/api";
import { RemoveEntryAtChapterSchema, removeEntryAtChapter } from "@/lib/codexDb";

// Take a codex entry out of one chapter only, keeping it in the chapters written after it.
export async function POST(request: Request) {
  return handlePost(request, RemoveEntryAtChapterSchema, removeEntryAtChapter);
}
