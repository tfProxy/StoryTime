"use client";

import { useMemo, type ComponentProps } from "react";
import type { ImageMade } from "@/lib/imageSlots";
import type { PictureJob } from "@/lib/pictureJobs";
import { fromComfyImage, fromSaved } from "@/lib/comfy/startPicture";
import ChapterImageEditor from "./ChapterImageEditor";
import ChapterPictures from "./ChapterPictures";
import CoverPromptPanel from "./CoverPromptPanel";
import { usePictureWorkspace } from "./usePictureWorkspace";

type Props = Omit<ComponentProps<typeof CoverPromptPanel>, "loaded" | "start" | "onClearStart" | "startMode" | "onStartMode" | "paint" | "editModels" | "onPictures" | "onQueue" | "dock"> & {
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
 * The cover page's two columns, laid out like a chapter's Illustrate page: the prompt and Make pictures on
 * one side; the saved cover, to compare new pictures with, and the pictures on the other. The state they
 * share is kept by `usePictureWorkspace`.
 */
export default function CoverWorkspace({ titles, version, made, jobs, ...panel }: Props) {
  const target = { storyId: panel.story.id, chapterId: null };
  const versions = useMemo(() => ({ cover: version }), [version]);
  const { gridProps, resizerProps, setDock, ...w } = usePictureWorkspace(target, jobs, versions);
  const { comfy } = w;

  return (
    <div className="illustrate-grid" {...gridProps}>
      <div className="illustrate-controls">
        <CoverPromptPanel
          {...panel}
          loaded={w.loaded}
          start={w.start}
          startMode={w.startMode}
          onStartMode={w.setStartMode}
          paint={{ mask: w.mask, onMask: w.setMask, nonce: w.paintNonce }}
          editModels={w.editModels}
          onClearStart={() => w.setStart(null)}
          onPictures={w.addPictures}
          onQueue={w.setPending}
          dock={w.dock}
        />
      </div>
      <div {...resizerProps} />
      <div className="illustrate-gallery">
        {/* The saved cover first, to compare the new ones with. */}
        <div className="image-editors">
          <ChapterImageEditor
            target={target}
            slot="cover"
            version={version}
            made={made}
            onLoadPrompt={(m) =>
              w.load({
                prompt: m.prompt,
                negative: m.negative,
                seed: m.job?.seed ?? null,
                settings: m.job && { checkpoint: m.job.checkpoint, width: m.job.width, height: m.job.height, denoise: null },
              })
            }
            onStart={comfy.url ? (v, mode) => w.startFrom(fromSaved(target, "cover", v), mode) : undefined}
            editBlocked={w.blocked}
          />
        </div>
        {comfy.url && (
          <ChapterPictures
            target={target}
            titles={titles}
            comfyUrl={comfy.url}
            pictures={w.pictures}
            onChange={w.changePicture}
            onClear={w.clearFresh}
            pending={w.pending}
            onStart={(image, mode) => w.startFrom(fromComfyImage(comfy.url, image), mode)}
            editBlocked={w.blocked}
            onLoadPrompt={w.load}
            starting={w.start?.source ?? null}
            used={{ cover: made?.from ?? null }}
          />
        )}
      </div>
      {/* Size, Queue and the queue's status are put here (see ComfyGenerate), so they stay at the bottom of the screen. */}
      <div className="generate-dock" ref={setDock} />
    </div>
  );
}
