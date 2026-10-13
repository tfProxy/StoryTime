import { handlePost } from "@/lib/api";
import { createStory, listStories, NewStorySchema } from "@/lib/stories";

export async function GET() {
  return Response.json(listStories());
}

export async function POST(request: Request) {
  return handlePost(request, NewStorySchema, createStory);
}
