import { handlePost } from "@/lib/api";
import { listPictureJobs, NewJobSchema, recordPictureJob } from "@/lib/pictureJobs";

export const dynamic = "force-dynamic";

const bad = (error: string) => Response.json({ error }, { status: 400 });

// The pictures made so far, newest first: ?story=<id> for a whole story or ?chapter=<id> for one chapter.
// Page through with ?before=<next from the last page> and ?limit= (1 to 200, default 50).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const story = q.get("story");
  const chapter = q.get("chapter");
  if (!story === !chapter) return bad("Give either story or chapter");
  const limit = q.has("limit") ? Number(q.get("limit")) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return bad("limit must be a whole number from 1 to 200");
  const before = q.has("before") ? Number(q.get("before")) : undefined;
  if (before !== undefined && (!Number.isInteger(before) || before < 1)) return bad("before must be the next value from an earlier page");
  return Response.json(listPictureJobs(story ? { story } : { chapter: chapter! }, { before, limit }));
}

// Records a finished job: the prompt and settings, and where ComfyUI put the pictures.
export async function POST(request: Request) {
  return handlePost(request, NewJobSchema, recordPictureJob);
}
