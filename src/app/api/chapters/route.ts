import { handlePost } from "@/lib/api";
import { createChapter, NewChapterSchema } from "@/lib/stories";

export async function POST(request: Request) {
  return handlePost(request, NewChapterSchema, createChapter);
}
