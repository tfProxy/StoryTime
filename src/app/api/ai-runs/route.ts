import { handlePost } from "@/lib/api";
import { createRun, listFinishedRuns, listUnfinishedRuns, NewRunSchema } from "@/lib/aiRuns";

export const dynamic = "force-dynamic";

// ?unfinished=1: every story's runs still going (queued, running, in review or paused; the latest 50), each with its
// story's and start chapter's title, task counts and whether another tab holds it (`leased`), for the queue on
// opening the app. ?finished=1: finished and stopped runs, newest first, for the queue page's History; page with
// ?limit= (1 to 100, default 20) and ?before=<next from the last page>.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  if (q.get("unfinished") === "1") return Response.json({ runs: listUnfinishedRuns() });
  if (q.get("finished") === "1") {
    const limit = q.has("limit") ? Number(q.get("limit")) : 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return Response.json({ error: "limit must be a whole number from 1 to 100" }, { status: 400 });
    const before = q.has("before") ? Number(q.get("before")) : undefined;
    if (before !== undefined && (!Number.isInteger(before) || before < 1)) return Response.json({ error: "before must be the next value from an earlier page" }, { status: 400 });
    return Response.json(listFinishedRuns({ before, limit }));
  }
  return Response.json({ error: "Give unfinished=1 or finished=1" }, { status: 400 });
}

// Starts a run: its tasks, made by the planner in the browser. Returns its id.
export async function POST(request: Request) {
  return handlePost(request, NewRunSchema, createRun);
}
