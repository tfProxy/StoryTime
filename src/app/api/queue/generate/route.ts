import { getWorker } from "@/lib/worker";
import { generateRequest, startGenerate, stopGenerate } from "@/lib/worker/generate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Asks for a Generate (the body is the writing page's request): answers the item, `waiting` until its turn.
export async function POST(request: Request) {
  getWorker();
  const body = await request.json().catch(() => null);
  const parsed = generateRequest.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  return Response.json({ item: startGenerate(parsed.data) }, { status: 201 });
}

// Stops the Generate of the draft `?key=`: one going is aborted and keeps its text in the draft; one waiting is removed.
export async function DELETE(request: Request) {
  getWorker();
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return Response.json({ error: "key is required" }, { status: 400 });
  return stopGenerate(key) ? Response.json({ ok: true }) : Response.json({ error: "No such Generate" }, { status: 404 });
}
