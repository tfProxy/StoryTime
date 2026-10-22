import { codexPictureIds, codexPicturesAt, listCodexPictures, saveCodexPicture } from "@/lib/codexPictures";
import { PostError } from "@/lib/stories";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) => {
  if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

// Codex pictures. ?chapter=<chapter id> gives { pictures: { <entry id>: picture }, ids } : each entry's
// picture as of that chapter (the deepest anchor on the path to it wins, then the latest), and the ids of
// every picture in the story. Without a chapter only the whole story's pictures count. With ?entry=<entry id>
// as well, { pictures: [...], current } lists every picture the entry has had (newest first) and the one
// that is current at the chapter. A picture is { id, entry_id, anchor_chapter_id, posted_at, made }.
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const chapter = q.get("chapter") || null;
  const entry = q.get("entry");
  try {
    const at = codexPicturesAt(id, chapter);
    if (entry) return Response.json({ pictures: listCodexPictures(id, entry), current: at[entry] ?? null });
    return Response.json({ pictures: at, ids: codexPictureIds(id) });
  } catch (e) {
    return fail(e);
  }
}

// Saves a picture for an entry: the body is the image (PNG, JPEG, GIF or WebP), ?entry=<entry id>, and
// ?anchor=<chapter id> to start it at that chapter (and its descendants) or no anchor for the whole story.
// ?job=<picture job id>&index=<n> say which picture made it, so its prompts are kept with it and it is pinned.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const entry = q.get("entry");
  if (!entry) return Response.json({ error: "Give the entry" }, { status: 400 });
  const index = q.get("index");
  try {
    const saved = saveCodexPicture(id, entry, q.get("anchor") || null, Buffer.from(await request.arrayBuffer()), q.get("job"), index === null || !/^\d+$/.test(index) ? null : Number(index));
    return Response.json(saved, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
