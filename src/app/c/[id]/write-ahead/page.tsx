import Link from "next/link";
import { notFound } from "next/navigation";
import { listRuns } from "@/lib/aiRuns";
import { getContextCodex } from "@/lib/codexDb";
import { getChoices, getPath, getStory } from "@/lib/stories";
import { getSubtree } from "@/lib/tree";
import WriteAhead from "@/components/WriteAhead";

export const dynamic = "force-dynamic";

// Write ahead with AI: fills this chapter's open choices (or every open choice below it) one chapter at a time.
// `?run=<id>` shows that run.
export default async function WriteAheadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { id } = await params;
  const { run } = await searchParams;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  const tree = getSubtree(id, 8);
  if (!story || !tree) notFound();
  const unfinished = listRuns(story.id, { startChapterId: id }).find((r) => (r.mode === "fill" || r.mode === "tree" || r.mode === "arc") && ["queued", "running", "review", "paused", "ready"].includes(r.status));

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
      </p>
      <h1>Write ahead with AI</h1>
      <p className="meta">
        From “{chapter.title}”. The AI writes chapters for choices nobody has written yet, one after another, and posts them marked “Written by AI, not
        reviewed”.
      </p>
      <WriteAhead
        chapter={{ id, title: chapter.title }}
        storyId={story.id}
        tree={tree}
        context={{
          storyTitle: story.title,
          premise: story.premise,
          style: story.style,
          path: path.map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary })),
          choiceLabel: null,
          codex: getContextCodex(id),
          siblingChoices: getChoices(id).map((c) => c.label),
        }}
        runId={run ?? null}
        unfinished={unfinished ? { id: unfinished.id, done: unfinished.chapters.done, total: unfinished.chapters.total, status: unfinished.status } : null}
      />
    </>
  );
}
