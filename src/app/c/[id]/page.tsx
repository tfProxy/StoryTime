import Link from "next/link";
import { notFound } from "next/navigation";
import { aiMarkOf, getChoices, getPath, getStory } from "@/lib/stories";
import AiMark from "@/components/AiMark";
import AiReviewNotice from "@/components/AiReviewNotice";
import { appliedTagNames } from "@/lib/tags";
import Prose from "@/components/Prose";
import EditLink from "@/components/EditLink";
import AddChoice from "@/components/AddChoice";
import ChapterImage from "@/components/ChapterImage";
import { PageMenu } from "@/components/SiteMenu";
import { chapterImageVersions } from "@/lib/chapterImages";

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
  const ai = aiMarkOf(chapter);
  const choices = getChoices(chapter.id);
  const images = chapterImageVersions([chapter.id]).get(chapter.id)!;
  const tagNames = appliedTagNames(story.id, chapter.id).get(chapter.id) ?? [];

  return (
    <>
      {posted && (
        <p className="notice">
          Chapter posted. Want the codex to catch up with what happened?{" "}
          <Link href={`/c/${chapter.id}/codex?review=1`}>Review codex for this chapter</Link>
        </p>
      )}
      {ai === "unreviewed" && (
        <AiReviewNotice chapterId={chapter.id} pathUnreviewed={path.slice(0, -1).filter((p) => aiMarkOf(p) === "unreviewed").length} />
      )}
      <nav className="crumbs" aria-label="Path so far">
        <Link href={`/s/${story.id}/outline`}>{story.title}</Link>
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
      {tagNames.length > 0 && <p className="meta chapter-tags">[{tagNames.join(", ")}]</p>}
      {(chapter.edited_at || ai) && (
        <p className="meta chapter-meta">
          {ai && (
            <span className="chapter-ai">
              <AiMark mark={ai} /> posted {new Date(chapter.posted_at).toISOString().slice(0, 10)}
            </span>
          )}
          {ai && chapter.edited_at && " · "}
          {chapter.edited_at && (
            <Link href={`/c/${chapter.id}/history`}>edited {new Date(chapter.edited_at).toISOString().slice(0, 10)}</Link>
          )}
        </p>
      )}
      <ChapterImage chapterId={chapter.id} slot="header" version={images.header} />
      <Prose text={chapter.body} />
      <ChapterImage chapterId={chapter.id} slot="footer" version={images.footer} />

      <section className="choices">
        <h2>{choices.length > 0 ? "What happens next?" : "The story ends here, for now."}</h2>
        {choices.map((c) =>
          c.child_chapter_id ? (
            <Link key={c.id} href={`/c/${c.child_chapter_id}`} className="card choice-written" title="Written">
              <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z M12 6v13" />
              </svg>
              {c.label}
              {c.child_ai && (
                <span className="choice-ai">
                  <AiMark mark={c.child_ai} />
                </span>
              )}
            </Link>
          ) : (
            <Link key={c.id} href={`/c/${chapter.id}/write?choice=${c.id}`} className="card choice-unwritten" title="Not written yet. Write it?">
              <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z M14.5 6.5l3 3" />
              </svg>
              {c.label}
            </Link>
          ),
        )}
        <AddChoice chapterId={chapter.id} />
        <p className="row">
          <Link className="button secondary" href={`/c/${chapter.id}/write`}>
            Draft a different idea
          </Link>
        </p>
      </section>
      <PageMenu
        codexHref={`/c/${chapter.id}/codex`}
        codexGroup={<Link href={`/c/${chapter.id}/summary`}>{chapter.summary && chapter.path_summary ? "Summary" : "Summary (missing)"}</Link>}
      >
        <EditLink chapterId={chapter.id} />
        <Link href={`/c/${chapter.id}/write-ahead`}>Write ahead with AI…</Link>
        <Link href={`/c/${chapter.id}/illustrate`}>Illustrate chapter</Link>
        <Link href={`/c/${chapter.id}/path`}>Read this path</Link>
        <details className="menu-sub">
          <summary>Export</summary>
          <a href={`/api/stories/${story.id}/export?format=md&to=${chapter.id}`}>Markdown</a>
          <a href={`/api/stories/${story.id}/export?format=html&to=${chapter.id}`}>HTML</a>
        </details>
        <Link href={`/s/${story.id}/outline#c-${chapter.id}`}>Open in outline</Link>
      </PageMenu>
    </>
  );
}
