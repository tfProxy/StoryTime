import { getStory } from "@/lib/stories";
import { getStoryChapters } from "@/lib/tree";

// The story's chapters as a tree, for a chapter picker: id, title, the chapter it continues from and the choice that
// leads to it. Parents come before children. Bodies are left out; read a chapter with /api/chapters/<id>.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getStory(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(getStoryChapters(id).map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id, label: c.choice_label })));
}
