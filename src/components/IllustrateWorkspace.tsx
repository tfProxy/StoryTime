"use client";

import { useState, type ComponentProps } from "react";
import type { ImageMade, ImageSlot, ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import IllustrateChapter from "./IllustrateChapter";
import ImagePromptPanel, { type IllustratedStory } from "./ImagePromptPanel";
import PictureWorkspace, { type WorkspaceControls } from "./PictureWorkspace";
import type { PictureDraft } from "@/lib/pictureDrafts";
import { chapterTarget } from "@/lib/pictureTarget";
import type { PictureJob } from "@/lib/pictureJobs";
import type { RefPool } from "@/lib/comfy/referenceChoices";

/** What illustrating a chapter needs (see `illustrateProps`): the Illustrate page's, and the writing desk's Illustrate mode's. */
export type IllustrateProps = {
  chapterId: string;
  /** The chapter panel's text, shown above the prompt. */
  chapter: Omit<ComponentProps<typeof IllustrateChapter>, "slotRef" | "storyId">;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  story: IllustratedStory;
  /** The chapter's own drawing preset, or null to use the story's. */
  chapterPreset: string | null;
  path: ContextChapter[];
  codex: ContextCodexEntry[];
  /** The saved pictures the References offer: headers and footers on the path, the cover. */
  pool: RefPool;
  versions: ImageVersions;
  made: Record<ImageSlot, ImageMade | null>;
  /** The prompt boxes as last left for this chapter. */
  draft: PictureDraft | null;
  /** Text the chapter's prompts always include. */
  fixedPrompt: string;
  /** The chapter's picture jobs as the page opened, newest first, with their marks. */
  jobs: PictureJob[];
};

/** The chapter's picture prompt and the controls for making pictures (`ImagePromptPanel`), fed from the workspace `w`. */
export function IllustratePrompt({ p, w, codexSlot }: { p: IllustrateProps; w: WorkspaceControls; codexSlot: HTMLElement | null }) {
  return (
    <ImagePromptPanel
      chapterId={p.chapterId}
      story={p.story}
      chapterPreset={p.chapterPreset}
      path={p.path}
      codex={p.codex}
      loaded={w.loaded}
      pool={p.pool}
      refRequest={w.refRequest}
      pinned={w.pinned}
      start={w.start}
      editModels={w.editModels}
      onClearStart={w.onClearStart}
      onPictures={w.addPictures}
      onQueue={w.setPending}
      draft={p.draft}
      fixedPrompt={p.fixedPrompt}
      dock={w.dock}
      codexSlot={codexSlot}
    />
  );
}

/**
 * The Illustrate page: the chapter and the prompt on one side, the pictures on the other (see
 * `PictureWorkspace`).
 */
export default function IllustrateWorkspace(p: IllustrateProps) {
  const [codexSlot, setCodexSlot] = useState<HTMLElement | null>(null);

  return (
    <PictureWorkspace
      target={chapterTarget(p.story.id, p.chapterId)}
      jobs={p.jobs}
      titles={p.titles}
      versions={p.versions}
      made={p.made}
      controls={(w) => (
        <>
          <IllustrateChapter {...p.chapter} storyId={p.story.id} slotRef={setCodexSlot} />
          <IllustratePrompt p={p} w={w} codexSlot={codexSlot} />
        </>
      )}
    />
  );
}
