import Link from "next/link";
import { notFound } from "next/navigation";
import SummaryPanel from "@/components/SummaryPanel";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

export default async function SummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  const { id } = await params;
  const { failed } = await searchParams;
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
      {failed && (
        <p className="notice">
          Your chapter was saved, but the AI couldn&apos;t summarize it: {failed.slice(0, 300)}. Check your AI settings and
          use Generate summary below to try again.
        </p>
      )}
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
