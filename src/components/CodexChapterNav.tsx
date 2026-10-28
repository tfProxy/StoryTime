import Link from "next/link";
import { getChapter, getChoices } from "@/lib/stories";

/** The chapters written after this one (its choices that have a chapter), for going forwards without the outline. */
export function nextChapters(chapterId: string): { id: string; title: string; label: string }[] {
  return getChoices(chapterId).flatMap((c) => {
    const child = c.child_chapter_id ? getChapter(c.child_chapter_id) : undefined;
    return child ? [{ id: child.id, title: child.title, label: c.label }] : [];
  });
}

/** "› Next: The cellar · The roof", inline after a path of chapters; nothing when no chapter follows. `hrefFor` is the same page at that chapter. */
export function NextChapters({ chapterId, hrefFor }: { chapterId: string; hrefFor: (chapterId: string) => string }) {
  const next = nextChapters(chapterId);
  if (next.length === 0) return null;
  return (
    <span className="chapter-next">
      {" › "}
      <span className="meta">Next:</span>{" "}
      {next.map((n, i) => (
        <span key={n.id}>
          {i > 0 && " · "}
          <Link href={hrefFor(n.id)} title={n.label && n.label !== n.title ? `Choice: ${n.label}` : undefined}>
            {n.title}
          </Link>
        </span>
      ))}
    </span>
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
