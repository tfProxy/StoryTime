import { getWorker } from "@/lib/worker";
import { QUEUE_CHANNEL, subscribe } from "@/lib/worker/bus";
import { listItems } from "@/lib/worker/items";
import { sseResponse } from "@/lib/worker/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events: every item first, then each change as it happens.
export async function GET(request: Request) {
  getWorker();
  return sseResponse(request, (send) => {
    const stop = subscribe(QUEUE_CHANNEL, send);
    send({ type: "items", items: listItems() });
    return stop;
  });
}
