import Link from "next/link";
import { notFound } from "next/navigation";
import NewChapterDesk from "@/components/NewChapterDesk";
import { getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// The writing desk for a story's first chapter, with the same draft as /s/<id>/write. Post chapter makes it, and the
// desk then shows it as a posted chapter. Nothing links here yet.
export default async function FirstChapterDeskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) notFound();
  if (story.root_chapter_id) {
    return (
      <p>
        “{story.title}” already has its first chapter. <Link href={`/c/${story.root_chapter_id}/desk`}>Open it on the desk</Link>.
      </p>
    );
  }
  return (
    <NewChapterDesk
      bar={<Link href={`/s/${story.id}/details`}>← Story details</Link>}
      editor={{
        target: { kind: "first", storyId: story.id },
        context: { storyTitle: story.title, premise: story.premise, style: story.style, path: [], choiceLabel: null },
        storyId: story.id,
        draftKey: `first:${story.id}`,
        resumeHref: `/s/${story.id}/write`,
        draftLabel: `${story.title}: first chapter`,
      }}
    />
  );
}
