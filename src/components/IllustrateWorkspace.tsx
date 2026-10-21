"use client";

import { useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { IMAGE_SLOTS, type ImageMade, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import type { ContextChapter, ContextCodexEntry } from "@/lib/ai/prompts";
import ChapterImageEditor from "./ChapterImageEditor";
import IllustrateChapter from "./IllustrateChapter";
import ImagePromptPanel, { type IllustratedStory, type LoadedPrompt } from "./ImagePromptPanel";
import ChapterPictures from "./ChapterPictures";
import { picturesOf, type PendingJob, type Picture, type PromptToLoad, type StartMode } from "./pictures";
import { editBlocked, useEditModels } from "./useEditModels";
import { useSettings } from "@/lib/settings";
import type { PictureDraft } from "@/lib/pictureDrafts";
import type { PictureJob } from "@/lib/pictureJobs";
import { fromComfyImage, fromSaved, type StartPicture } from "@/lib/comfy/startPicture";

/** The narrowest the controls column can be dragged to, the widest as a share of the page, and the handle's width (see .column-resizer). */
const MIN_CONTROLS = 320;
const MAX_CONTROLS_SHARE = 0.6;
const HANDLE_PX = 16;

type Props = {
  chapterId: string;
  /** The chapter panel's text, shown above the prompt. */
  chapter: Omit<ComponentProps<typeof IllustrateChapter>, "slotRef">;
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
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const [codexSlot, setCodexSlot] = useState<HTMLElement | null>(null);
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

  // EXPERIMENT: the width the author dragged the controls column to (px), or null for the default; wide screens only.
  const gridRef = useRef<HTMLDivElement>(null);
  const [controlsWidth, setControlsWidth] = useState<number | null>(null);
  const fit = (px: number) => Math.round(Math.min(Math.max(px, MIN_CONTROLS), (gridRef.current?.clientWidth ?? 1600) * MAX_CONTROLS_SHARE));

  function drag(e: React.PointerEvent<HTMLDivElement>) {
    const grid = gridRef.current;
    if (!grid || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const left = grid.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => setControlsWidth(fit(ev.clientX - left - HANDLE_PX / 2));
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function nudge(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const now = controlsWidth ?? gridRef.current?.querySelector<HTMLElement>(".illustrate-controls")?.offsetWidth ?? MIN_CONTROLS;
      setControlsWidth(fit(now + (e.key === "ArrowRight" ? 24 : -24)));
    } else if (e.key === "Home" || e.key === "Escape") {
      setControlsWidth(null);
    }
  }

  return (
    <div className="illustrate-grid" ref={gridRef} style={controlsWidth ? ({ "--controls-width": `${controlsWidth}px` } as CSSProperties) : undefined}>
      <div className="illustrate-controls">
        <IllustrateChapter {...chapter} slotRef={setCodexSlot} />
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
          dock={dock}
          codexSlot={codexSlot}
        />
      </div>
      <div
        className="column-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Column divider"
        title="Drag to resize the columns; double-click to reset"
        tabIndex={0}
        onPointerDown={drag}
        onDoubleClick={() => setControlsWidth(null)}
        onKeyDown={nudge}
      />
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
            starting={start?.source ?? null}
            used={{ header: made.header?.from ?? null, footer: made.footer?.from ?? null }}
          />
        )}
      </div>
      {/* Size, Queue and the queue's status are put here (see ComfyGenerate), so they stay at the bottom of the screen. */}
      <div className="generate-dock" ref={setDock} />
    </div>
  );
}
