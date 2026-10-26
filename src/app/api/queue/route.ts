import { getWorker } from "@/lib/worker";
import { listItems } from "@/lib/worker/items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The queue's items, oldest first.
export async function GET() {
  getWorker();
  return Response.json({ items: listItems() });
}
