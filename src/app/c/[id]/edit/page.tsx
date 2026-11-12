import Link from "next/link";
import { notFound } from "next/navigation";
import ChapterEditEntry from "@/components/ChapterEditEntry";
import { chapterEditProps } from "@/lib/chapterEditProps";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();

  if (chapter.trashed_at !== null) {
    return (
      <>
        <p className="crumbs">
          <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
        </p>
        <h1>Edit chapter</h1>
        <p className="notice">
          This chapter is in the trash. <Link href={`/c/${id}`}>Open it</Link> to restore it before editing.
        </p>
      </>
    );
  }

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
      <ChapterEditEntry {...chapterEditProps(story, path)} />
    </>
  );
}
