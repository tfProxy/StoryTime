import { notFound } from "next/navigation";
import StoryTabs from "@/components/StoryTabs";
import { nextChapters } from "@/components/CodexChapterNav";
import CodexEntryPage from "@/components/CodexEntryPage";
import { ChangeList, CompareForm, comparisonTitle, StopComparing, type Relation } from "@/components/CodexComparison";
import { compareEntry, foldCodex, usedAspectsOf } from "@/lib/codex";
import { getStoryChapters } from "@/lib/tree";
import { entryLastAnchor, getCodexFacts, getCodexOps, nextFormChange } from "@/lib/codexDb";
import { codexPictureAt } from "@/lib/codexPictures";
import { entryStartOptions } from "@/lib/codexStart";
import EntryStartPicker from "@/components/EntryStartPicker";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A codex entry: the one place to read and change it. `?at=<chapter id>` is the chapter it is viewed and edited at (its
// text is as of that chapter, and changes take effect from it). Without one, or when the entry isn't in the codex at that
// chapter, it is the chapter where the entry was last changed.
export default async function CodexEntryRoute({ params, searchParams }: { params: Promise<{ id: string; entryId: string }>; searchParams: Promise<{ at?: string; compare?: string }> }) {
  const { id, entryId } = await params;
  const { at: atParam, compare: compareParam } = await searchParams;
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
  // Where the entry starts on this path: its last "create" (an entry removed and added again starts at the new one).
  // Chapters before it can't show it.
  const entryOps = ops.filter((o) => o.entry_id === entryId);
  const startOp = entryOps.filter((o) => o.op === "create").at(-1) ?? entryOps[0];
  const startChapter = path.find((c) => c.id === startOp.anchor_chapter_id) ?? here;
  const firstDepth = Math.min(...entryOps.map((o) => o.anchor_depth));
  const picture = codexPictureAt(story.id, entryId, at);
  const after = nextChapters(at).map(({ id: chapterId, title }) => ({ id: chapterId, title }));
  const earlier = path.filter((c) => c.depth >= firstDepth && c.id !== at).map((c) => ({ id: c.id, title: c.title }));

  // `compare=<chapter>`: what changed in the entry between that chapter and this one (earlier to later; across
  // branches, from that chapter to this one). The entry may be missing at the other chapter.
  const storyChapters = getStoryChapters(story.id);
  const chapters = storyChapters.map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id, label: c.choice_label }));
  const comparePath = compareParam && compareParam !== at ? getPath(compareParam) : [];
  const compared =
    comparePath.length > 0 && comparePath[0].story_id === story.id
      ? (() => {
          const other = comparePath[comparePath.length - 1];
          const relation: Relation = path.some((c) => c.id === other.id) ? "earlier" : comparePath.some((c) => c.id === at) ? "later" : "branch";
          const there = foldCodex(getCodexOps(other.id), getCodexFacts(other.id)).find((e) => e.entry_id === entryId) ?? null;
          const [from, to] = relation === "later" ? [entry, there] : [there, entry];
          return { other, relation, missing: there === null, changes: from && to ? compareEntry(from, to) : [] };
        })()
      : null;
  const pageHref = `/s/${story.id}/codex/${entryId}?at=${at}`;
  // "First appears in …": where the entry starts on this path and the chapters it could start at instead.
  const start = (() => {
    try {
      return entryStartOptions(entryId, at);
    } catch {
      return null;
    }
  })();

  // The chapters a form change can start at: this one, then the later ones on its branches, nearest first.
  const formChapters = [{ id: here.id, title: here.title }];
  for (let i = 0; i < formChapters.length && formChapters.length < 60; i++) {
    for (const c of storyChapters) if (c.parent_id === formChapters[i].id) formChapters.push({ id: c.id, title: c.title });
  }

  return (
    <>
      <StoryTabs storyId={story.id} title={story.title} active="bible" />
      <CodexEntryPage
        entry={entry}
        ops={ops}
        facts={facts}
        path={path.map((c) => ({ id: c.id, title: c.title, depth: c.depth, body: c.body, summary: c.summary, path_summary: c.path_summary }))}
        chapterId={at}
        storyId={story.id}
        usedAspects={usedAspectsOf(all)}
        pictureId={picture?.id ?? null}
        picturesHref={`/s/${story.id}/codex/${entryId}/pictures?at=${at}`}
        after={after}
        nav={{
          codexHref: `/s/${story.id}/review?tab=codex&chapter=${at}`,
          prev: earlier.at(-1) ?? null,
          next: after[0] ?? null,
          earlier,
          later: after.map((c) => ({ ...c, more: nextChapters(c.id).length > 0 })),
        }}
        start={{ id: startChapter.id, title: startChapter.title }}
        startPicker={start && <EntryStartPicker start={start} storyId={story.id} viewedChapterId={at} viewedDepth={here.depth} />}
        compare={{
          picker: <CompareForm id="entry-compare" chapters={chapters} keep={{ at }} value={compared?.other.id ?? null} />,
          result: compared && (
            <>
              <div className="row entry-compare-head">
                <h2>{comparisonTitle(compared.relation, compared.other.title)}</h2>
                <StopComparing href={pageHref} />
              </div>
              {compared.missing ? (
                <p className="meta">{entry.name} isn&apos;t in the codex at “{compared.other.title}”.</p>
              ) : compared.changes.length === 0 ? (
                <p className="meta">No changes: {entry.name} is the same at both.</p>
              ) : (
                <ChangeList changes={compared.changes} />
              )}
            </>
          ),
        }}
        summary={here.summary}
        laterForm={nextFormChange(entryId, at)}
        formChapters={formChapters}
      />
    </>
  );
}
