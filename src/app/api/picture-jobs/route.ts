import { handlePost } from "@/lib/api";
import { listPictureJobs, NewJobSchema, recordPictureJob, unseenPictureJobs } from "@/lib/pictureJobs";

export const dynamic = "force-dynamic";

const bad = (error: string) => Response.json({ error }, { status: 400 });

// The pictures made so far, newest first: ?story=<id> for a whole story (&not_chapter=<id> to leave one
// chapter out, which leaves the cover's out too, or &chapters=1 for the chapters' alone), ?chapter=<id>
// for one chapter, ?cover=<story id> for the story's cover, or ?story=<id>&entry=<entry id> for one codex
// entry's. Each job lists its pictures' marks
// (pinned, rejected or null). Page through with ?before=<next from the last page> and ?limit= (1 to 200,
// default 50). ?unseen=1 instead lists the jobs whose pictures haven't been seen yet, in every story (the latest 50).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  if (q.get("unseen") === "1") return Response.json({ jobs: unseenPictureJobs(), next: null });
  const story = q.get("story");
  const chapter = q.get("chapter");
  const cover = q.get("cover");
  if ([story, chapter, cover].filter(Boolean).length !== 1) return bad("Give one of story, chapter or cover");
  const limit = q.has("limit") ? Number(q.get("limit")) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return bad("limit must be a whole number from 1 to 200");
  const before = q.has("before") ? Number(q.get("before")) : undefined;
  if (before !== undefined && (!Number.isInteger(before) || before < 1)) return bad("before must be the next value from an earlier page");
  const notChapter = q.get("not_chapter") ?? undefined;
  const entry = q.get("entry");
  const where = story
    ? entry
      ? { codex: story, entry }
      : { story, notChapter, chaptersOnly: q.get("chapters") === "1" }
    : chapter
      ? { chapter }
      : { cover: cover! };
  return Response.json(listPictureJobs(where, { before, limit }));
}

// Records a finished job: the prompt and settings, and where ComfyUI put the pictures.
export async function POST(request: Request) {
  return handlePost(request, NewJobSchema, recordPictureJob);
}
