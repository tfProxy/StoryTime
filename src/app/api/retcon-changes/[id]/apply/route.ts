import { handlePost } from "@/lib/api";
import { applyChange, ApplyChangeSchema } from "@/lib/retcons";

export const dynamic = "force-dynamic";

// Accept one chapter's proposed change, with the owner's edits to it: { revision } (null when nothing was left to change).
// 409 when a passage isn't in the chapter any more.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, ApplyChangeSchema, (input) => applyChange(id, input), 200);
}
