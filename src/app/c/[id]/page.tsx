import Link from "next/link";
import { notFound } from "next/navigation";
import { getChoices, getPath, getStory } from "@/lib/stories";
import Prose from "@/components/Prose";
import EditLink from "@/components/EditLink";

export const dynamic = "force-dynamic";

export default async function ChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  const { id } = await params;
  const { posted } = await searchParams;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();
  const choices = getChoices(chapter.id);

  return (
    <>
      {posted && (
        <p className="notice">
          Chapter posted. Want the codex to catch up with what happened?{" "}
          <Link href={`/c/${chapter.id}/codex?review=1`}>Review codex for this chapter</Link>
        </p>
      )}
      <nav className="crumbs" aria-label="Path so far">
        <Link href={`/s/${story.id}`}>{story.title}</Link>
        {path.map((p, i) => (
          <span key={p.id}>
            ›{" "}
            {i === path.length - 1 ? (
              <strong>{p.title}</strong>
            ) : (
              <Link href={`/c/${p.id}`}>{p.title}</Link>
            )}
          </span>
        ))}
      </nav>

      <h1>{chapter.title}</h1>
      <p className="meta">
        {chapter.author_name ? `by ${chapter.author_name}` : "Anonymous"}
        {chapter.edited_at && (
          <>
            {" · "}
            <Link href={`/c/${chapter.id}/history`}>edited {new Date(chapter.edited_at).toISOString().slice(0, 10)}</Link>
          </>
        )}
      </p>
      <Prose text={chapter.body} />

      <section className="choices">
        <h2>{choices.length > 0 ? "What happens next?" : "The story ends here, for now."}</h2>
        {choices.map((c) =>
          c.child_chapter_id ? (
            <Link key={c.id} href={`/c/${c.child_chapter_id}`} className="card">
              {c.label}
            </Link>
          ) : (
            <Link key={c.id} href={`/c/${chapter.id}/write?choice=${c.id}`} className="card choice-unwritten">
              {c.label} <span className="tag">· not written yet. Write it?</span>
            </Link>
          ),
        )}
        <p className="row">
          <Link className="button secondary" href={`/c/${chapter.id}/write`}>
            Add a new choice and continue it
          </Link>
          <Link className="button secondary" href={`/c/${chapter.id}/codex`}>
            Codex
          </Link>
          <Link className="button secondary" href={`/c/${chapter.id}/summary`}>
            {chapter.summary && chapter.path_summary ? "Summary" : "Summary (missing)"}
          </Link>
          <EditLink chapterId={chapter.id} />
          <a className="button secondary" href={`/api/stories/${story.id}/export?format=md&to=${chapter.id}`}>
            Export this path
          </a>
        </p>
      </section>
    </>
  );
}
