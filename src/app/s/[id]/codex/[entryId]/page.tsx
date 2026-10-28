import Link from "next/link";
import { notFound } from "next/navigation";
import { ChapterSummary, NextChapters, nextChapters } from "@/components/CodexChapterNav";
import CodexEntryEditor from "@/components/CodexEntryEditor";
import { foldCodex, usedAspectsOf } from "@/lib/codex";
import { entryLastAnchor, getCodexFacts, getCodexOps } from "@/lib/codexDb";
import { codexPictureAt } from "@/lib/codexPictures";
import { listSuggestions } from "@/lib/codexSuggestions";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A codex entry: the one place to read and change it. `?at=<chapter id>` is the chapter it is viewed and edited at (its
// text is as of that chapter, and changes take effect from it). Without one, or when the entry isn't in the codex at that
// chapter, it is the chapter where the entry was last changed.
export default async function CodexEntryPage({ params, searchParams }: { params: Promise<{ id: string; entryId: string }>; searchParams: Promise<{ at?: string }> }) {
  const { id, entryId } = await params;
  const { at: atParam } = await searchParams;
  const story = getStory(id);
  if (!story) notFound();

  const viewAt = (chapterId: string | null | undefined) => {
    if (!chapterId) return null;
    const path = getPath(chapterId);
    if (path.length === 0 || path[0].story_id !== story.id) return null;
    const ops = getCodexOps(chapterId);
    const facts = getCodexFacts(chapterId);
    const all = foldCodex(ops, facts);
    const entry = all.find((e) => e.entry_id === entryId);
    return entry ? { path, ops, facts, all, entry, at: chapterId } : null;
  };
  const view = viewAt(atParam) ?? viewAt(entryLastAnchor(story.id, entryId));
  if (!view) notFound();
  const { path, ops, facts, all, entry, at } = view;
  const here = path[path.length - 1];
  // Chapters before the entry first appears can't show it.
  const firstDepth = Math.min(...ops.filter((o) => o.entry_id === entryId).map((o) => o.anchor_depth));
  const picture = codexPictureAt(story.id, entryId, at);
  const after = nextChapters(at).map(({ id: chapterId, title }) => ({ id: chapterId, title }));
  const waiting =listSuggestions(story.id, { status: "open" }).filter((s) => s.entry_id === entryId).length;

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${at}/codex`}>← Codex at “{here.title}”</Link>
      </p>
      <p className="meta entry-path">
        Viewing at:{" "}
        {path.map((c, i) => (
          <span key={c.id}>
            {i > 0 && " › "}
            {c.id === at ? <strong>{c.title}</strong> : c.depth < firstDepth ? c.title : <Link href={`/s/${story.id}/codex/${entryId}?at=${c.id}`}>{c.title}</Link>}
          </span>
        ))}
        <NextChapters chapterId={at} hrefFor={(child) => `/s/${story.id}/codex/${entryId}?at=${child}`} />
      </p>
      <ChapterSummary chapter={here} />
      <CodexEntryEditor
        entry={entry}
        ops={ops}
        facts={facts}
        path={path.map((c) => ({ id: c.id, title: c.title, depth: c.depth, body: c.body, summary: c.summary, path_summary: c.path_summary }))}
        chapterId={at}
        storyId={story.id}
        usedAspects={usedAspectsOf(all)}
        pictureId={picture?.id ?? null}
        picturesHref={`/s/${story.id}/codex/${entryId}/pictures?at=${at}`}
        waiting={waiting}
        after={after}
      />
    </>
  );
}
