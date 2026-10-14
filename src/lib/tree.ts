import { db } from "./db";
import { getStory } from "./stories";

export type TreeNode = {
  id: string;
  title: string;
  author_name: string;
  depth: number;
  edited: boolean;
  /** Choices on this chapter; `child` is null while the choice is still unwritten. */
  choices: { id: string; label: string; child: TreeNode | null }[];
};

type ChapterRow = {
  id: string;
  title: string;
  author_name: string;
  depth: number;
  parent_choice_id: string | null;
  edited_at: number | null;
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
};

/** Every live chapter reachable from a story's first chapter, parents before children. */
export function getStoryChapters(storyId: string): StoryChapter[] {
  const story = getStory(storyId);
  if (!story?.root_chapter_id) return [];
  const rows = db()
    .prepare(
      `SELECT c.id, c.revision, c.title, c.body, c.summary, c.path_summary, c.depth, ch.parent_chapter_id AS parent_id
         FROM chapters c LEFT JOIN choices ch ON ch.id = c.parent_choice_id
        WHERE c.story_id = ? AND c.removed_at IS NULL ORDER BY c.depth, c.posted_at, c.rowid`,
    )
    .all(storyId) as StoryChapter[];
  // A chapter below a removed one is hidden with it.
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

  const chapters = db()
    .prepare(
      `SELECT id, title, author_name, depth, parent_choice_id, edited_at
         FROM chapters WHERE story_id = ? AND removed_at IS NULL`,
    )
    .all(storyId) as ChapterRow[];
  const choices = db()
    .prepare(
      `SELECT ch.id, ch.parent_chapter_id, ch.label
         FROM choices ch JOIN chapters c ON c.id = ch.parent_chapter_id
        WHERE c.story_id = ? AND ch.removed_at IS NULL
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
    author_name: c.author_name,
    depth: c.depth,
    edited: c.edited_at !== null,
    choices: (choicesOf.get(c.id) ?? []).map((ch) => {
      const child = childOfChoice.get(ch.id);
      return { id: ch.id, label: ch.label, child: child ? build(child) : null };
    }),
  });

  const root = chapters.find((c) => c.id === story.root_chapter_id);
  return root ? build(root) : null;
}
