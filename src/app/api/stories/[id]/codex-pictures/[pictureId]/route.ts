import { getCodexPictureImage, removeCodexPicture } from "@/lib/codexPictures";
import { PostError } from "@/lib/stories";

type Ctx = { params: Promise<{ id: string; pictureId: string }> };

// A codex picture's bytes. A picture never changes once saved, so it is cached.
export async function GET(request: Request, ctx: Ctx) {
  const { id, pictureId } = await ctx.params;
  const picture = getCodexPictureImage(id, pictureId);
  if (!picture) return Response.json({ error: "Not found" }, { status: 404 });
  const etag = `"${picture.version}"`;
  const headers = { ETag: etag, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(picture.bytes), { headers: { ...headers, "Content-Type": picture.type } });
}

// Removes a picture: the entry shows the one before it again.
export async function DELETE(_request: Request, ctx: Ctx) {
  const { id, pictureId } = await ctx.params;
  try {
    return Response.json(removeCodexPicture(id, pictureId));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
