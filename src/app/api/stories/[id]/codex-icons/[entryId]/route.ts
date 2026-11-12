import { getCodexIcon, removeCodexIcon, setCodexIcon } from "@/lib/codexIcons";
import { PostError } from "@/lib/stories";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

const fail = (e: unknown) => {
  if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

// A codex entry's icon, as the bytes that were saved. The page asks for it with ?v=<version>, so it is checked again
// (it may be replaced under the same URL without one).
export async function GET(request: Request, ctx: Ctx) {
  const { id, entryId } = await ctx.params;
  const icon = getCodexIcon(id, entryId);
  if (!icon) return Response.json({ error: "Not found" }, { status: 404 });
  const etag = `"${icon.version}"`;
  const headers = { ETag: etag, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(icon.bytes), { headers: { ...headers, "Content-Type": icon.type } });
}

// Sets the entry's icon: the body is the image (PNG, JPEG, GIF or WebP), picked from the story's pictures or uploaded.
// Answers { version }.
export async function PUT(request: Request, ctx: Ctx) {
  const { id, entryId } = await ctx.params;
  try {
    return Response.json(setCodexIcon(id, entryId, Buffer.from(await request.arrayBuffer())));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id, entryId } = await ctx.params;
  try {
    return Response.json(removeCodexIcon(id, entryId));
  } catch (e) {
    return fail(e);
  }
}
