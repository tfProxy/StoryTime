import { loadStory, slug, toJson, toMarkdown, toPathMarkdown, toTwee } from "@/lib/export";
import { toHtml } from "@/lib/exportHtml";

const FORMATS = {
  html: { type: "text/html; charset=utf-8", ext: "html", render: toHtml },
  json: { type: "application/json; charset=utf-8", ext: "json", render: toJson },
  md: { type: "text/markdown; charset=utf-8", ext: "md", render: toMarkdown },
  twee: { type: "text/plain; charset=utf-8", ext: "twee", render: toTwee },
} as const;

// Download a whole story: ?format=md (readable), html (playable offline), twee (Twine) or json (everything, including the codex).
// With format=md and ?to=<chapter id> you get just the one route from the first chapter to that chapter.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "md";
  const to = params.get("to");
  if (!(format in FORMATS)) return Response.json({ error: "format must be md, html, twee or json" }, { status: 400 });
  if (to && format !== "md") return Response.json({ error: "to only works with format=md" }, { status: 400 });
  const data = loadStory(id);
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  const f = FORMATS[format as keyof typeof FORMATS];
  let body: string | null;
  let name = slug(data.story.title);
  if (to) {
    body = toPathMarkdown(data, to);
    if (body === null) return Response.json({ error: "That chapter isn't part of this story" }, { status: 404 });
    const title = data.chapters.find((c) => c.id === to)?.title ?? "path";
    name = `${name}-${slug(title)}`;
  } else {
    body = f.render(data);
  }
  return new Response(body, {
    headers: {
      "Content-Type": f.type,
      "Content-Disposition": `attachment; filename="${name}.${f.ext}"`,
    },
  });
}
