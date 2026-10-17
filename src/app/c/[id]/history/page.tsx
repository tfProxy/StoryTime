import Link from "next/link";
import { notFound } from "next/navigation";
import Prose from "@/components/Prose";
import { getChapter, getRevisions } from "@/lib/stories";

export const dynamic = "force-dynamic";

const when = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chapter = getChapter(id);
  if (!chapter) notFound();
  const revisions = getRevisions(id);

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
      </p>
      <h1>History</h1>
      <p className="meta">
        {revisions.length === 0 ? "This chapter has never been edited." : `${revisions.length + 1} versions, newest first.`}
      </p>

      <h2>
        Current version <span className="meta">(revision {chapter.revision})</span>
      </h2>
      <p className="meta">
        {chapter.edited_at
          ? `Edited ${when(chapter.edited_at)}${chapter.edit_note ? `: ${chapter.edit_note}` : ""}`
          : `Posted ${when(chapter.posted_at)}`}
      </p>

      {revisions.map((r) => (
        <details key={r.revision} className="card">
          <summary>
            <strong>Revision {r.revision}</strong> · {r.title}
            <span className="meta" style={{ display: "block", margin: 0 }}>
              {r.revision === 1
                ? `Posted ${when(r.created_at)}`
                : `Edited ${when(r.created_at)}${r.edit_note ? `: ${r.edit_note}` : ""}`}
            </span>
          </summary>
          <div style={{ marginTop: "1rem" }}>
            <h3>{r.title}</h3>
            <Prose text={r.body} />
          </div>
        </details>
      ))}
    </>
  );
}
