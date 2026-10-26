import { z } from "zod";
import { handlePost } from "@/lib/api";
import { getWorker } from "@/lib/worker";
import { pump } from "@/lib/worker/loop";
import { getPaused, setPaused } from "@/lib/worker/paused";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Whether the queue is paused, for every device.
export async function GET() {
  return Response.json({ paused: getPaused() });
}

export async function PUT(request: Request) {
  getWorker();
  return handlePost(request, z.object({ paused: z.boolean() }), ({ paused }) => {
    setPaused(paused);
    pump(); // resuming starts what waited; either way the watchers are told
    return { paused };
  }, 200);
}
