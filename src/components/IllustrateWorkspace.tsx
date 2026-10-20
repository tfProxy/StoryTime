"use client";

import { useState, type ReactNode } from "react";
import { IMAGE_SLOTS, type ImageMade, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import ChapterImageEditor from "./ChapterImageEditor";
import ImagePromptPanel, { type IllustratedStory, type LoadedPrompt } from "./ImagePromptPanel";
import ChapterPictures from "./ChapterPictures";
import { picturesOf, type PendingJob, type Picture, type PromptToLoad, type StartMode } from "./pictures";
import { editBlocked, useEditModels } from "./useEditModels";
import { useSettings } from "@/lib/settings";
import type { PictureDraft } from "@/lib/pictureDrafts";
import type { PictureJob } from "@/lib/pictureJobs";
import { fromComfyImage, fromSaved, type StartPicture } from "@/lib/comfy/startPicture";

type Props = {
  chapterId: string;
  /** The chapter panel, shown above the prompt. */
  chapter: ReactNode;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  story: IllustratedStory;
  path: ContextChapter[];
  codex: ContextCodexEntry[];
  versions: ImageVersions;
  made: Record<ImageSlot, ImageMade | null>;
  /** The prompt boxes as last left for this chapter. */
  draft: PictureDraft | null;
  /** The chapter's picture jobs as the page opened, newest first, with their marks. */
  jobs: PictureJob[];
};

/**
 * The Illustrate page's two columns: the chapter and the prompt on one side, the pictures on the other. On a
 * phone the chosen header and footer come first (CSS moves them), then the chapter, the prompt and the pictures. The state they share lives here: the prompt loaded from a picture (each load
 * carries a number, so loading the same prompt twice still counts as a new request), the starting picture,
 * and the chapter's pictures (those made earlier, then those made on this visit).
 */
export default function IllustrateWorkspace({ chapterId, chapter, titles, story, path, codex, versions, made, draft, jobs }: Props) {
  const [loaded, setLoaded] = useState<LoadedPrompt | null>(null);
  // The picture new pictures start from, when one is chosen, and whether it is redrawn or edited.
  const [start, setStart] = useState<StartPicture | null>(null);
  const [startMode, setStartMode] = useState<StartMode>("redraw");
  const comfy = useSettings().comfy;
  const editModels = useEditModels(comfy.url);
  const blocked = editBlocked(editModels);
  // The chapter's pictures, newest first.
  const [pictures, setPictures] = useState<Picture[]>(() => picturesOf(jobs));
  // The jobs being made, newest first, shown among the pictures.
  const [pending, setPending] = useState<PendingJob[]>([]);
  function load(p: PromptToLoad) {
    setLoaded({ ...p, nonce: (loaded?.nonce ?? 0) + 1 });
    // On a phone the prompt box is far above the pictures.
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startFrom(picture: StartPicture, mode: StartMode) {
    setStart(picture);
    setStartMode(mode);
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="illustrate-grid">
      <div className="illustrate-controls">
        {chapter}
        <ImagePromptPanel
          chapterId={chapterId}
          story={story}
          path={path}
          codex={codex}
          loaded={loaded}
          start={start}
          startMode={startMode}
          onStartMode={setStartMode}
          editModels={editModels}
          onClearStart={() => setStart(null)}
          onPictures={(made) => setPictures((prev) => [...made, ...prev])}
          onQueue={setPending}
          draft={draft}
        />
      </div>
      <div className="illustrate-gallery">
        {/* The chosen pictures first, to compare the new ones with. */}
        <div className="image-editors">
          {IMAGE_SLOTS.map((slot) => (
            <ChapterImageEditor
              key={slot}
              chapterId={chapterId}
              slot={slot}
              version={versions[slot]}
              made={made[slot]}
              onLoadPrompt={(m) =>
                load({
                  prompt: m.prompt,
                  negative: m.negative,
                  seed: m.job?.seed ?? null,
                  settings: m.job && { checkpoint: m.job.checkpoint, width: m.job.width, height: m.job.height, denoise: null },
                })
              }
              onStart={comfy.url ? (v, mode) => startFrom(fromSaved(chapterId, slot, v), mode) : undefined}
              editBlocked={blocked}
            />
          ))}
        </div>
        {comfy.url && (
          <ChapterPictures
            chapterId={chapterId}
            storyId={story.id}
            titles={titles}
            comfyUrl={comfy.url}
            pictures={pictures}
            onChange={(key, patch) => setPictures((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))}
            onClear={() => setPictures((prev) => prev.map((p) => (p.fresh ? { ...p, fresh: false } : p)))}
            pending={pending}
            onStart={(image, mode) => startFrom(fromComfyImage(comfy.url, image), mode)}
            editBlocked={blocked}
            onLoadPrompt={load}
            used={{ header: made.header?.from ?? null, footer: made.footer?.from ?? null }}
          />
        )}
      </div>
    </div>
  );
}
