import { clearCover, getCover, PostError, setCover } from "@/lib/stories";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) => {
  if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

// The story's cover image, as the bytes that were uploaded.
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const cover = getCover(id);
  if (!cover) return Response.json({ error: "Not found" }, { status: 404 });
  const etag = `"${cover.version}"`;
  const headers = { ETag: etag, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(cover.bytes), { headers: { ...headers, "Content-Type": cover.type } });
}

// Replace the cover. The body is the image itself (PNG, JPEG, GIF or WebP).
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    return Response.json(setCover(id, Buffer.from(await request.arrayBuffer())));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    return Response.json(clearCover(id));
  } catch (e) {
    return fail(e);
  }
}
