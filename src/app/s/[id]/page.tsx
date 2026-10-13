import Link from "next/link";
import { notFound } from "next/navigation";
import { getStory } from "@/lib/stories";
import Prose from "@/components/Prose";

export const dynamic = "force-dynamic";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story || !story.root_chapter_id) notFound();
  return (
    <>
      <h1>{story.title}</h1>
      <p className="meta">{story.author_name ? `by ${story.author_name}` : "Anonymous"}</p>
      {story.premise && <Prose text={story.premise} />}
      <Link className="button" href={`/c/${story.root_chapter_id}`}>
        Start reading
      </Link>
    </>
  );
}
