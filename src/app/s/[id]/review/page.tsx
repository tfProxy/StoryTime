import Link from "next/link";
import { notFound } from "next/navigation";
import CodexAiScan from "@/components/CodexAiScan";
import { getCodexOps } from "@/lib/codexDb";
import { reviewIssues } from "@/lib/review";
import { getPath, getStory } from "@/lib/stories";
import { getStoryChapters } from "@/lib/tree";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapter?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const story = getStory(id);
  const chapters = story ? getStoryChapters(id) : [];
  if (!story || chapters.length === 0) notFound();

  const wanted = Array.isArray(sp.chapter) ? sp.chapter[0] : sp.chapter;
  const chosen = chapters.find((c) => c.id === wanted);
  const all = reviewIssues(id);
  const issues = chosen ? all.filter((i) => i.chapterId === chosen.id) : all;
  const path = chosen ? getPath(chosen.id) : [];

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${story.id}/outline`}>← Outline of {story.title}</Link>
      </p>
      <h1>Review</h1>
      <p className="meta">Things worth checking in this story. Nothing here changes the story until you act on it.</p>
      {chosen && (
        <p className="meta">
          Showing “{chosen.title}” only · <Link href={`/s/${story.id}/review`}>Show the whole story</Link>
        </p>
      )}

      <h2>Summaries</h2>
      {issues.length === 0 ? (
        <p>{chosen ? "This chapter's summary looks fine." : "Every chapter has a summary that matches its latest text."}</p>
      ) : (
        <>
          <ul>
            {issues.map((i) => (
              <li key={`${i.chapterId}-${i.kind}`}>
                <Link href={`/c/${i.chapterId}`}>{i.title}</Link>
                <br />
                {i.message} <Link href={`/c/${i.chapterId}/summary`}>Fix the summary</Link>
              </li>
            ))}
          </ul>
          {!chosen && issues.length >= 2 && (
            <p>
              <Link href={`/s/${story.id}/summaries`}>Redo all the AI summaries</Link>
            </p>
          )}
        </>
      )}

      <h2>Codex</h2>
      <p className="meta">The AI checks one chapter at a time, or that chapter and the ones leading to it.</p>
      {chosen && path.length > 0 ? (
        <CodexAiScan
          story={{ title: story.title, premise: story.premise }}
          chapterId={chosen.id}
          path={path.map((c) => ({
            id: c.id,
            title: c.title,
            depth: c.depth,
            body: c.body,
            summary: c.summary,
            path_summary: c.path_summary,
          }))}
          ops={getCodexOps(chosen.id)}
          defaultOpen
        />
      ) : (
        <form method="get">
          <label htmlFor="review-chapter">Check the codex of</label>
          <select id="review-chapter" name="chapter">
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {"· ".repeat(c.depth)}
                {c.title}
              </option>
            ))}
          </select>{" "}
          <button type="submit">Choose</button>
        </form>
      )}
    </>
  );
}
