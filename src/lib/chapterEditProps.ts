import type { ChapterEditEntryProps } from "@/components/ChapterEditEntry";
import type { EditWriting } from "@/components/ChapterEditor";
import { getChapterWriting, versionsForEdit } from "./chapterWriting";
import { getCodexFacts, getCodexOps, getContextCodex } from "./codexDb";
import { aiMarkOf, countDescendants, getChoices, getIncomingChoice, type Chapter, type Story } from "./stories";

/** The prompt and versions kept when the chapter was posted, with the chapter as it is now showing. */
function editWriting(id: string, title: string, body: string): EditWriting | null {
  const kept = getChapterWriting(id);
  return kept ? { ...kept, ...versionsForEdit(kept.versions, title, body) } : null;
}

/**
 * What the chapter editor needs to edit a posted chapter (the Edit page and the writing desk). `path` is the chapters
 * from the story's first to this one (this one last).
 */
export function chapterEditProps(story: Story, path: Chapter[]): Omit<ChapterEditEntryProps, "desk"> {
  const chapter = path[path.length - 1];
  const id = chapter.id;
  const incoming = getIncomingChoice(id);
  return {
    chapterId: id,
    baseRevision: chapter.revision,
    descendantCount: countDescendants(id),
    initialTitle: chapter.title,
    initialBody: chapter.body,
    initialSummary: chapter.summary,
    initialPathSummary: chapter.path_summary,
    existingChoices: getChoices(id).map((c) => ({ id: c.id, label: c.label, hasChild: c.child_chapter_id !== null })),
    incomingLabel: incoming?.label ?? null,
    aiMarked: aiMarkOf(chapter) !== null,
    writing: editWriting(id, chapter.title, chapter.body),
    // The AI sees the story up to, but not including, the chapter being edited.
    context: {
      storyTitle: story.title,
      premise: story.premise,
      style: story.style,
      path: path
        .slice(0, -1)
        .map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary })),
      choiceLabel: incoming?.label ?? null,
      // The codex as of this chapter, its own changes included: what the drawer shows and edits.
      codex: getContextCodex(id),
    },
    storyId: story.id,
    draftLabel: `${story.title}: editing “${chapter.title}”`,
    // Codex changes made while editing are held in the draft and saved at this chapter with the edit.
    codexPanel: {
      chapterId: id,
      editing: true,
      path: path.map((c) => ({ id: c.id, title: c.title, depth: c.depth, body: c.body, summary: c.summary, path_summary: c.path_summary })),
      ops: getCodexOps(id),
      facts: getCodexFacts(id),
    },
    story: path.length === 1 ? { id: story.id, title: story.title, premise: story.premise } : null,
  };
}
