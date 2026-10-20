"use client";

import { useState } from "react";
import { IMAGE_SLOTS, type ImageMade, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import ChapterImageEditor from "./ChapterImageEditor";
import ImagePromptPanel, { type LoadedPrompt } from "./ImagePromptPanel";

type Props = {
  chapterId: string;
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
export default function IllustrateWorkspace({ chapterId, story, path, codex, versions, made }: Props) {
  const [loaded, setLoaded] = useState<LoadedPrompt | null>(null);

  function load(m: ImageMade) {
    setLoaded({ nonce: (loaded?.nonce ?? 0) + 1, prompt: m.prompt, negative: m.negative, seed: m.job?.seed ?? null });
    // On a phone the prompt box is far above the cards.
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <ImagePromptPanel chapterId={chapterId} story={story} path={path} codex={codex} loaded={loaded} />
      <div className="image-editors">
        {IMAGE_SLOTS.map((slot) => (
          <ChapterImageEditor key={slot} chapterId={chapterId} slot={slot} version={versions[slot]} made={made[slot]} onLoadPrompt={load} />
        ))}
      </div>
    </>
  );
}
