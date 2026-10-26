import { z } from "zod";
import { handlePost } from "@/lib/api";
import { getPaused, setPaused } from "@/lib/worker/paused";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Whether the queue is paused, for every device.
export async function GET() {
  return Response.json({ paused: getPaused() });
}

export async function PUT(request: Request) {
  return handlePost(request, z.object({ paused: z.boolean() }), ({ paused }) => ({ paused: setPaused(paused) }), 200);
}
