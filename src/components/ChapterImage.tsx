"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chapterImageUrl, type ImageSlot } from "@/lib/imageSlots";

/**
 * A chapter's header, middle or footer picture, where the chapter is read. Nothing when the slot is empty.
 * Clicking it (or Enter) opens it full screen; a click anywhere or Esc closes it. The popup is put on
 * <body> so the picture stays a bare <img> among the chapter's paragraphs.
 */
export default function ChapterImage({ chapterId, slot, version }: { chapterId: string; slot: ImageSlot; version: number | null }) {
  const [open, setOpen] = useState(false);
  if (version === null) return null;
  const src = chapterImageUrl(chapterId, slot, version);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture of unknown size */}
      <img
        className={`chapter-image chapter-image-${slot}`}
        src={src}
        alt=""
        role="button"
        tabIndex={0}
        aria-label="Show the picture full screen"
        title="Show full screen"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && createPortal(<FullPicture src={src} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function FullPicture({ src, onClose }: { src: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="chapter-image-full"
      aria-label="Picture"
      onClick={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button type="button" className="chapter-image-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
        ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture of unknown size */}
      <img src={src} alt="" />
    </dialog>
  );
}
