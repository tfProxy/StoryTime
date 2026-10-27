import { getWorker } from "@/lib/worker";
import { QUEUE_CHANNEL, subscribe } from "@/lib/worker/bus";
import { listItems } from "@/lib/worker/items";
import { pump } from "@/lib/worker/loop";
import { scanIfDue } from "@/lib/worker/pictures";
import { sseResponse } from "@/lib/worker/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events: every item first, then each change as it happens.
export async function GET(request: Request) {
  getWorker();
  return sseResponse(request, (send) => {
    const stop = subscribe(QUEUE_CHANNEL, send);
    send({ type: "items", items: listItems() });
    // The machine's state (who has it, what waits, whether it is paused) goes out to everyone, this stream included.
    pump();
    // A page has come into view: ComfyUI is asked for this StoryTime's jobs that nothing here is watching.
    scanIfDue();
    return stop;
  });
}
