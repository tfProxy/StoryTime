import { z } from "zod";
import { handlePost } from "@/lib/api";
import { getDraft } from "@/lib/draftStore";
import { PostError } from "@/lib/stories";
import { importDraftKey, importOptionsSchema, type ImportDraft } from "@/lib/textImport";
import { getWorker } from "@/lib/worker";
import { genItemKey } from "@/lib/worker/generate";
import { getItem } from "@/lib/worker/items";
import { patchImportDraft, startImport } from "@/lib/worker/importText";

export const dynamic = "force-dynamic";

const SplitSchema = z.object({ options: importOptionsSchema.optional() });

// "Split again": throws away the chapters found and queues the import once more, with new options if given.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const key = importDraftKey(id);
  return handlePost(
    request,
    SplitSchema,
    ({ options }) => {
      const draft = getDraft(key) as ImportDraft | null;
      if (!draft || draft.kind !== "import") throw new PostError("That import is gone", 404);
      const item = getItem(genItemKey(key));
      if (item && (item.state === "waiting" || item.state === "working")) throw new PostError("The story is being split already", 409);
      const next = patchImportDraft(key, () => ({ status: "splitting", progress: "Waiting for its turn", error: undefined, plan: null, ...(options && { options }) }))!;
      getWorker();
      startImport(next);
      return { ok: true };
    },
    200,
  );
}
