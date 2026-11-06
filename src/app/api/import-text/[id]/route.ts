import { deleteDraft, getDraft } from "@/lib/draftStore";
import { importDraftKey, type ImportDraft } from "@/lib/textImport";
import { genItemKey, stopGenerate } from "@/lib/worker/generate";
import { getItem } from "@/lib/worker/items";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The import's draft, and its place in the queue (`queued` is null when it is not waiting or going). */
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const key = importDraftKey(id);
  const draft = getDraft(key) as ImportDraft | null;
  if (!draft || draft.kind !== "import") return Response.json({ error: "That import is gone" }, { status: 404 });
  const item = getItem(genItemKey(key));
  const queued = item && (item.state === "waiting" || item.state === "working") ? item.state : null;
  return Response.json({ draft, queued });
}

/** Discards the import: stops it if it is going, and deletes its draft. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const key = importDraftKey(id);
  stopGenerate(key, { discard: true });
  deleteDraft(key);
  return Response.json({ ok: true });
}
