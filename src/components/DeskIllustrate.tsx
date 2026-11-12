"use client";

import { useState, type ReactNode } from "react";
import { chapterTarget } from "@/lib/pictureTarget";
import IllustrateChapter from "./IllustrateChapter";
import { IllustratePrompt, type IllustrateProps } from "./IllustrateWorkspace";
import { PictureGallery, workspaceControls } from "./PictureWorkspace";
import { usePictureWorkspace } from "./usePictureWorkspace";

/**
 * The writing desk's Illustrate mode: the Illustrate page's parts, laid out on the desk. The side column holds the picture
 * prompt and the controls for making pictures (`modes`, the Codex | Illustrate switch, at its top); the story column
 * holds the chapter's header, middle and footer pictures, the pictures made for them, and the chapter folded below.
 * Both are children of the desk's grid, so this returns them side by side.
 */
export default function DeskIllustrate({ p, modes }: { p: IllustrateProps; modes: ReactNode }) {
  const target = chapterTarget(p.story.id, p.chapterId);
  // The grid, its column handle and the dock are the Illustrate page's; on the desk Size and Queue sit among the controls.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
  const { gridProps, resizerProps, setDock, ...w } = usePictureWorkspace(target, p.jobs, p.versions);
  // Where the prompt puts its "Codex entries used" line: under the chapter, as on the Illustrate page.
  const [codexSlot, setCodexSlot] = useState<HTMLElement | null>(null);

  return (
    <>
      <aside className="desk-side desk-illus-side" aria-label="Illustrate">
        {modes}
        <IllustratePrompt p={p} w={workspaceControls(w)} codexSlot={codexSlot} layout="desk" />
      </aside>
      <div className="desk-story desk-pictures">
        <h1 className="desk-title">Illustrate “{p.chapter.title}”</h1>
        <PictureGallery target={target} titles={p.titles} versions={p.versions} made={p.made} w={w} />
        <IllustrateChapter {...p.chapter} storyId={p.story.id} slotRef={setCodexSlot} />
      </div>
    </>
  );
}
