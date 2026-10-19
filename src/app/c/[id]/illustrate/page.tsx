import Link from "next/link";
import { notFound } from "next/navigation";
import ChapterImageEditor from "@/components/ChapterImageEditor";
import { chapterImageVersions } from "@/lib/chapterImages";
import { IMAGE_SLOTS } from "@/lib/imageSlots";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A posted chapter's pictures: one above its title and one after its text.
export default async function IllustratePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  if (!getStory(chapter.story_id)) notFound();
  const versions = chapterImageVersions([chapter.id]).get(chapter.id)!;

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
      </p>
      <h1>Illustrate chapter</h1>
      <div className="image-editors">
        {IMAGE_SLOTS.map((slot) => (
          <ChapterImageEditor key={slot} chapterId={chapter.id} slot={slot} version={versions[slot]} />
        ))}
      </div>
    </>
  );
}
