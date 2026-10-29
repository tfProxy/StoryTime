import { db } from "./db";
import { aiMarkOf, getChapter, getStory, type AiMark } from "./stories";

export type TreeNode = {
  id: string;
  title: string;
  depth: number;
  edited: boolean;
  summary: string | null;
  /** Written by an AI run (and whether the author reviewed it); null when the author wrote it. */
  ai: AiMark;
  /** Choices on this chapter; `child` is null while the choice is still unwritten. */
  choices: { id: string; label: string; child: TreeNode | null }[];
};

type ChapterRow = {
  id: string;
  title: string;
  depth: number;
  parent_choice_id: string | null;
  edited_at: number | null;
  summary: string | null;
  ai_run_id: string | null;
  ai_reviewed_at: number | null;
};

export type StoryChapter = {
  id: string;
  revision: number;
  title: string;
  body: string;
  summary: string | null;
  path_summary: string | null;
  depth: number;
  /** The chapter this one continues from; null for the first chapter. */
  parent_id: string | null;
  /** The label of the choice that leads here; null for the first chapter. */
  choice_label: string | null;
};

/** Every live chapter reachable from a story's first chapter, parents before children. */
export function getStoryChapters(storyId: string): StoryChapter[] {
  const story = getStory(storyId);
  if (!story?.root_chapter_id) return [];
  const rows = db()
    .prepare(
      `SELECT c.id, c.revision, c.title, c.body, c.summary, c.path_summary, c.depth, ch.parent_chapter_id AS parent_id, ch.label AS choice_label
         FROM chapters c LEFT JOIN choices ch ON ch.id = c.parent_choice_id
        WHERE c.story_id = ? ORDER BY c.depth, c.posted_at, c.rowid`,
    )
    .all(storyId) as StoryChapter[];
  // Only chapters reachable from the root.
  const live = new Set<string>();
  return rows.filter((c) => {
    if (c.id !== story.root_chapter_id && !(c.parent_id && live.has(c.parent_id))) return false;
    live.add(c.id);
    return true;
  });
}

/**
 * Every live chapter of a story as a nested tree, for the outline view. Removed chapters and
 * choices (and anything below them) are left out.
 */
export function getStoryTree(storyId: string): TreeNode | null {
  const story = getStory(storyId);
  if (!story?.root_chapter_id) return null;
  return buildTree(storyId, story.root_chapter_id, Infinity, 0);
}

/**
 * The chapter as a tree with its descendants down to `maxDepth` levels below it (0 = just the chapter). Depths
 * are relative: the chapter is 0. Every chapter down to the limit lists its choices, and a written one's child
 * is there too; the children one level past the limit are stubs (`choices: []`), so a choice written below the
 * limit is never mistaken for an unwritten one.
 */
export function getSubtree(chapterId: string, maxDepth: number): TreeNode | null {
  const chapter = getChapter(chapterId);
  if (!chapter) return null;
  return buildTree(chapter.story_id, chapterId, maxDepth, chapter.depth);
}

function buildTree(storyId: string, rootId: string, maxDepth: number, baseDepth: number): TreeNode | null {
  const chapters = db()
    .prepare(
      `SELECT id, title, depth, parent_choice_id, edited_at, summary, ai_run_id, ai_reviewed_at
         FROM chapters WHERE story_id = ?`,
    )
    .all(storyId) as ChapterRow[];
  const choices = db()
    .prepare(
      `SELECT ch.id, ch.parent_chapter_id, ch.label
         FROM choices ch JOIN chapters c ON c.id = ch.parent_chapter_id
        WHERE c.story_id = ?
        ORDER BY ch.posted_at, ch.rowid`,
    )
    .all(storyId) as { id: string; parent_chapter_id: string; label: string }[];

  const childOfChoice = new Map<string, ChapterRow>();
  for (const c of chapters) if (c.parent_choice_id) childOfChoice.set(c.parent_choice_id, c);
  const choicesOf = new Map<string, typeof choices>();
  for (const ch of choices) {
    const list = choicesOf.get(ch.parent_chapter_id) ?? [];
    list.push(ch);
    choicesOf.set(ch.parent_chapter_id, list);
  }

  const build = (c: ChapterRow): TreeNode => ({
    id: c.id,
    title: c.title,
    depth: c.depth - baseDepth,
    edited: c.edited_at !== null,
    summary: c.summary,
    ai: aiMarkOf(c),
    // Chapters one level past the limit are only stubs: they say a choice is written, with no choices of their own.
    choices: c.depth - baseDepth > maxDepth ? [] : (choicesOf.get(c.id) ?? []).map((ch) => {
      const child = childOfChoice.get(ch.id);
      return { id: ch.id, label: ch.label, child: child ? build(child) : null };
    }),
  });

  const root = chapters.find((c) => c.id === rootId);
  return root ? build(root) : null;
}
