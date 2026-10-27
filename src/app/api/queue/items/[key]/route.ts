import { z } from "zod";
import { getWorker } from "@/lib/worker";
import { stopGenerate } from "@/lib/worker/generate";
import { deleteItem, getItem } from "@/lib/worker/items";
import { dismissPicture, movePicture, stopPicture } from "@/lib/worker/pictures";
import { stopRun } from "@/lib/worker/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("stop") }), z.object({ action: z.literal("move"), how: z.enum(["up", "down", "next"]) })]);

const notFound = () => Response.json({ error: "No such item" }, { status: 404 });

// Dismiss: takes a finished, failed or paused item off the list. One that is waiting or going has to be stopped first.
export async function DELETE(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  getWorker();
  const { key } = await ctx.params;
  const item = getItem(key);
  if (!item) return notFound();
  if (item.type === "picture") return dismissPicture(key) ? Response.json({ ok: true }) : Response.json({ error: "Stop it first" }, { status: 409 });
  if (item.state === "waiting" || item.state === "working") return Response.json({ error: "Stop it first" }, { status: 409 });
  deleteItem(key);
  return Response.json({ ok: true });
}

// Stop an item (a picture job, a Generate or a run), or move a waiting picture job in the order they will go.
export async function POST(request: Request, ctx: { params: Promise<{ key: string }> }) {
  getWorker();
  const { key } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give {action: 'stop'} or {action: 'move', how: 'up' | 'down' | 'next'}" }, { status: 400 });
  const item = getItem(key);
  if (!item) return notFound();
  if (parsed.data.action === "move") {
    if (item.type !== "picture" || item.state !== "waiting") return Response.json({ error: "Only a waiting picture job can be moved" }, { status: 409 });
    return Response.json({ moved: movePicture(key, parsed.data.how) });
  }
  const stopped = item.type === "picture" ? stopPicture(key) : item.type === "generate" ? stopGenerate(item.data.draftKey) : await stopRun(item.data.runId);
  return stopped ? Response.json({ ok: true }) : Response.json({ error: "It can't be stopped now" }, { status: 409 });
}
