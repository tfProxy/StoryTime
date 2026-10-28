import Link from "next/link";
import { notFound } from "next/navigation";
import { ChapterSummary, NextChapters } from "@/components/CodexChapterNav";
import CodexPanel from "@/components/CodexPanel";
import { getCodexFacts, getCodexOps } from "@/lib/codexDb";
import { openSuggestionCounts } from "@/lib/codexSuggestions";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

export default async function CodexPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review?: string }>;
}) {
  const { id } = await params;
  const { review } = await searchParams;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();
  const counts = openSuggestionCounts(story.id).byChapter;
  const waiting = path.reduce((sum, c) => sum + (counts[c.id] ?? 0), 0);

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
      </p>
      <h1>Codex</h1>
      <p className="meta">
        Characters, places and facts the AI keeps in mind. Each branch has its own.{" "}
        <a href={`/api/chapters/${id}/codex?format=md`}>Download as Markdown</a>
      </p>
      {waiting > 0 && (
        <p className="meta">
          Codex inbox: {waiting} suggestion{waiting === 1 ? "" : "s"} waiting on this branch ·{" "}
          <Link href={`/s/${story.id}/review?tab=codex`}>Review</Link>
        </p>
      )}
      <CodexPanel
        openAiHelper={Boolean(review)}
        story={{ title: story.title, premise: story.premise }}
        storyId={story.id}
        chapterId={id}
        path={path.map((c) => ({
          id: c.id,
          title: c.title,
          depth: c.depth,
          body: c.body,
          summary: c.summary,
          path_summary: c.path_summary,
        }))}
        ops={getCodexOps(id)}
        facts={getCodexFacts(id)}
        nextLinks={<NextChapters chapterId={id} hrefFor={(child) => `/c/${child}/codex`} />}
        summary={<ChapterSummary chapter={chapter} />}
      />
    </>
  );
}
