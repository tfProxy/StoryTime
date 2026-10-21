import { handlePost } from "@/lib/api";
import { markPictureJobsSeen, SeenJobsSchema } from "@/lib/pictureJobs";

export const dynamic = "force-dynamic";

// Marks jobs' pictures as seen: `{ids: [...]}` gives `{seen: <how many were new>}`.
export async function POST(request: Request) {
  return handlePost(request, SeenJobsSchema, markPictureJobsSeen, 200);
}
