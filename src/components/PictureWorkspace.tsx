"use client";

import type { ReactNode } from "react";
import type { ImageMade } from "@/lib/imageSlots";
import { slotsFor, type PictureSlot, type PictureTarget } from "@/lib/pictureTarget";
import type { PictureJob } from "@/lib/pictureJobs";
import { fromComfyImage, fromSaved, type StartPicture } from "@/lib/comfy/startPicture";
import ChapterImageEditor from "./ChapterImageEditor";
import ChapterPictures from "./ChapterPictures";
import { usePictureWorkspace } from "./usePictureWorkspace";
import type { Picture, PromptToLoad, StartRequest } from "./pictures";
import type { ReferenceRole } from "@/lib/comfy/references";

type Workspace = Omit<ReturnType<typeof usePictureWorkspace>, "gridProps" | "resizerProps" | "setDock">;

/** What a prompt panel needs from the workspace to fill its prompt boxes and make pictures. */
export type WorkspaceControls = Pick<Workspace, "loaded" | "refRequest" | "start" | "startMode" | "setStartMode" | "mask" | "setMask" | "paintNonce" | "editModels" | "addPictures" | "setPending" | "dock"> & {
  onClearStart: () => void;
  /** The target's pinned pictures, which the reference picker offers. */
  pinned: Picture[];
};

/** What a page's own destination card (instead of the header and footer cards) needs from the workspace. */
export type WorkspaceDestination = {
  startFrom: (picture: StartPicture, request: StartRequest, as?: { label: string; role: ReferenceRole }) => void;
  load: (p: PromptToLoad) => void;
  /** Why a picture can't be edited by instruction now, or null. */
  blocked: string | null;
  comfyUrl: string;
};

type Props = {
  target: PictureTarget;
  /** The target's picture jobs as the page opened, newest first, with their marks. */
  jobs: PictureJob[];
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  /** Each slot's saved picture version. Keep it memoised: the workspace takes it as a dependency. */
  versions: Partial<Record<PictureSlot, number | null>>;
  /** What each slot's saved picture was made from, when it came from ComfyUI. */
  made: Partial<Record<PictureSlot, ImageMade | null>>;
  /** The controls column: the prompt panel (and anything above it). */
  controls: (w: WorkspaceControls) => ReactNode;
  /** A codex page's own card for the entry's picture, in place of the chapter and cover cards. */
  destination?: (w: WorkspaceDestination) => ReactNode;
  /** For a codex entry: the chapter the page was opened from, which a picture can be saved from. */
  codexFrom?: { id: string; title: string } | null;
};

/**
 * A picture page's two columns: the controls on one side; the saved pictures, to compare new ones with, and
 * the new pictures on the other. On a phone the chosen header and footer come first (CSS moves them), then
 * the controls and the pictures. The state they share is kept by `usePictureWorkspace`.
 */
export default function PictureWorkspace({ target, jobs, titles, versions, made, controls, destination, codexFrom = null }: Props) {
  const { gridProps, resizerProps, setDock, ...w } = usePictureWorkspace(target, jobs, versions);
  const { comfy } = w;
  const slots = slotsFor(target);

  return (
    <div className="illustrate-grid" {...gridProps}>
      <div className="illustrate-controls">
        {controls({
          loaded: w.loaded,
          refRequest: w.refRequest,
          pinned: w.pictures.filter((p) => p.mark === "pinned"),
          start: w.start,
          startMode: w.startMode,
          setStartMode: w.setStartMode,
          mask: w.mask,
          setMask: w.setMask,
          paintNonce: w.paintNonce,
          editModels: w.editModels,
          onClearStart: () => w.setStart(null),
          addPictures: w.addPictures,
          setPending: w.setPending,
          dock: w.dock,
        })}
      </div>
      <div {...resizerProps} />
      <div className="illustrate-gallery">
        {/* The saved pictures first, to compare the new ones with. */}
        <div className="image-editors">
          {destination
            ? destination({ startFrom: w.startFrom, load: w.load, blocked: w.blocked, comfyUrl: comfy.url })
            : slots.map((slot) =>
                slot === "codex" ? null : (
                  <ChapterImageEditor
                    key={slot}
                    target={target}
                    slot={slot}
                    version={versions[slot] ?? null}
                    made={made[slot] ?? null}
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
                ),
              )}
        </div>
        {comfy.url && (
          <ChapterPictures
            target={target}
            codexFrom={codexFrom}
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
            used={Object.fromEntries(slots.map((slot) => [slot, made[slot]?.from ?? null]))}
          />
        )}
      </div>
      {/* Size, Queue and the queue's status are put here (see ComfyGenerate), so they stay at the bottom of the screen. */}
      <div className="generate-dock" ref={setDock} />
    </div>
  );
}
