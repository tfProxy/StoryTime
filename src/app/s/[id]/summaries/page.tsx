import Link from "next/link";
import { notFound } from "next/navigation";
import BulkSummaries from "@/components/BulkSummaries";
import { getStory } from "@/lib/stories";
import { getStoryChapters } from "@/lib/tree";

export const dynamic = "force-dynamic";

export default async function SummariesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  const chapters = story ? getStoryChapters(id) : [];
  if (!story || chapters.length === 0) notFound();

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${story.id}/outline`}>← Outline of {story.title}</Link>
      </p>
      <h1>Summaries</h1>
      <p className="meta">
        The AI reads each chapter&apos;s summary instead of its full text when it continues the story. Redo them all in one
        go, for example after changing the summary style or the AI model.
      </p>
      <BulkSummaries story={{ title: story.title, premise: story.premise }} chapters={chapters} />
    </>
  );
}
