import { clearChapterImage, getChapterImage, setChapterImage } from "@/lib/chapterImages";
import { isImageSlot } from "@/lib/imageSlots";
import { PostError } from "@/lib/stories";

type Ctx = { params: Promise<{ id: string; slot: string }> };

const fail = (e: unknown) => {
  if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};
const badSlot = () => Response.json({ error: "The slot must be header or footer" }, { status: 404 });

// A chapter's header or footer picture, as the bytes that were uploaded.
export async function GET(request: Request, ctx: Ctx) {
  const { id, slot } = await ctx.params;
  if (!isImageSlot(slot)) return badSlot();
  const image = getChapterImage(id, slot);
  if (!image) return Response.json({ error: "Not found" }, { status: 404 });
  const etag = `"${image.version}"`;
  const headers = { ETag: etag, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(image.bytes), { headers: { ...headers, "Content-Type": image.type } });
}

// Replace the picture. The body is the image itself (PNG, JPEG, GIF or WebP).
export async function PUT(request: Request, ctx: Ctx) {
  const { id, slot } = await ctx.params;
  if (!isImageSlot(slot)) return badSlot();
  try {
    return Response.json(setChapterImage(id, slot, Buffer.from(await request.arrayBuffer())));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id, slot } = await ctx.params;
  if (!isImageSlot(slot)) return badSlot();
  try {
    return Response.json(clearChapterImage(id, slot));
  } catch (e) {
    return fail(e);
  }
}
