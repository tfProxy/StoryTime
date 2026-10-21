import { chapterLabels } from "@/lib/stories";

export const dynamic = "force-dynamic";

// The titles of some chapters and their stories: ?ids=<id>,<id>… (up to 100) gives
// `{labels: {<chapter id>: {title, story_title}}}`, leaving out ids that don't exist.
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length > 100) return Response.json({ error: "At most 100 ids" }, { status: 400 });
  return Response.json({ labels: chapterLabels(ids) });
}
