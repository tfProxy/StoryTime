"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { chapterImageUrl, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import { BrushIcon, FooterIcon, HeaderIcon } from "./PictureIcons";

// Summaries in the outline: each chapter has its own toggle, and one button shows or hides them all.
// `n` counts how often "all" was pressed, so a chapter opened or closed by hand follows the next press.
const Ctx = createContext<{ open: boolean; n: number; setAll: (open: boolean) => void }>({ open: false, n: 0, setAll: () => {} });

export function SummaryProvider({ children }: { children: ReactNode }) {
  const [all, setAll] = useState({ open: false, n: 0 });
  return (
    <Ctx.Provider value={{ ...all, setAll: (open) => setAll((a) => ({ open, n: a.n + 1 })) }}>{children}</Ctx.Provider>
  );
}

export function ToggleAllSummaries() {
  const { open, setAll } = useContext(Ctx);
  return (
    <button type="button" className="secondary" onClick={() => setAll(!open)}>
      {open ? "Hide all summaries" : "Show all summaries"}
    </button>
  );
}

const SLOT_LABEL: Record<ImageSlot, string> = { header: "Header picture", footer: "Footer picture" };

/**
 * A small icon button that opens a chapter's header or footer picture in a popup. It sits in the chapter's row,
 * which is the <summary> of its branch, so the click must not fold the branch; and the popup is drawn into
 * <body>, because a click inside it would otherwise count as a click on the row.
 */
function PictureButton({ chapterId, title, slot, version }: { chapterId: string; title: string; slot: ImageSlot; version: number }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);
  const label = `${SLOT_LABEL[slot]} of “${title}”`;
  return (
    <>
      <button
        type="button"
        className="outline-action outline-icon"
        title={`Show the ${SLOT_LABEL[slot].toLowerCase()}`}
        aria-label={`Show the ${SLOT_LABEL[slot].toLowerCase()}`}
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        {slot === "header" ? <HeaderIcon /> : <FooterIcon />}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="outline-picture"
            aria-label={label}
            onClose={() => setOpen(false)}
            // A click on the dark area around the picture closes it.
            onClick={(e) => {
              if (e.target === e.currentTarget) e.currentTarget.close();
            }}
          >
            <div className="outline-picture-top">
              <h2>{label}</h2>
              <button type="button" className="secondary" aria-label="Close" title="Close (Esc)" onClick={() => dialog.current?.close()}>
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture of unknown size */}
            <img src={chapterImageUrl(chapterId, slot, version)} alt="" />
          </dialog>,
          document.body,
        )}
    </>
  );
}

// Sits inside the chapter's row, which is the <summary> of its branch, so clicks must not fold the branch.
// `children` (the 'read to here' link) sit right after the button. `via` is the choice that was taken to reach the chapter; it is shown ahead of the summary.
// After them come icons: the chapter's header and footer pictures (when it has them), and a paintbrush to its Illustrate page.
export function NodeSummary({
  chapterId,
  title,
  images,
  summary,
  via,
  children,
}: {
  chapterId: string;
  title: string;
  images: ImageVersions;
  summary: string | null;
  via: string | null;
  children?: ReactNode;
}) {
  const { open: allOpen, n } = useContext(Ctx);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (n > 0) setOpen(allOpen);
  }, [allOpen, n]);
  return (
    <>
      <span className="meta outline-actions">
        [
        <button
          type="button"
          className="outline-action"
          aria-expanded={open}
          title={open ? "Hide this chapter's summary" : "Show this chapter's summary"}
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          summary
        </button>
        {", "}
        {children}
        <span className="outline-icons">
          {images.header !== null && <PictureButton chapterId={chapterId} title={title} slot="header" version={images.header} />}
          {images.footer !== null && <PictureButton chapterId={chapterId} title={title} slot="footer" version={images.footer} />}
          <Link
            className="outline-action outline-icon"
            href={`/c/${chapterId}/illustrate`}
            title="Make pictures for this chapter"
            aria-label="Illustrate this chapter"
          >
            <BrushIcon />
          </Link>
        </span>
        ]
      </span>
      {open && (
        <span className="outline-summary" onClick={(e) => e.preventDefault()}>
          {via && <strong className="outline-via">{via}</strong>}
          {summary?.trim() || "No summary yet."}
        </span>
      )}
    </>
  );
}
