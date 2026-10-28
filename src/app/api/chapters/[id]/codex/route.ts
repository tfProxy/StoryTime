import { foldCodex, toCodexMarkdown } from "@/lib/codex";
import { getCodexFacts, getCodexOps } from "@/lib/codexDb";
import { slug } from "@/lib/export";
import { getPath, getStory } from "@/lib/stories";

// The codex as of this chapter: live entries, plus every op on the path (for history).
// With ?format=md it is a readable download of the entries instead.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = getPath(id);
  if (path.length === 0) return Response.json({ error: "Not found" }, { status: 404 });
  const ops = getCodexOps(id);
  const facts = getCodexFacts(id);
  const format = new URL(request.url).searchParams.get("format");
  if (format === null || format === "json") return Response.json({ entries: foldCodex(ops, facts), ops, facts });
  if (format !== "md") return Response.json({ error: "format must be md or json" }, { status: 400 });

  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(toCodexMarkdown(story.title, chapter.title, foldCodex(ops, facts)), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug(story.title)}-codex-${slug(chapter.title)}.md"`,
    },
  });
}
