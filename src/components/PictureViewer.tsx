"use client";

import { useEffect, useRef, useState } from "react";
import { IMAGE_SLOTS, type ImageSlot } from "@/lib/imageSlots";
import { imageUrl } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import { SLOT_NAMES, type PictureSaver } from "./usePictureSaver";
import { pictureCaption, type Picture } from "./pictures";

// How far a finger has to move sideways to count as a swipe.
const SWIPE_PX = 50;

type Props = {
  comfyUrl: string;
  /** The pictures of the view, in the order they are shown. */
  list: Picture[];
  /** The picture being shown. */
  current: Picture;
  onShow: (key: string) => void;
  onClose: () => void;
  onMark: (picture: Picture, mark: PictureMark | null) => void;
  onLoadPrompt: (picture: Picture) => void;
  saver: PictureSaver;
  /** The panel's last message (a mark, a save), repeated here because the panel is hidden behind. */
  status: { ok: boolean; text: string; undo?: () => void } | null;
};

/**
 * One picture as large as the screen allows, with the view's others a key or a swipe away: ← and → move,
 * P pins, X rejects (or restores), Esc closes. A modal <dialog>, so the page behind can't be reached.
 */
export default function PictureViewer({ comfyUrl, list, current, onShow, onClose, onMark, onLoadPrompt, saver, status }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<number | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const at = list.findIndex((p) => p.key === current.key);
  const prev = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const src = imageUrl(comfyUrl, current.image);

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
        <p className="viewer-prompt" title={current.prompt}>
          {current.prompt}
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
        {missing === src ? (
          <p className="viewer-missing">ComfyUI no longer has this picture, or can&apos;t be reached.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI
          <img key={src} src={src} alt={`Picture ${current.image.filename}`} draggable={false} onError={() => setMissing(src)} />
        )}
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
        <div className="viewer-actions">
          <button type="button" aria-pressed={current.mark === "pinned"} disabled={!markable} onClick={pin} title="Pin or unpin (P)">
            {current.mark === "pinned" ? "★ Unpin" : "☆ Pin"}
          </button>
          <button type="button" disabled={!markable} onClick={reject} title={current.mark === "rejected" ? "Restore (X)" : "Reject (X)"}>
            {current.mark === "rejected" ? "↺ Restore" : "✕ Reject"}
          </button>
          {IMAGE_SLOTS.map((slot: ImageSlot) => (
            <button
              key={slot}
              type="button"
              aria-label={`Use as ${SLOT_NAMES[slot]}`}
              disabled={saver.saving !== null || missing === src}
              onClick={() => void saver.use(current.key, current.image, current.jobId, slot)}
            >
              {saver.saving === `${current.key}-${slot}` ? "Saving…" : slot === "header" ? "Use as header" : "Use as footer"}
            </button>
          ))}
          <button type="button" onClick={() => onLoadPrompt(current)}>
            Load prompt
          </button>
          <a href={src} target="_blank" rel="noreferrer" className="viewer-link">
            Open in a new tab
          </a>
        </div>
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
