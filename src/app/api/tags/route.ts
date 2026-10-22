import { handlePost } from "@/lib/api";
import { createTag, listTags, NewTagSchema } from "@/lib/tags";

// The shared tag library: { tags: Tag[] }.
export async function GET() {
  return Response.json({ tags: listTags() });
}

// Define a tag. Names are unique among live tags (case-insensitive).
export async function POST(request: Request) {
  return handlePost(request, NewTagSchema, createTag);
}
