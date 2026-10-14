import { loadStory, slug, toJson, toMarkdown, toTwee } from "@/lib/export";
import { toHtml } from "@/lib/exportHtml";

const FORMATS = {
  html: { type: "text/html; charset=utf-8", ext: "html", render: toHtml },
  json: { type: "application/json; charset=utf-8", ext: "json", render: toJson },
  md: { type: "text/markdown; charset=utf-8", ext: "md", render: toMarkdown },
  twee: { type: "text/plain; charset=utf-8", ext: "twee", render: toTwee },
} as const;

// Download a whole story: ?format=md (readable), html (playable offline), twee (Twine) or json (everything, including the codex).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") ?? "md";
  if (!(format in FORMATS)) return Response.json({ error: "format must be md, html, twee or json" }, { status: 400 });
  const data = loadStory(id);
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  const f = FORMATS[format as keyof typeof FORMATS];
  return new Response(f.render(data), {
    headers: {
      "Content-Type": f.type,
      "Content-Disposition": `attachment; filename="${slug(data.story.title)}.${f.ext}"`,
    },
  });
}
