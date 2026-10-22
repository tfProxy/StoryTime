import { chapterLabels, storyTitles } from "@/lib/stories";

export const dynamic = "force-dynamic";

// The titles of some chapters and their stories: ?ids=<id>,<id>… (up to 100) gives
// `{labels: {<chapter id>: {title, story_title}}}`, and ?stories=<id>,… (up to 100, for cover jobs)
// `{stories: {<story id>: title}}`, leaving out ids that don't exist.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const ids = (q.get("ids") ?? "").split(",").filter(Boolean);
  const stories = (q.get("stories") ?? "").split(",").filter(Boolean);
  if (ids.length > 100 || stories.length > 100) return Response.json({ error: "At most 100 ids" }, { status: 400 });
  return Response.json({ labels: chapterLabels(ids), stories: storyTitles(stories) });
}
