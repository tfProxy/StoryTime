import { getWorker } from "@/lib/worker";
import { workerState } from "@/lib/worker/bus";
import { recoverPictures, scanComfy } from "@/lib/worker/pictures";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// For the API tests only (the test runner starts the server with STORYTIME_TEST=1): `?do=scan` runs the scan of ComfyUI
// once (whether or not it is switched on), `?do=recover` runs the restart recovery of picture jobs, and answers when
// it has finished; `do=record-fails` / `do=record-ok` make recording a finished job fail, or work again. Not there otherwise.
export async function POST(request: Request) {
  if (process.env.STORYTIME_TEST !== "1") return Response.json({ error: "Not found" }, { status: 404 });
  getWorker();
  const what = new URL(request.url).searchParams.get("do");
  if (what === "scan") await scanComfy();
  else if (what === "recover") await recoverPictures(50);
  // Recording a finished job fails with the message (`?message=`), until `do=record-ok`.
  else if (what === "record-fails") workerState().failRecording = new URL(request.url).searchParams.get("message") ?? "The record could not be saved";
  else if (what === "record-ok") workerState().failRecording = null;
  else return Response.json({ error: "do=scan, recover, record-fails or record-ok" }, { status: 400 });
  return Response.json({ ok: true });
}
