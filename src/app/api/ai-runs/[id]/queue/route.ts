import { ApiError } from "@/lib/aiRuns/api";
import { getWorker } from "@/lib/worker";
import { queueRun, stopRun } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const failure = (e: unknown) => {
  if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

// Starts or resumes a run on the server: the run is put in line, and the worker does its steps one at a time.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  getWorker();
  const { id } = await ctx.params;
  try {
    return Response.json({ item: await queueRun(id) }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

// Stops it: a step going is aborted and the run is paused; one waiting in line is paused.
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  getWorker();
  const { id } = await ctx.params;
  return (await stopRun(id)) ? Response.json({ ok: true }) : Response.json({ error: "That run is not in the queue" }, { status: 404 });
}
