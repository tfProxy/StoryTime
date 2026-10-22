"use client";

import { useMemo, type ComponentProps } from "react";
import type { ImageMade } from "@/lib/imageSlots";
import type { PictureJob } from "@/lib/pictureJobs";
import CoverPromptPanel from "./CoverPromptPanel";
import PictureWorkspace from "./PictureWorkspace";

type Props = Omit<ComponentProps<typeof CoverPromptPanel>, "loaded" | "refRequest" | "pinned" | "start" | "onClearStart" | "startMode" | "onStartMode" | "paint" | "editModels" | "onPictures" | "onQueue" | "dock"> & {
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  /** The saved cover's version, or null when there is none. */
  version: number | null;
  /** What the saved cover was made from, when it came from ComfyUI. */
  made: ImageMade | null;
  /** The cover's picture jobs as the page opened, newest first, with their marks. */
  jobs: PictureJob[];
};

/**
 * The cover page: the prompt and Make pictures on one side; the saved cover and the pictures on the other
 * (see `PictureWorkspace`).
 */
export default function CoverWorkspace({ titles, version, made, jobs, ...panel }: Props) {
  const versions = useMemo(() => ({ cover: version }), [version]);
  const madeBySlot = useMemo(() => ({ cover: made }), [made]);

  return (
    <PictureWorkspace
      target={{ storyId: panel.story.id, chapterId: null }}
      jobs={jobs}
      titles={titles}
      versions={versions}
      made={madeBySlot}
      controls={(w) => (
        <CoverPromptPanel
          {...panel}
          loaded={w.loaded}
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
          dock={w.dock}
        />
      )}
    />
  );
}
