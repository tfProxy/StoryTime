import Link from "next/link";
import { notFound } from "next/navigation";
import IllustrateWorkspace from "@/components/IllustrateWorkspace";
import { illustrateProps } from "@/lib/illustrateProps";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A posted chapter's pictures: one above its title and one after its text, and a prompt for making them.
// On a wide screen the chapter and the prompt are one column and the pictures the other.
export default async function IllustratePage({ params }: { params: Promise<{ id: string }> }) {
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
      <h1>Illustrate “{chapter.title}”</h1>
      <IllustrateWorkspace {...illustrateProps(story, path)} />
    </>
  );
}
