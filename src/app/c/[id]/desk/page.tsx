import Link from "next/link";
import { notFound } from "next/navigation";
import { nextChapters } from "@/components/CodexChapterNav";
import ChapterChoices from "@/components/ChapterChoices";
import WritingDesk from "@/components/WritingDesk";
import { chapterEditProps } from "@/lib/chapterEditProps";
import { foldCodex } from "@/lib/codex";
import { getCodexFacts, getCodexOps, getContextCodex, nextFormChange } from "@/lib/codexDb";
import { codexIcons, iconChoices } from "@/lib/codexIcons";
import { contentNotes } from "@/lib/contentNotes";
import { deskPathBlocks, newChapterCodex } from "@/lib/deskProps";
import { choiceDraftMarks } from "@/lib/draftMarks";
import { illustrateProps } from "@/lib/illustrateProps";
import { type Chapter, getChoices, getIncomingChoice, getPath, getStory, storyHasOriginal, type Story } from "@/lib/stories";
import { getStoryChapters, laterChaptersFrom } from "@/lib/tree";

export const dynamic = "force-dynamic";

// The writing desk for a posted chapter: the codex beside the chapter's box (the reading page's Edit opens it; the old
// /c/<id>/edit redirects here). Codex changes made here are saved at once, at this chapter.
// With ?choice=<choice id> (an unwritten choice of this chapter) or ?new=<choice text> (a new choice on it), the desk
// writes the chapter that follows (the old /c/<id>/write redirects here, with the same draft); Post chapter makes it.
// `?ai=1` on a new chapter starts a Generate as soon as its (empty) draft loads.
// Above the box, the earlier chapters on the path are blocks that fold; under a posted chapter's box, "What happens
// next?" lists its choices, each opening its chapter on the desk.
// `?side=illustrate` opens the side column in Illustrate mode, with the chapter's pictures in the story column.
export default async function DeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ choice?: string; new?: string; posted?: string; side?: string; ai?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();

  if (chapter.trashed_at !== null) {
    return (
      <>
        <p className="crumbs">
          <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
        </p>
        <h1>Edit chapter</h1>
        <p className="notice">
          This chapter is in the trash. <Link href={`/c/${id}`}>Open it</Link> to restore it before editing.
        </p>
      </>
    );
  }

  if (query.choice !== undefined || query.new !== undefined) return newChapter(story, path, query);

  const ops = getCodexOps(id);
  const facts = getCodexFacts(id);
  const storyChapters = getStoryChapters(story.id);
  const laterForms = Object.fromEntries(foldCodex(ops, facts).map((e) => [e.entry_id, nextFormChange(e.entry_id, id)]));
  const choices = getChoices(id);

  return (
    <WritingDesk
      key={id}
      bar={
        <>
          <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
        </>
      }
      note={query.posted ? "Posted · the summary and the codex check follow in the background" : null}
      pathBlocks={deskPathBlocks(path.slice(0, -1))}
      next={
        <ChapterChoices
          desk
          storyId={story.id}
          chapterId={id}
          choices={choices}
          incoming={getIncomingChoice(id)?.label ?? null}
          marks={choiceDraftMarks(choices)}
          notes={choices.some((c) => c.child_chapter_id) ? contentNotes(story.id) : new Map()}
          hasOriginal={storyHasOriginal(story.id)}
          showOriginal={story.show_original}
        />
      }
      nextCount={choices.length}
      mode={query.side === "illustrate" ? "illustrate" : "codex"}
      illustrate={illustrateProps(story, path)}
      editor={chapterEditProps(story, path)}
      codex={{
        storyId: story.id,
        chapterId: id,
        path: path.map((c) => ({ id: c.id, title: c.title, depth: c.depth, body: c.body, summary: c.summary, path_summary: c.path_summary })),
        ops,
        facts,
        icons: codexIcons(story.id),
        iconChoices: iconChoices(story.id, storyChapters, path.map((c) => c.id), story.cover_version),
        after: nextChapters(id).map((c) => ({ id: c.id, title: c.title })),
        laterForms,
        formChapters: laterChaptersFrom(chapter, storyChapters),
        chapters: storyChapters.map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id, label: c.choice_label })),
      }}
    />
  );
}

/** The desk for the chapter after `path`'s last, by an unwritten choice (?choice=) or a new one (?new=). */
function newChapter(story: Story, path: Chapter[], query: { choice?: string; new?: string; ai?: string }) {
  const parent = path[path.length - 1];
  const choices = getChoices(parent.id);
  let target: { kind: "fill"; choiceId: string; label: string; parentChapterId: string } | { kind: "new"; parentChapterId: string; label: string };
  if (query.choice !== undefined) {
    const slot = choices.find((c) => c.id === query.choice);
    if (!slot) notFound();
    if (slot.child_chapter_id) {
      return (
        <p>
          That chapter is already written. <Link href={`/c/${slot.child_chapter_id}/desk`}>Open it on the desk</Link>.
        </p>
      );
    }
    target = { kind: "fill", choiceId: slot.id, label: slot.label, parentChapterId: parent.id };
  } else {
    // An empty ?new= ("Draft a different idea" on the desk) starts with no choice text: the "→ …" line asks for it.
    target = { kind: "new", parentChapterId: parent.id, label: (query.new ?? "").trim() };
  }
  // The same draft as the old Write page's, which the Drafts list opens.
  const draftKey = target.kind === "fill" ? `fill:${target.choiceId}` : `new:${parent.id}`;
  const resumeHref = target.kind === "fill" ? `/c/${parent.id}/desk?choice=${target.choiceId}` : `/c/${parent.id}/desk?new=`;
  const draftLabel = target.kind === "fill" ? `${story.title}: “${target.label}”` : `${story.title}: new choice after “${parent.title}”`;
  const codex = newChapterCodex(story, path);
  return (
    <WritingDesk
      key={draftKey}
      bar={<Link href={`/c/${parent.id}`}>← Back to “{parent.title}”</Link>}
      codex={codex}
      pathBlocks={deskPathBlocks(path)}
      newChapter={{
        target,
        context: {
          storyTitle: story.title,
          premise: story.premise,
          style: story.style,
          path: path.map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary })),
          choiceLabel: target.label || null,
          codex: getContextCodex(parent.id),
          siblingChoices: choices.map((c) => c.label),
        },
        draftKey,
        resumeHref,
        draftLabel,
        autoGenerate: Boolean(query.ai),
        // The codex the AI is sent folds in the changes held in the draft.
        codexPanel: { chapterId: parent.id, path: codex.path, ops: codex.ops, facts: codex.facts },
      }}
    />
  );
}