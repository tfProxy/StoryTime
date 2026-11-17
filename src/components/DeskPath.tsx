"use client";

import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clearDeskMove } from "@/lib/deskMove";
import { chapterImageUrl, IMAGE_SLOTS, type ImageSlot, type ImageVersions } from "@/lib/imageSlots";
import ChapterImage, { FullPicture } from "./ChapterImage";
import { FooterIcon, HeaderIcon, MiddleIcon } from "./PictureIcons";
import DeskLink from "./DeskLink";
import DeskVia from "./DeskVia";
import Prose from "./Prose";

const SHOW_CHAPTER = "desk-show-chapter";

/** Shows a chapter in the desk's story column: an earlier one's block unfolded, or the chapter's box. */
export function showDeskChapter(chapterId: string) {
  window.dispatchEvent(new CustomEvent(SHOW_CHAPTER, { detail: chapterId }));
}

/** An earlier chapter on the path to the one on the desk. */
export type PathBlock = {
  id: string;
  title: string;
  body: string;
  summary: string | null;
  /** The choice that leads to it; null for the story's first chapter. */
  via: string | null;
  /** It has a draft not used (draftMarks.ts). */
  unused: boolean;
  /** Its pictures: in its text when unfolded, as icons on its head when folded. */
  images: ImageVersions;
};

const SLOT_ICON: Record<ImageSlot, () => React.JSX.Element> = { header: HeaderIcon, middle: MiddleIcon, footer: FooterIcon };
const SLOT_NAME: Record<ImageSlot, string> = { header: "header picture", middle: "middle picture", footer: "footer picture" };

/** A folded block's icon for one of its pictures; it shows the picture full screen. */
function PictureIcon({ chapterId, slot, version }: { chapterId: string; slot: ImageSlot; version: number }) {
  const [open, setOpen] = useState(false);
  const Icon = SLOT_ICON[slot];
  return (
    <>
      <button type="button" className="desk-block-picture" title={`Show the ${SLOT_NAME[slot]}`} aria-label={`Show the ${SLOT_NAME[slot]}`} onClick={() => setOpen(true)}>
        <Icon />
      </button>
      {open && createPortal(<FullPicture src={chapterImageUrl(chapterId, slot, version)} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/**
 * The chapter on the desk, read and not edited (`?read=1`): in place of its box, its title with ✎ to edit it, then its
 * text with its pictures. `onText` hears the text, as the box's would, for the desk's "In this chapter".
 */
export function DeskReading({
  chapterId,
  reading,
  onText,
}: {
  chapterId: string;
  reading: { title: string; body: string; via: string | null; images: ImageVersions };
  onText: (text: string, body: string) => void;
}) {
  const { title, body, via, images } = reading;
  useEffect(() => onText(`${title}\n\n${body}`, body), [title, body, onText]);
  return (
    <>
      {via && <DeskVia label={via} />}
      <section className="desk-box desk-reading" aria-label="The chapter">
        <div className="desk-reading-head">
          <h2>{title}</h2>
          <DeskLink href={`/c/${chapterId}/desk`} className="desk-block-edit" aria-label={`Edit “${title}”`} title="Edit this chapter">
            ✎
          </DeskLink>
        </div>
        <div className="desk-block-text">
          <ChapterImage chapterId={chapterId} slot="header" version={images.header} />
          <Prose text={body} middle={<ChapterImage chapterId={chapterId} slot="middle" version={images.middle} />} />
          <ChapterImage chapterId={chapterId} slot="footer" version={images.footer} />
        </div>
      </section>
    </>
  );
}

/**
 * The path above the chapter's box: each earlier chapter is a block that folds. Folded, it shows its number, title and
 * summary, and an icon for each of its pictures; unfolded, its title and text, with its pictures where the reading
 * page puts them. ✎ makes it the chapter on the desk. Every block starts folded, however
 * the desk was opened; "Unfold all" or "Fold all" at the top.
 */
export default function DeskPath({ blocks, onQuote }: { storyId?: string; blocks: PathBlock[]; onQuote?: (words: string) => void }) {
  // Words selected in an unfolded block's text, and the block: "Add as a fact…" shows under that block's text.
  const [picked, setPicked] = useState<{ id: string; words: string } | null>(null);
  const quoting = !!onQuote;
  useEffect(() => {
    if (!quoting) return;
    const onChange = () => {
      const sel = document.getSelection();
      const words = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      const at = (n: Node | null | undefined) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>(".desk-block-text[data-block]");
      const from = at(sel?.anchorNode);
      const id = words && from && from === at(sel?.focusNode) ? from.dataset.block! : null;
      setPicked((p) => (id ? (p?.id === id && p.words === words ? p : { id, words }) : null));
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [quoting]);
  // Every chapter opened on the desk (from outside or by a move within it) starts with the earlier chapters folded, so
  // the chapter being edited is what shows (the owner's choice, 2026-11-13).
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  useEffect(() => clearDeskMove(), []);

  // "since “chapter”" on a fact (showDeskChapter): an earlier chapter's block unfolds and comes into view; any other
  // chapter is the one on the desk, so its box does.
  useEffect(() => {
    const onShow = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!blocks.some((b) => b.id === id)) {
        document.querySelector(".desk-box")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      setFolds((f) => ({ ...f, [id]: true }));
      // After the block has unfolded, so it is scrolled to at its full height.
      requestAnimationFrame(() => document.getElementById(`desk-block-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    window.addEventListener(SHOW_CHAPTER, onShow);
    return () => window.removeEventListener(SHOW_CHAPTER, onShow);
  }, [blocks]);

  if (blocks.length === 0) return null;
  const set = setFolds;
  const anyOpen = blocks.some((b) => folds[b.id]);
  return (
    <section className="desk-path" aria-label="The path so far">
      <div className="row desk-path-head">
        <span className="desk-spacer" />
        <button type="button" className="secondary" onClick={() => set(Object.fromEntries(blocks.map((b) => [b.id, !anyOpen])))}>
          {anyOpen ? "Fold all" : "Unfold all"}
        </button>
      </div>
      {blocks.map((b, i) => {
        const open = !!folds[b.id];
        return (
          <Fragment key={b.id}>
            {b.via && <DeskVia label={b.via} />}
            <article id={`desk-block-${b.id}`} className={open ? "desk-block open" : "desk-block"} aria-label={`Chapter ${i + 1}: ${b.title}`}>
              <div className="desk-block-head">
                <button type="button" className="desk-block-fold" aria-expanded={open} onClick={() => set({ ...folds, [b.id]: !open })}>
                  <strong>
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span> {i + 1} · {b.title}
                  </strong>
                  {!open && <small>{b.summary?.trim() || "No summary yet"}</small>}
                </button>
                {!open &&
                  IMAGE_SLOTS.map((slot) => {
                    const v = b.images[slot];
                    return v === null ? null : <PictureIcon key={slot} chapterId={b.id} slot={slot} version={v} />;
                  })}
                {b.unused &&<span className="desk-chip draft-mark">Draft not used</span>}
                <DeskLink href={`/c/${b.id}/desk`} className="desk-block-edit" aria-label={`Edit “${b.title}”`} title="Edit this chapter here">
                  ✎
                </DeskLink>
              </div>
              {open && (
                <div className="desk-block-text" data-block={b.id}>
                  <ChapterImage chapterId={b.id} slot="header" version={b.images.header} />
                  <Prose text={b.body} middle={<ChapterImage chapterId={b.id} slot="middle" version={b.images.middle} />} />
                  <ChapterImage chapterId={b.id} slot="footer" version={b.images.footer} />
                  {onQuote && picked?.id === b.id && (
                    <div className="row desk-block-quote">
                      {/* Pressing it keeps the selection (the focus would clear it). */}
                      <button type="button" className="secondary desk-add-fact" onMouseDown={(e) => e.preventDefault()} onClick={() => onQuote(picked.words)}>
                        Add as a fact…
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
          </Fragment>
        );
      })}
    </section>
  );
}
