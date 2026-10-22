"use client";

import { useState, type ComponentProps } from "react";
import { IMAGE_SLOTS, type ImageMade, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import ChapterImageEditor from "./ChapterImageEditor";
import IllustrateChapter from "./IllustrateChapter";
import ImagePromptPanel, { type IllustratedStory } from "./ImagePromptPanel";
import ChapterPictures from "./ChapterPictures";
import { usePictureWorkspace } from "./usePictureWorkspace";
import type { PictureDraft } from "@/lib/pictureDrafts";
import type { PictureJob } from "@/lib/pictureJobs";
import { fromComfyImage, fromSaved } from "@/lib/comfy/startPicture";

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
 * The Illustrate page's two columns: the chapter and the prompt on one side, the pictures on the other. On a
 * phone the chosen header and footer come first (CSS moves them), then the chapter, the prompt and the
 * pictures. The state they share is kept by `usePictureWorkspace`.
 */
export default function IllustrateWorkspace({ chapterId, chapter, titles, story, chapterPreset, path, codex, versions, made, draft, fixedPrompt, jobs }: Props) {
  const target = { storyId: story.id, chapterId };
  const { gridProps, resizerProps, setDock, ...w } = usePictureWorkspace(target, jobs, versions);
  const { comfy } = w;
  const [codexSlot, setCodexSlot] = useState<HTMLElement | null>(null);

  return (
    <div className="illustrate-grid" {...gridProps}>
      <div className="illustrate-controls">
        <IllustrateChapter {...chapter} slotRef={setCodexSlot} />
        <ImagePromptPanel
          chapterId={chapterId}
          story={story}
          chapterPreset={chapterPreset}
          path={path}
          codex={codex}
          loaded={w.loaded}
          start={w.start}
          startMode={w.startMode}
          onStartMode={w.setStartMode}
          editModels={w.editModels}
          onClearStart={() => w.setStart(null)}
          onPictures={w.addPictures}
          onQueue={w.setPending}
          draft={draft}
          fixedPrompt={fixedPrompt}
          dock={w.dock}
          codexSlot={codexSlot}
        />
      </div>
      <div {...resizerProps} />
      <div className="illustrate-gallery">
        {/* The chosen pictures first, to compare the new ones with. */}
        <div className="image-editors">
          {IMAGE_SLOTS.map((slot) => (
            <ChapterImageEditor
              key={slot}
              target={target}
              slot={slot}
              version={versions[slot]}
              made={made[slot]}
              onLoadPrompt={(m) =>
                w.load({
                  prompt: m.prompt,
                  negative: m.negative,
                  seed: m.job?.seed ?? null,
                  settings: m.job && { checkpoint: m.job.checkpoint, width: m.job.width, height: m.job.height, denoise: null },
                })
              }
              onStart={comfy.url ? (v, mode) => w.startFrom(fromSaved(target, slot, v), mode) : undefined}
              editBlocked={w.blocked}
            />
          ))}
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
            used={{ header: made.header?.from ?? null, footer: made.footer?.from ?? null }}
          />
        )}
      </div>
      {/* Size, Queue and the queue's status are put here (see ComfyGenerate), so they stay at the bottom of the screen. */}
      <div className="generate-dock" ref={setDock} />
    </div>
  );
}
