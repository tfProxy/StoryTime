"use client";

import { useEffect, useRef, useState } from "react";
import type { PictureSlot } from "@/lib/pictureTarget";
import type { ComfyImage } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import { SLOT_NAMES, slotOf, type PictureSaver } from "./usePictureSaver";
import { CoverIcon, FooterIcon, HeaderIcon, MenuIcon, PencilIcon, PinIcon, TrashIcon } from "./PictureIcons";
import type { StartRequest } from "./pictures";

// The buttons and badge on a picture, the same on a tile in the Pictures panel and in the full-size viewer.

const SLOT_TITLES: Record<PictureSlot, string> = { header: "Header", footer: "Footer", cover: "Cover" };
const SLOT_ICONS: Record<PictureSlot, () => React.JSX.Element> = { header: HeaderIcon, footer: FooterIcon, cover: CoverIcon };

/** On the picture's top left corner: which slots (the chapter's, or the story's cover) it is saved in now, if any, and whether it is the picture being edited or redrawn. */
export function InUseBadge({ inUse, editing = false, isNew = false }: { inUse: PictureSlot[]; editing?: boolean; isNew?: boolean }) {
  if (inUse.length === 0 && !editing && !isNew) return null;
  return (
    <div className="picture-in-use">
      {isNew && (
        <span className="picture-new" title="Finished while you were away">
          ✦ New
        </span>
      )}
      {editing && (
        <span title="New pictures are being made from this one">
          <PencilIcon /> Editing
        </span>
      )}
      {inUse.map((slot) => {
        const Icon = SLOT_ICONS[slot];
        return (
          <span key={slot} title={`This is ${slotOf(slot)}`}>
            <Icon /> {SLOT_TITLES[slot]}
          </span>
        );
      })}
    </div>
  );
}

export type MenuItem = { label: string; title?: string; run?: () => void; href?: string; icon?: () => React.JSX.Element; disabled?: boolean };

/**
 * The ☰ menu's two ways to start from a picture: redraw it from the prompt at a strength, or edit it by
 * instruction. `editBlocked` says why editing can't be used now (no edit model installed), or is null.
 */
export function startItems(start: (mode: StartRequest) => void, editBlocked: string | null): MenuItem[] {
  return [
    { label: "Redraw from this", title: "Make new pictures from the prompt, starting from this one", run: () => start("redraw") },
    { label: "Change part of this…", title: "Paint the part of this picture to redraw, and leave the rest as it is", run: () => start("paint") },
    { label: "Use as reference", title: "Add this picture to the References, to keep a character, item, place or style the same", run: () => start("reference") },
    {
      label: "Edit this",
      title: editBlocked ?? "Change this picture by telling an edit model what to change",
      disabled: editBlocked !== null,
      run: () => start("edit"),
    },
  ];
}

/** The ☰ menu's item that puts a picture's prompt back in the prompt boxes. */
export const loadPromptItem = (run: () => void): MenuItem => ({ label: "Load prompt", title: "Put this picture's prompt back in the prompt boxes", run });

/** The ☰ menu's item that opens a picture full size in a new tab. */
export const openItem = (href: string): MenuItem => ({ label: "Open in a new tab", href });

type Props = {
  image: ComfyImage;
  /** Tells this picture's save buttons apart from the others'. */
  tileKey: string;
  /** The picture job's record in StoryTime, or null when it couldn't be recorded. */
  jobId: string | null;
  /** Which of the job's pictures this is. */
  index: number;
  saver: PictureSaver;
  /** The slots this picture is saved in now. */
  inUse: PictureSlot[];
  /** ComfyUI no longer has the picture, so it can't be used. */
  missing: boolean;
  /** Whether the author pinned or trashed it ("rejected" as stored), and how to change that (no pin and trash buttons without it). */
  mark?: PictureMark | null;
  onMark?: (mark: PictureMark | null) => void;
  /** Words added to the pin and trash buttons' tooltips, such as their keys. */
  pinHint?: string;
  trashHint?: string;
  /** What the ☰ menu offers; left out items are skipped. */
  menu: (MenuItem | false | undefined | null)[];
};

/**
 * On the picture's top right corner: pin and trash, and a ☰ menu with Use as header or footer picture
 * and the rest. Which slot the picture is in now shows as a badge on its other corner (InUseBadge).
 */
export default function PictureButtons({ image, tileKey, jobId, index, saver, inUse, missing, mark = null, onMark, pinHint = "", trashHint = "", menu }: Props) {
  // A picture whose job couldn't be recorded has nothing to keep a mark on.
  const unmarkable = jobId === null ? "StoryTime couldn't record this picture, so it can't be pinned or trashed" : undefined;
  // Use as header and footer come first in the menu; the one it is already is shown, but can't be chosen.
  const slotItems: MenuItem[] = missing
    ? []
    : saver.slots.map((slot) => {
        const used = inUse.includes(slot);
        const saving = saver.saving === `${tileKey}-${slot}`;
        return {
          label: saving ? `Saving as the ${SLOT_NAMES[slot]}…` : used ? `This is the ${SLOT_NAMES[slot]}` : `Use as ${SLOT_NAMES[slot]}`,
          title: used ? `This is ${slotOf(slot)}` : `Use as ${slotOf(slot)}`,
          icon: SLOT_ICONS[slot],
          disabled: used || saver.saving !== null,
          run: () => void saver.use(tileKey, image, jobId, index, slot),
        };
      });
  return (
    <div className="picture-marks">
      {onMark && (
        <>
          <button
            type="button"
            aria-label={mark === "pinned" ? "Unpin" : "Pin"}
            aria-pressed={mark === "pinned"}
            title={unmarkable ?? (mark === "pinned" ? `Unpin${pinHint}` : `Pin: keep it in view as a contender${pinHint}`)}
            disabled={jobId === null}
            onClick={() => onMark(mark === "pinned" ? null : "pinned")}
          >
            <PinIcon filled={mark === "pinned"} />
          </button>
          <button
            type="button"
            aria-label={mark === "rejected" ? "Restore" : "Trash"}
            title={unmarkable ?? (mark === "rejected" ? `Restore: bring it back from Trashed${trashHint}` : `Trash: hide it (it stays under Trashed)${trashHint}`)}
            disabled={jobId === null}
            onClick={() => onMark(mark === "rejected" ? null : "rejected")}
          >
            {mark === "rejected" ? "↺" : <TrashIcon />}
          </button>
          <span className="picture-marks-gap" />
        </>
      )}
      <PictureMenu items={[...slotItems, ...menu]} />
    </div>
  );
}

/** The ☰ button and the menu it opens: closed by choosing an item, Esc, or a click elsewhere. */
export function PictureMenu({ items }: { items: (MenuItem | false | undefined | null)[] }) {
  const shown = items.filter((i): i is MenuItem => Boolean(i));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  if (shown.length === 0) return null;
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div
      className="tile-menu"
      ref={box}
      onKeyDown={(e) => {
        if (!open) return;
        const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") close();
        else if (e.key === "ArrowDown") all[(at + 1) % all.length]?.focus();
        else if (e.key === "ArrowUp") all[(at - 1 + all.length) % all.length]?.focus();
        else return;
        // Not for the viewer's keys too (Esc there closes the viewer, ← → move).
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button ref={button} type="button" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MenuIcon />
      </button>
      {open && (
        <div role="menu" className="tile-menu-list">
          {shown.map((item) =>
            item.href ? (
              <a key={item.label} role="menuitem" href={item.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                {item.label}
              </a>
            ) : (
              // Unavailable items are marked so rather than disabled, so the arrow keys still reach them.
              <button
                key={item.label}
                type="button"
                role="menuitem"
                title={item.title}
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return;
                  // Back to ☰, so the keyboard (and the viewer's keys) carry on from there.
                  close();
                  item.run?.();
                }}
              >
                {item.icon && <item.icon />}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
