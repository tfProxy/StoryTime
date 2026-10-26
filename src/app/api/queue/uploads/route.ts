import { MAX_UPLOAD_BYTES, saveUpload, UploadError } from "@/lib/worker/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fail = (message: string, status: number) => Response.json({ error: message }, { status });

// A picture only the browser has (a picked file, Refine's flattened picture, a painted mask), sent so a job can name it as
// `upload:<id>`. The body is the image itself, or a form with the image in its `file` field.
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES + 4096) return fail("That image is too large (20 MB at most)", 413);
  const contentType = request.headers.get("content-type") ?? "";
  try {
    let bytes: Uint8Array;
    if (contentType.startsWith("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!(file instanceof File)) return fail("The form must have the picture in its file field", 400);
      if (!file.type.startsWith("image/")) return fail("Only pictures can be sent", 415);
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      if (!contentType.startsWith("image/")) return fail("Only pictures can be sent", 415);
      bytes = new Uint8Array(await request.arrayBuffer());
    }
    return Response.json({ source: saveUpload(bytes) }, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return fail(e.message, e.status);
    throw e;
  }
}
