"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ChapterTreePicker, { type PickerChapter } from "./ChapterTreePicker";

/**
 * The line under the Section control: "Showing The Gate › The River  Change…" (or the whole story), and a way back to
 * reading the chapter. "Change…" opens the chapter picker; picking keeps the section.
 */
export default function BibleScope({
  storyId,
  tab,
  chapters,
  chosen,
  trail,
}: {
  storyId: string;
  tab: string;
  chapters: PickerChapter[];
  /** The chapter the Bible is narrowed to. */
  chosen: { id: string; title: string } | null;
  /** The titles of the chapters from the first to the chosen one. */
  trail: string[];
}) {
  const router = useRouter();
  const go = (chapterId: string | null) => {
    const q = new URLSearchParams();
    if (tab !== "overview") q.set("tab", tab);
    if (chapterId) q.set("chapter", chapterId);
    const s = q.toString();
    router.push(`/s/${storyId}/review${s ? `?${s}` : ""}`);
  };
  return (
    <div className="bible-scope">
      <div className="bible-scope-line">
        <span>
          <span className="meta">Showing</span>{" "}
          {chosen ? (
            <>
              {trail.slice(0, -1).map((t, i) => (
                <span key={i} className="meta">
                  {t} ›{" "}
                </span>
              ))}
              <strong>{trail[trail.length - 1] ?? chosen.title}</strong>
            </>
          ) : (
            <strong>the whole story</strong>
          )}
        </span>
        <ChapterTreePicker id="bible-chapter" allowWhole chapters={chapters} value={chosen?.id ?? null} onChange={go} linkLabel={chosen ? "Change…" : "Pick a chapter…"} />
      </div>
      {chosen && (
        <Link className="meta" href={`/c/${chosen.id}`}>
          ← Back to reading “{chosen.title}”
        </Link>
      )}
    </div>
  );
}
