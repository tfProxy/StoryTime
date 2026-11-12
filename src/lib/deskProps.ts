import type { PathBlock } from "@/components/DeskPath";
import type { DeskCodex } from "@/components/WritingDesk";
import { getCodexFacts, getCodexOps } from "./codexDb";
import { codexIcons, iconChoices } from "./codexIcons";
import { draftMarks } from "./draftMarks";
import { getIncomingChoice, type Chapter, type Story } from "./stories";
import { getStoryChapters } from "./tree";

/** The writing desk's path blocks: `earlier`, the chapters above the box, each with its choice and "Draft not used". */
export function deskPathBlocks(earlier: Chapter[]): PathBlock[] {
  const unused = new Set(draftMarks(earlier.map((c) => c.id)));
  return earlier.map((c) => ({
    id: c.id,
    title: c.title,
    body: c.body,
    summary: c.summary,
    via: getIncomingChoice(c.id)?.label ?? null,
    unused: unused.has(c.id),
  }));
}

/**
 * The writing desk's codex for a chapter not posted yet after `path` (empty for a story's first chapter): the codex as
 * of the chapter it follows. Changes made on the desk are held in the new chapter's draft, and Post saves them at it.
 */
export function newChapterCodex(story: Story, path: Chapter[]): DeskCodex {
  const parent = path.at(-1);
  const storyChapters = getStoryChapters(story.id);
  return {
    storyId: story.id,
    chapterId: parent?.id ?? "",
    path: path.map((c) => ({ id: c.id, title: c.title, depth: c.depth, body: c.body, summary: c.summary, path_summary: c.path_summary })),
    ops: parent ? getCodexOps(parent.id) : [],
    facts: parent ? getCodexFacts(parent.id) : [],
    icons: codexIcons(story.id),
    iconChoices: iconChoices(story.id, storyChapters, path.map((c) => c.id), story.cover_version),
    after: [],
    laterForms: {},
    formChapters: [],
    chapters: storyChapters.map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id, label: c.choice_label })),
  };
}
