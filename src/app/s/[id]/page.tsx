import Link from "next/link";
import { notFound } from "next/navigation";
import { getStory } from "@/lib/stories";
import Prose from "@/components/Prose";

export const dynamic = "force-dynamic";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story || !story.root_chapter_id) notFound();
  const download = (format: string) => `/api/stories/${story.id}/export?format=${format}`;
  return (
    <>
      <h1>{story.title}</h1>
      <p className="meta">{story.author_name ? `by ${story.author_name}` : "Anonymous"}</p>
      {story.premise && <Prose text={story.premise} />}
      <p className="row">
        <Link className="button" href={`/c/${story.root_chapter_id}`}>
          Start reading
        </Link>
        <Link className="button secondary" href={`/s/${story.id}/outline`}>
          Outline
        </Link>
      </p>
      <p className="meta">
        Download: <a href={download("md")}>readable (Markdown)</a> · <a href={download("twee")}>Twine (Twee)</a> ·{" "}
        <a href={download("json")}>everything (JSON)</a>
      </p>
    </>
  );
}
