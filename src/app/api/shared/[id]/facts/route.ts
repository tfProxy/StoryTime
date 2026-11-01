import { handlePost } from "@/lib/api";
import { addSharedFact, SharedFactSchema } from "@/lib/sharedCodex";

// Add a fact to a shared entry (setting an aspect it already has updates that fact).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SharedFactSchema, (fact) => addSharedFact(id, fact));
}
