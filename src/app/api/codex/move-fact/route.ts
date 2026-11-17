import { handlePost } from "@/lib/api";
import { factMoveOptions, moveFact, MoveFactSchema } from "@/lib/codexFactMove";
import { PostError } from "@/lib/stories";

// Moving a fact to an earlier chapter. GET ?entry_id=&fact_op_id=&chapter_id= lists the chapters it could move back to,
// each with whether it can and why not; POST { entry_id, fact_op_id, from_chapter_id, to_chapter_id } moves it.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const entryId = url.searchParams.get("entry_id");
  const factOpId = url.searchParams.get("fact_op_id");
  const chapterId = url.searchParams.get("chapter_id");
  if (!entryId || !factOpId || !chapterId) return Response.json({ error: "entry_id, fact_op_id and chapter_id are required" }, { status: 400 });
  try {
    return Response.json(factMoveOptions(entryId, factOpId, chapterId));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function POST(request: Request) {
  return handlePost(request, MoveFactSchema, moveFact, 200);
}
