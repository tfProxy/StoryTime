"use client";

import { useState, type ReactNode } from "react";
import { IMAGE_SLOTS, type ImageMade, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import ChapterImageEditor from "./ChapterImageEditor";
import ImagePromptPanel, { type LoadedPrompt } from "./ImagePromptPanel";
import NewPictures, { type Candidate } from "./NewPictures";
import PastPictures, { type PromptToLoad } from "./PastPictures";
import { useSettings } from "@/lib/settings";
import { fromComfyImage, fromSaved, type StartPicture } from "@/lib/comfy/startPicture";

type Props = {
  chapterId: string;
  /** The chapter panel, shown above the prompt. */
  chapter: ReactNode;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  story: { id: string; title: string; premise: string; art_style: string };
  path: ContextChapter[];
  codex: ContextCodexEntry[];
  versions: ImageVersions;
  made: Record<ImageSlot, ImageMade | null>;
};

/**
 * The Illustrate page's two columns: the chapter and the prompt on one side (above everything on a phone),
 * the pictures on the other. The state they share lives here: the prompt loaded from a picture (each load
 * carries a number, so loading the same prompt twice still counts as a new request), the starting picture,
 * and the pictures made on this visit.
 */
export default function IllustrateWorkspace({ chapterId, chapter, titles, story, path, codex, versions, made }: Props) {
  const [loaded, setLoaded] = useState<LoadedPrompt | null>(null);
  // The picture new pictures start from (image to image), when one is chosen.
  const [start, setStart] = useState<StartPicture | null>(null);
  // Pictures made on this visit, newest first.
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  // The place in New pictures where the jobs being made are listed.
  const [queueSlot, setQueueSlot] = useState<HTMLElement | null>(null);
  const comfy = useSettings().comfy;

  function load(p: PromptToLoad) {
    setLoaded({ ...p, nonce: (loaded?.nonce ?? 0) + 1 });
    // On a phone the prompt box is far above the pictures.
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startFrom(picture: StartPicture) {
    setStart(picture);
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
          onClearStart={() => setStart(null)}
          onPictures={(pictures) => setCandidates((prev) => [...pictures, ...prev])}
          queueSlot={queueSlot}
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
              onStart={comfy.url ? (v) => startFrom(fromSaved(chapterId, slot, v)) : undefined}
            />
          ))}
        </div>
        {comfy.url && (
          <NewPictures
            chapterId={chapterId}
            comfyUrl={comfy.url}
            candidates={candidates}
            onClear={() => setCandidates([])}
            queueRef={setQueueSlot}
            onStart={(image) => startFrom(fromComfyImage(comfy.url, image))}
            onLoadPrompt={(c) =>
              load({
                prompt: c.prompt,
                negative: c.negative,
                seed: c.seed,
                settings: { checkpoint: c.checkpoint, width: c.width, height: c.height, denoise: c.denoise },
                moment: c.moment,
              })
            }
          />
        )}
        <PastPictures chapterId={chapterId} storyId={story.id} titles={titles} onLoadPrompt={load} onStart={(image) => startFrom(fromComfyImage(comfy.url, image))} />
      </div>
    </div>
  );
}
