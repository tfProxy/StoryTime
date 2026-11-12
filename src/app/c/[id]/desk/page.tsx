import Link from "next/link";
import { notFound } from "next/navigation";
import { nextChapters } from "@/components/CodexChapterNav";
import WritingDesk from "@/components/WritingDesk";
import { chapterEditProps } from "@/lib/chapterEditProps";
import { foldCodex } from "@/lib/codex";
import { getCodexFacts, getCodexOps, nextFormChange } from "@/lib/codexDb";
import { codexIcons, iconChoices } from "@/lib/codexIcons";
import { illustrateProps } from "@/lib/illustrateProps";
import { getPath, getStory } from "@/lib/stories";
import { getStoryChapters, laterChaptersFrom } from "@/lib/tree";

export const dynamic = "force-dynamic";

// The writing desk for a posted chapter: the codex beside the chapter's editor. (It stands next to the Edit page until
// it replaces it.) Codex changes made here are saved at once, at this chapter. `?side=illustrate` opens the side column
// in Illustrate mode, with the chapter's pictures in the story column.
export default async function DeskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ side?: string }> }) {
  const { id } = await params;
  const { side } = await searchParams;
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

  const ops = getCodexOps(id);
  const facts = getCodexFacts(id);
  const storyChapters = getStoryChapters(story.id);
  const laterForms = Object.fromEntries(foldCodex(ops, facts).map((e) => [e.entry_id, nextFormChange(e.entry_id, id)]));

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link> · <Link href={`/c/${id}/edit`}>Edit page</Link>
      </p>
      <WritingDesk
        mode={side === "illustrate" ? "illustrate" : "codex"}
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
    </>
  );
}
