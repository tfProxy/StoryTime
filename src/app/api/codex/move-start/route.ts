import { handlePost } from "@/lib/api";
import { entryStartOptions, moveEntryStart, MoveStartSchema, StartConflict } from "@/lib/codexStart";
import { PostError } from "@/lib/stories";

// Where a codex entry first appears. GET ?entry_id=&chapter_id= lists the chapters of the line through that chapter,
// each with whether the entry can start there; POST moves the start (409 with `between` when moving later would
// skip facts set in between, unless `move_between` is set).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const entryId = url.searchParams.get("entry_id");
  const chapterId = url.searchParams.get("chapter_id");
  if (!entryId || !chapterId) return Response.json({ error: "entry_id and chapter_id are required" }, { status: 400 });
  try {
    return Response.json(entryStartOptions(entryId, chapterId));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function POST(request: Request) {
  return handlePost(request, MoveStartSchema, (input) => {
    try {
      return moveEntryStart(input);
    } catch (e) {
      // handlePost only sends the message; the conflict also lists what is in between.
      if (e instanceof StartConflict) throw new ConflictResponse(e);
      throw e;
    }
  }).catch((e) => {
    if (e instanceof ConflictResponse) return Response.json({ error: e.conflict.message, between: e.conflict.between }, { status: 409 });
    throw e;
  });
}

class ConflictResponse extends Error {
  constructor(public conflict: StartConflict) {
    super(conflict.message);
  }
}
