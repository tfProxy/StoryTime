"use client";

import { useState, type ComponentProps } from "react";
import type { ImageMade, ImageSlot, ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import IllustrateChapter from "./IllustrateChapter";
import ImagePromptPanel, { type IllustratedStory } from "./ImagePromptPanel";
import PictureWorkspace from "./PictureWorkspace";
import type { PictureDraft } from "@/lib/pictureDrafts";
import type { PictureJob } from "@/lib/pictureJobs";
import type { RefPool } from "@/lib/comfy/referenceChoices";

type Props = {
  chapterId: string;
  /** The chapter panel's text, shown above the prompt. */
  chapter: Omit<ComponentProps<typeof IllustrateChapter>, "slotRef">;
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

/**
 * The Illustrate page: the chapter and the prompt on one side, the pictures on the other (see
 * `PictureWorkspace`).
 */
export default function IllustrateWorkspace({ chapterId, chapter, titles, story, chapterPreset, path, codex, pool, versions, made, draft, fixedPrompt, jobs }: Props) {
  const [codexSlot, setCodexSlot] = useState<HTMLElement | null>(null);

  return (
    <PictureWorkspace
      target={{ storyId: story.id, chapterId }}
      jobs={jobs}
      titles={titles}
      versions={versions}
      made={made}
      controls={(w) => (
        <>
          <IllustrateChapter {...chapter} slotRef={setCodexSlot} />
          <ImagePromptPanel
            chapterId={chapterId}
            story={story}
            chapterPreset={chapterPreset}
            path={path}
            codex={codex}
            loaded={w.loaded}
            pool={pool}
            refRequest={w.refRequest}
            pinned={w.pinned}
            start={w.start}
            startMode={w.startMode}
            onStartMode={w.setStartMode}
            paint={{ mask: w.mask, onMask: w.setMask, nonce: w.paintNonce }}
            editModels={w.editModels}
            onClearStart={w.onClearStart}
            onPictures={w.addPictures}
            onQueue={w.setPending}
            draft={draft}
            fixedPrompt={fixedPrompt}
            dock={w.dock}
            codexSlot={codexSlot}
          />
        </>
      )}
    />
  );
}
