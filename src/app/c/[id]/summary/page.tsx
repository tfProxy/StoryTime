import Link from "next/link";
import { notFound } from "next/navigation";
import SummaryPanel from "@/components/SummaryPanel";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
      </p>
      <h1>Summary</h1>
      <p className="meta">
        The AI reads these instead of the full text when it continues the story from this chapter. They are made in
        your browser with your AI settings.
      </p>
      <SummaryPanel
        chapterId={id}
        story={{ title: story.title, premise: story.premise }}
        path={path.map((c) => ({
          id: c.id,
          revision: c.revision,
          title: c.title,
          body: c.body,
          summary: c.summary,
          path_summary: c.path_summary,
        }))}
      />
    </>
  );
}
