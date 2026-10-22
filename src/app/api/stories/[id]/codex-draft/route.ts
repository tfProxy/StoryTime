import { handlePost } from "@/lib/api";
import { CodexDraftSchema, getCodexDraft, saveCodexDraft } from "@/lib/codexPictures";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const entryOf = (request: Request) => new URL(request.url).searchParams.get("entry");

// The codex picture page's prompt boxes as last left for ?entry=<entry id>: { draft: { prompt, negative, scene, direction, refs } }
// (null when none were saved).
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const entry = entryOf(request);
  if (!entry) return Response.json({ error: "Give the entry" }, { status: 400 });
  return Response.json({ draft: getCodexDraft(id, entry) });
}

// Replaces the boxes; a missing field is saved empty.
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const entry = entryOf(request);
  if (!entry) return Response.json({ error: "Give the entry" }, { status: 400 });
  return handlePost(request, CodexDraftSchema, (draft) => saveCodexDraft(id, entry, draft), 200);
}
