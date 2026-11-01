import { handlePost } from "@/lib/api";
import { PostError } from "@/lib/stories";
import { deleteSharedEntry, getSharedEntry, sharedEntryUsage, SharedEntryPatchSchema, updateSharedEntry } from "@/lib/sharedCodex";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const entry = getSharedEntry(id);
  if (!entry) return Response.json({ error: "That shared entry doesn't exist" }, { status: 404 });
  return Response.json({ entry, used_in: sharedEntryUsage(id) });
}

// Change the base entry: this changes it in every story that links to it.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SharedEntryPatchSchema, (patch) => updateSharedEntry(id, patch), 200);
}

// Delete a shared entry that no story links to.
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(deleteSharedEntry(id));
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
