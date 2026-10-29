import Link from "next/link";
import { notFound } from "next/navigation";
import ChapterEditEntry from "@/components/ChapterEditEntry";
import { getCodexFacts, getCodexOps, getContextCodex } from "@/lib/codexDb";
import { countDescendants, getChoices, getIncomingChoice, getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();
  const incoming = getIncomingChoice(id);

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
      </p>
      <h1>Edit chapter</h1>
      <p className="meta">
        Revision {chapter.revision}. Saving keeps the current version in the chapter&apos;s{" "}
        <Link href={`/c/${id}/history`}>history</Link>.
      </p>
      <ChapterEditEntry
        chapterId={id}
        baseRevision={chapter.revision}
        descendantCount={countDescendants(id)}
        initialTitle={chapter.title}
        initialBody={chapter.body}
        initialSummary={chapter.summary}
        initialPathSummary={chapter.path_summary}
        existingChoices={getChoices(id).map((c) => ({ id: c.id, label: c.label, hasChild: c.child_chapter_id !== null }))}
        incomingLabel={incoming?.label ?? null}
        // The AI sees the story up to, but not including, the chapter being edited.
        context={{
          storyTitle: story.title,
          premise: story.premise,
          style: story.style,
          path: path
            .slice(0, -1)
            .map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary })),
          choiceLabel: incoming?.label ?? null,
          // The codex as of this chapter, its own changes included: what the drawer shows and edits.
          codex: getContextCodex(id),
        }}
        storyId={story.id}
        draftLabel={`${story.title}: editing “${chapter.title}”`}
        // Codex changes made while editing are held in the draft and saved at this chapter with the edit.
        codexPanel={{
          chapterId: id,
          editing: true,
          path: path.map((c) => ({ id: c.id, title: c.title, depth: c.depth, body: c.body, summary: c.summary, path_summary: c.path_summary })),
          ops: getCodexOps(id),
          facts: getCodexFacts(id),
        }}
        story={path.length === 1 ? { id: story.id, title: story.title, premise: story.premise } : null}
      />
    </>
  );
}
