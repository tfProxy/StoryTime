import Link from "next/link";
import { getChapter, getChoices } from "@/lib/stories";

/** The chapters written after this one (its choices that have a chapter), for going forwards without the outline. */
export function nextChapters(chapterId: string): { id: string; title: string; label: string }[] {
  return getChoices(chapterId).flatMap((c) => {
    const child = c.child_chapter_id ? getChapter(c.child_chapter_id) : undefined;
    return child ? [{ id: child.id, title: child.title, label: c.label }] : [];
  });
}

/**
 * Where the codex is being viewed on the path through the story: the earlier chapters, then the current one in bold,
 * then the chapters written after it, stacked one above another (each with "…" when it has chapters after it too).
 * `hrefFor` is the same page at that chapter; an earlier chapter `isPlain` returns true for is shown without a link.
 * On a phone it is one vertical list instead (see `.chapter-nav` in globals.css).
 */
export function ChapterPathNav({
  path,
  currentId,
  hrefFor,
  isPlain,
  label = "Chapters on this path",
  className,
  prefix,
}: {
  path: { id: string; title: string }[];
  currentId: string;
  hrefFor: (chapterId: string) => string;
  isPlain?: (chapterId: string) => boolean;
  label?: string;
  className?: string;
  /** Text before the path, such as "Viewing at:". */
  prefix?: string;
}) {
  const current = path.find((c) => c.id === currentId);
  const earlier = path.slice(0, current ? path.indexOf(current) : path.length);
  const next = nextChapters(currentId).map((n) => ({ ...n, more: nextChapters(n.id).length > 0 }));
  return (
    <nav className={`chapter-nav timeline${className ? ` ${className}` : ""}`} aria-label={label}>
      {prefix && <span className="chapter-nav-prefix">{prefix}</span>}
      <div className="chapter-nav-row">
      {earlier.length > 0 && (
        <div className="chapter-nav-prev">
          {earlier.map((c) => (
            <span key={c.id} className="chapter-nav-item">
              {isPlain?.(c.id) ? c.title : <Link href={hrefFor(c.id)}>{c.title}</Link>}
            </span>
          ))}
        </div>
      )}
      {earlier.length > 0 && <span className="chapter-nav-sep" aria-hidden="true">›</span>}
      <strong className="chapter-nav-current">{current?.title}</strong>
      {next.length > 0 && <span className="chapter-nav-sep" aria-hidden="true">›</span>}
      {next.length > 0 && (
        <ul className="chapter-nav-next" aria-label="Chapters after this one">
          {next.map((n) => (
            <li key={n.id}>
              <Link href={hrefFor(n.id)} title={n.label && n.label !== n.title ? `Choice: ${n.label}` : undefined}>
                {n.title}
              </Link>
              {n.more && <span className="chapter-nav-more" title="More chapters follow"> …</span>}
            </li>
          ))}
        </ul>
      )}
      </div>
    </nav>
  );
}

/** A collapsed summary of the chapter, so it can be read without leaving the codex. */
export function ChapterSummary({ chapter }: { chapter: { id: string; title: string; summary: string | null } }) {
  const summary = chapter.summary?.trim();
  return (
    <details className="chapter-summary">
      <summary>Summary of “{chapter.title}”</summary>
      {summary ? (
        <p>{summary}</p>
      ) : (
        <p className="meta">
          No summary yet. <Link href={`/c/${chapter.id}`}>Open the chapter</Link>
        </p>
      )}
    </details>
  );
}
