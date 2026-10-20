import Link from "next/link";
import { notFound } from "next/navigation";
import ChapterEditor from "@/components/ChapterEditor";
import { getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// Writing a story's first chapter. The story itself (title, summary, style notes) is set on its details page.
export default async function WriteFirstChapterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) notFound();
  if (story.root_chapter_id) {
    return (
      <p>
        “{story.title}” already has its first chapter. <Link href={`/c/${story.root_chapter_id}`}>Read it</Link>.
      </p>
    );
  }

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${story.id}/details`}>← Story details</Link>
      </p>
      <h1>Write the first chapter</h1>
      <p className="meta">Of “{story.title}”. Once posted, it can be edited later from the chapter page.</p>
      <ChapterEditor
        target={{ kind: "first", storyId: story.id }}
        context={{ storyTitle: story.title, premise: story.premise, style: story.style, path: [], choiceLabel: null }}
        storyId={story.id}
        draftKey={`first:${story.id}`}
        resumeHref={`/s/${story.id}/write`}
        draftLabel={`${story.title}: first chapter`}
      />
    </>
  );
}
