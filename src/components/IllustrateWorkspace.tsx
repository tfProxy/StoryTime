"use client";

import { useState } from "react";
import { IMAGE_SLOTS, type ImageMade, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import ChapterImageEditor from "./ChapterImageEditor";
import ImagePromptPanel, { type LoadedPrompt } from "./ImagePromptPanel";
import PastPictures, { type PromptToLoad } from "./PastPictures";
import { useSettings } from "@/lib/settings";
import { fromComfyImage, fromSaved, type StartPicture } from "@/lib/comfy/startPicture";

type Props = {
  chapterId: string;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  story: { id: string; title: string; premise: string; art_style: string };
  path: ContextChapter[];
  codex: ContextCodexEntry[];
  versions: ImageVersions;
  made: Record<ImageSlot, ImageMade | null>;
};

/**
 * The prompt box and the picture cards together, so a saved picture's "Load prompt" can fill in the box.
 * Each load carries a number, so loading the same prompt twice still counts as a new request.
 */
export default function IllustrateWorkspace({ chapterId, titles, story, path, codex, versions, made }: Props) {
  const [loaded, setLoaded] = useState<LoadedPrompt | null>(null);
  // The picture new pictures start from (image to image), when one is chosen.
  const [start, setStart] = useState<StartPicture | null>(null);
  const comfy = useSettings().comfy;

  function load(p: PromptToLoad) {
    setLoaded({ nonce: (loaded?.nonce ?? 0) + 1, prompt: p.prompt, negative: p.negative, seed: p.seed });
    // On a phone the prompt box is far above the cards.
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startFrom(picture: StartPicture) {
    setStart(picture);
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <ImagePromptPanel chapterId={chapterId} story={story} path={path} codex={codex} loaded={loaded} start={start} onStart={startFrom} onClearStart={() => setStart(null)} />
      <PastPictures chapterId={chapterId} storyId={story.id} titles={titles} onLoadPrompt={load} onStart={(image) => startFrom(fromComfyImage(comfy.url, image))} />
      <div className="image-editors">
        {IMAGE_SLOTS.map((slot) => (
          <ChapterImageEditor
            key={slot}
            chapterId={chapterId}
            slot={slot}
            version={versions[slot]}
            made={made[slot]}
            onLoadPrompt={(m) => load({ prompt: m.prompt, negative: m.negative, seed: m.job?.seed ?? null })}
            onStart={comfy.url ? (v) => startFrom(fromSaved(chapterId, slot, v)) : undefined}
          />
        ))}
      </div>
    </>
  );
}
