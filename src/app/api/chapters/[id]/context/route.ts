import { getContextCodex } from "@/lib/codexDb";
import { getChoices, getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// What the browser needs to write the chapter that follows this one: its story's header, the chapters from the
// start down to it, the codex as of it, and its choices. A run reads this for each chapter it continues from.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = getPath(id);
  if (path.length === 0) return Response.json({ error: "Not found" }, { status: 404 });
  const story = getStory(path[0].story_id);
  if (!story) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    story: { id: story.id, title: story.title, premise: story.premise, style: story.style },
    path: path.map(({ id, revision, depth, title, body, summary, path_summary }) => ({ id, revision, depth, title, body, summary, path_summary })),
    codex: getContextCodex(id),
    choices: getChoices(id),
  });
}
