"use client";

import { useEffect, useRef, useState } from "react";
import type { ImageSlot } from "@/lib/imageSlots";
import { imageUrl } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import type { PictureSaver } from "./usePictureSaver";
import { pictureCaption, type Picture, type StartMode } from "./pictures";
import PictureButtons, { InUseBadge, startItems } from "./PictureButtons";

// How far a finger has to move sideways to count as a swipe.
const SWIPE_PX = 50;

type Props = {
  comfyUrl: string;
  /** The pictures of the view, in the order they are shown. */
  list: Picture[];
  /** The picture being shown. */
  current: Picture;
  /** The slots it is saved in now (the chapter's header, footer, or both). */
  inUse: ImageSlot[];
  onShow: (key: string) => void;
  onClose: () => void;
  onMark: (picture: Picture, mark: PictureMark | null) => void;
  onLoadPrompt: (picture: Picture) => void;
  /** Shows everything the picture was made with (the Info popup, over the viewer). */
  onInfo: (picture: Picture) => void;
  /** Makes new pictures starting from the one shown: redrawn from the prompt, or edited by instruction. */
  onStart?: (picture: Picture, mode: StartMode) => void;
  /** Why it can't be edited by instruction now, or null. */
  editBlocked?: string | null;
  saver: PictureSaver;
  /** The panel's last message (a mark, a save), repeated here because the panel is hidden behind. */
  status: { ok: boolean; text: string; undo?: () => void } | null;
};

/**
 * One picture as large as the screen allows, with the view's others a key or a swipe away: ← and → move,
 * P pins, X rejects (or restores), Esc closes. A modal <dialog>, so the page behind can't be reached.
 */
export default function PictureViewer({ comfyUrl, list, current, inUse, onShow, onClose, onMark, onLoadPrompt, onInfo, onStart, editBlocked = null, saver, status }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<number | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const at = list.findIndex((p) => p.key === current.key);
  const prev = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const src = imageUrl(comfyUrl, current.image);
  // The picture's shape: as loaded, or until then the size it was made at.
  const [loaded, setLoaded] = useState<{ src: string; ratio: number } | null>(null);
  const ratio = loaded?.src === src ? loaded.ratio : current.width > 0 && current.height > 0 ? current.width / current.height : 4 / 3;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // The neighbours are fetched ahead, so moving to them is quick.
  useEffect(() => {
    for (const p of [prev, next]) if (p) new Image().src = imageUrl(comfyUrl, p.image);
  }, [comfyUrl, prev, next]);

  const markable = current.jobId !== null;
  const pin = () => markable && onMark(current, current.mark === "pinned" ? null : "pinned");
  const reject = () => markable && onMark(current, current.mark === "rejected" ? null : "rejected");

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowLeft" && prev) onShow(prev.key);
    else if (e.key === "ArrowRight" && next) onShow(next.key);
    else if (e.key === "p" || e.key === "P") pin();
    else if (e.key === "x" || e.key === "X") reject();
    else return;
    e.preventDefault();
  }

  return (
    <dialog
      ref={dialog}
      className="picture-viewer"
      aria-label="Picture viewer"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="viewer-top">
        <span className="viewer-count" role="status">
          {at + 1} of {list.length}
        </span>
        <p className="viewer-prompt" title={current.instruction ?? current.prompt}>
          {current.instruction ? `Edit: ${current.instruction}` : current.prompt}
        </p>
        <button type="button" className="viewer-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div
        className="viewer-stage"
        onPointerDown={(e) => {
          swipe.current = e.clientX;
        }}
        onPointerUp={(e) => {
          const from = swipe.current;
          swipe.current = null;
          if (from === null) return;
          const dx = e.clientX - from;
          if (dx <= -SWIPE_PX && next) onShow(next.key);
          else if (dx >= SWIPE_PX && prev) onShow(prev.key);
        }}
      >
        {/* Sized to the picture's shape, so its buttons sit on its corners as they do on a tile. */}
        <div className="viewer-frame" style={{ "--ratio": ratio } as React.CSSProperties}>
          {missing === src ? (
            <p className="viewer-missing">ComfyUI no longer has this picture, or can&apos;t be reached.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI
            <img
              key={src}
              src={src}
              alt={`Picture ${current.image.filename}`}
              draggable={false}
              onError={() => setMissing(src)}
              onLoad={(e) => {
                const i = e.currentTarget;
                if (i.naturalWidth > 0 && i.naturalHeight > 0) setLoaded({ src, ratio: i.naturalWidth / i.naturalHeight });
              }}
            />
          )}
          <InUseBadge inUse={inUse} />
          <PictureButtons
            image={current.image}
            tileKey={current.key}
            jobId={current.jobId}
            index={current.index}
            saver={saver}
            inUse={inUse}
            missing={missing === src}
            mark={current.mark}
            onMark={(next) => onMark(current, next)}
            pinHint=" (P)"
            rejectHint=" (X)"
            menu={[
              ...(onStart && missing !== src ? startItems((mode) => onStart(current, mode), editBlocked) : []),
              { label: "Load prompt", title: "Put this picture's prompt back in the prompt boxes", run: () => onLoadPrompt(current) },
              { label: "Info", title: "Everything this picture was made with, to copy", run: () => onInfo(current) },
              missing !== src && { label: "Open in a new tab", href: src },
            ]}
          />
        </div>
        {prev && (
          <button type="button" className="viewer-step viewer-prev" aria-label="Previous picture" title="Previous (←)" onClick={() => onShow(prev.key)}>
            ‹
          </button>
        )}
        {next && (
          <button type="button" className="viewer-step viewer-next" aria-label="Next picture" title="Next (→)" onClick={() => onShow(next.key)}>
            ›
          </button>
        )}
      </div>
      <div className="viewer-bottom">
        <p className="viewer-caption">
          {pictureCaption(current)}
          <span className="viewer-keys"> · ← → move · P pin · X reject · Esc close</span>
        </p>
        {status && (
          <p className={status.ok ? "viewer-ok" : "viewer-error"}>
            {status.text}
            {status.undo && (
              <>
                {" "}
                <button type="button" className="viewer-undo" onClick={status.undo}>
                  Undo
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </dialog>
  );
}
