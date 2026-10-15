import { handlePost } from "@/lib/api";
import { importStory, ImportSchema } from "@/lib/import";

// Create a story from the JSON "everything" export (GET /api/stories/<id>/export?format=json).
export async function POST(request: Request) {
  return handlePost(request, ImportSchema, importStory);
}
