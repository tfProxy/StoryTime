import type { IllustrateProps } from "@/components/IllustrateWorkspace";
import { chapterImageMade, chapterImageVersions } from "./chapterImages";
import { foldCodex } from "./codex";
import { getCodexFacts, getCodexOps } from "./codexDb";
import { chapterPictureJobs, storyChapterTitles } from "./pictureJobs";
import { chapterRefPool } from "./referencePool";
import { getPictureDraft } from "./pictureDrafts";
import { getChapterFixed, getChapterPreset, type Chapter, type Story } from "./stories";

/**
 * What illustrating a posted chapter needs (the Illustrate page and the writing desk's Illustrate mode). `path` is the
 * chapters from the story's first to this one (this one last).
 */
export function illustrateProps(story: Story, path: Chapter[]): IllustrateProps {
  const chapter = path[path.length - 1];
  const before = path.at(-2);
  const codex = foldCodex(getCodexOps(chapter.id), getCodexFacts(chapter.id)).map((e) => ({
    id: e.entry_id,
    name: e.name,
    type: e.type,
    aliases: e.aliases,
    content: e.description,
    always_include: e.always_include,
  }));
  return {
    chapterId: chapter.id,
    chapter: {
      chapterId: chapter.id,
      title: chapter.title,
      body: chapter.body,
      summary: chapter.summary,
      earlier: before ? before.path_summary || before.summary || null : null,
    },
    titles: storyChapterTitles(story.id),
    story: {
      id: story.id,
      title: story.title,
      premise: story.premise,
      art_style: story.art_style,
      draw_preset: story.draw_preset,
      style_ref: story.style_ref,
    },
    chapterPreset: getChapterPreset(chapter.id),
    path: path.map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary })),
    codex,
    pool: chapterRefPool(story.id, path, story.cover_version),
    versions: chapterImageVersions([chapter.id]).get(chapter.id)!,
    made: chapterImageMade(chapter.id),
    draft: getPictureDraft(chapter.id),
    fixedPrompt: getChapterFixed(chapter.id),
    jobs: chapterPictureJobs(chapter.id),
  };
}
