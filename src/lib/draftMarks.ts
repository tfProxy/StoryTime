import { getChapterWriting } from "./chapterWriting";
import { draftKeysSaved, getDraft } from "./draftStore";
import { choiceDraftKey, getChapter } from "./stories";

// Work left behind on the writing desk, marked where the chapter is listed: "Draft not used" on a posted chapter whose
// draft (`edit:<id>`, kept on the server) holds text the chapter doesn't read as, and "draft" on an unwritten choice
// whose new chapter has a draft (`fill:<choice id>`). The reading page's choices and the Drafts list show them; the
// desk's path blocks and "What happens next?" (step 5 of the writing desk) should use `draftMarks`.

/** The edit draft's key for a posted chapter (as the desk saves it, and the old Edit page did). */
export const editDraftKey = (chapterId: string) => `edit:${chapterId}`;

type Version = { title?: unknown; body?: unknown };

/**
 * Whether the posted chapter has a draft that differs from it: the draft showing is not the chapter's text, or one of
 * its drafts is neither the chapter nor kept with it (in chapter_writing, from the last Post or Update).
 */
export function hasUnusedDraft(chapterId: string): boolean {
  const draft = getDraft(editDraftKey(chapterId));
  if (!draft) return false;
  const chapter = getChapter(chapterId);
  if (!chapter) return false;
  if (draft.title !== chapter.title || draft.body !== chapter.body) return true;
  const kept = new Set([chapter.body, ...(getChapterWriting(chapterId)?.versions ?? []).map((v) => v.body)]);
  const versions = Array.isArray(draft.versions) ? (draft.versions as Version[]) : [];
  return versions.some((v) => typeof v.body === "string" && v.body.trim() !== "" && !kept.has(v.body));
}

export type DraftMark = "unused" | "draft";

/**
 * The marks for a chapter's choices, by choice id: "unused" for a written one whose chapter has a draft not used,
 * "draft" for an unwritten one with a draft saved. Choices with neither are left out.
 */
export function choiceDraftMarks(choices: { id: string; child_chapter_id: string | null }[]): Map<string, DraftMark> {
  const marks = new Map<string, DraftMark>();
  const drafted = draftKeysSaved(choices.filter((c) => !c.child_chapter_id).map((c) => choiceDraftKey(c.id)));
  for (const c of choices) {
    if (c.child_chapter_id ? hasUnusedDraft(c.child_chapter_id) : drafted.has(choiceDraftKey(c.id))) marks.set(c.id, c.child_chapter_id ? "unused" : "draft");
  }
  return marks;
}

/** For the desk: which of these posted chapters (the path, say) have a draft not used. */
export function draftMarks(chapterIds: string[]): string[] {
  return chapterIds.filter(hasUnusedDraft);
}
