import { getWorker } from "@/lib/worker";
import { recoverPictures, scanComfy } from "@/lib/worker/pictures";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// For the API tests only (the test runner starts the server with STORYTIME_TEST=1): `?do=scan` runs the scan of ComfyUI
// once (whether or not it is switched on), `?do=recover` runs the restart recovery of picture jobs, and answers when
// it has finished. Not there otherwise.
export async function POST(request: Request) {
  if (process.env.STORYTIME_TEST !== "1") return Response.json({ error: "Not found" }, { status: 404 });
  getWorker();
  const what = new URL(request.url).searchParams.get("do");
  if (what === "scan") await scanComfy();
  else if (what === "recover") await recoverPictures(50);
  else return Response.json({ error: "do=scan or do=recover" }, { status: 400 });
  return Response.json({ ok: true });
}
