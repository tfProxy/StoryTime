import Link from "next/link";
import { notFound } from "next/navigation";
import { getChoices, getPath, getStory } from "@/lib/stories";
import Prose from "@/components/Prose";
import { PageMenu } from "@/components/SiteMenu";

export const dynamic = "force-dynamic";

// Every chapter from the first one down to this chapter, read as one continuous piece.
export default async function PathPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();
  const hasChoices = getChoices(chapter.id).length > 0;

  return (
    <>
      <nav className="crumbs" aria-label="Back">
        <Link href={`/s/${story.id}`}>{story.title}</Link> ›{" "}
        <Link href={`/c/${chapter.id}`}>{chapter.title}</Link> › <strong>Whole path</strong>
      </nav>
      <h1>{story.title}</h1>
      {path.map((p, i) => (
        <section key={p.id} id={`c-${p.id}`}>
          <h2>
            {i + 1}. <Link href={`/c/${p.id}`}>{p.title}</Link>
          </h2>
          <Prose text={p.body} />
        </section>
      ))}
      <p className="meta">{hasChoices ? "…to be continued." : "The end."}</p>
      <p className="row">
        <Link className="button secondary" href={`/c/${chapter.id}`}>
          Back to the last chapter
        </Link>
      </p>
      <PageMenu codexHref={`/c/${chapter.id}/codex`} />
    </>
  );
}
