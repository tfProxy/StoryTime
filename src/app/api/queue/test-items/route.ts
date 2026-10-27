import { z } from "zod";
import { handlePost } from "@/lib/api";
import { createItem, deleteItem, ITEM_STATES, ITEM_TYPES } from "@/lib/worker/items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// For the API tests only (the test runner starts the server with STORYTIME_TEST=1): makes and removes a Generate
// item, so a test can see the events route send a change. Not there otherwise.
const off = () => (process.env.STORYTIME_TEST === "1" ? null : Response.json({ error: "Not found" }, { status: 404 }));

// With only a key it is a waiting Generate; given a type, state and data it is that item (a picture job "left over" from before a restart, say).
const body = z.object({ key: z.string().min(1), type: z.enum(ITEM_TYPES).optional(), state: z.enum(ITEM_STATES).optional(), data: z.record(z.string(), z.unknown()).optional() });

export async function POST(request: Request) {
  return (
    off() ??
    handlePost(request, body, ({ key, type, state, data }) =>
      type
        ? createItem({ key, type, state: state ?? "waiting", data: data as never })
        : createItem({ key, type: "generate", state: "waiting", data: { draftKey: key, href: "/test", label: "Test", request: {} } }),
    )
  );
}

export async function DELETE(request: Request) {
  const blocked = off();
  if (blocked) return blocked;
  const key = new URL(request.url).searchParams.get("key");
  return Response.json({ removed: key ? deleteItem(key) : false });
}
