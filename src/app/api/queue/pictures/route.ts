import { getWorker } from "@/lib/worker";
import { AskError, askPicture, askRequest } from "@/lib/worker/pictures";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One more picture, as the page asks for it on Queue: `{target, spec, view}`. Quick clicks with the same settings are
// gathered into one job; the answer is the item the click went into.
export async function POST(request: Request) {
  getWorker();
  const parsed = askRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
  try {
    return Response.json({ item: askPicture(parsed.data) }, { status: 201 });
  } catch (e) {
    if (e instanceof AskError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
