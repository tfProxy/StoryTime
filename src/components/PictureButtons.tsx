"use client";

import { useEffect, useRef, useState } from "react";
import { IMAGE_SLOTS, type ImageSlot } from "@/lib/imageSlots";
import type { ComfyImage } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import { SLOT_NAMES, type PictureSaver } from "./usePictureSaver";
import { FooterIcon, HeaderIcon, MenuIcon, PinIcon } from "./PictureIcons";

// The buttons and badge on a picture, the same on a tile in the Pictures panel and in the full-size viewer.

const SLOT_TITLES: Record<ImageSlot, string> = { header: "Header", footer: "Footer" };
const SLOT_ICONS: Record<ImageSlot, () => React.JSX.Element> = { header: HeaderIcon, footer: FooterIcon };

/** On the picture's top left corner: which of the chapter's slots it is saved in now, if any. */
export function InUseBadge({ inUse }: { inUse: ImageSlot[] }) {
  if (inUse.length === 0) return null;
  return (
    <div className="picture-in-use">
      {inUse.map((slot) => {
        const Icon = SLOT_ICONS[slot];
        return (
          <span key={slot} title={`This is the chapter's ${SLOT_NAMES[slot]}`}>
            <Icon /> {SLOT_TITLES[slot]}
          </span>
        );
      })}
    </div>
  );
}

export type MenuItem = { label: string; title?: string; run?: () => void; href?: string };

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
  inUse: ImageSlot[];
  /** ComfyUI no longer has the picture, so it can't be used. */
  missing: boolean;
  /** Whether the author pinned or rejected it, and how to change that (no pin and reject buttons without it). */
  mark?: PictureMark | null;
  onMark?: (mark: PictureMark | null) => void;
  /** Words added to the pin and reject buttons' tooltips, such as their keys. */
  pinHint?: string;
  rejectHint?: string;
  /** What the ☰ menu offers; left out items are skipped. */
  menu: (MenuItem | false | undefined | null)[];
};

/**
 * On the picture's top right corner: pin and reject, use as the chapter's header or footer, and a ☰ menu
 * with the rest. The header and footer buttons are never `disabled`, only marked so, so the keyboard focus
 * stays on them while a picture is saved.
 */
export default function PictureButtons({ image, tileKey, jobId, index, saver, inUse, missing, mark = null, onMark, pinHint = "", rejectHint = "", menu }: Props) {
  // A picture whose job couldn't be recorded has nothing to keep a mark on.
  const unmarkable = jobId === null ? "StoryTime couldn't record this picture, so it can't be pinned or rejected" : undefined;
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
            aria-label={mark === "rejected" ? "Restore" : "Reject"}
            title={unmarkable ?? (mark === "rejected" ? `Restore: bring it back from Rejected${rejectHint}` : `Reject: hide it (it stays under Rejected)${rejectHint}`)}
            disabled={jobId === null}
            onClick={() => onMark(mark === "rejected" ? null : "rejected")}
          >
            {mark === "rejected" ? "↺" : "✕"}
          </button>
          <span className="picture-marks-gap" />
        </>
      )}
      {IMAGE_SLOTS.map((slot) => {
        const Icon = SLOT_ICONS[slot];
        const used = inUse.includes(slot);
        const saving = saver.saving === `${tileKey}-${slot}`;
        const off = used || saver.saving !== null || missing;
        return (
          <button
            key={slot}
            type="button"
            aria-label={`Use as ${SLOT_NAMES[slot]}`}
            aria-pressed={used}
            aria-disabled={off}
            aria-busy={saving}
            title={used ? `This is the chapter's ${SLOT_NAMES[slot]}` : `Use as the chapter's ${SLOT_NAMES[slot]}`}
            onClick={() => {
              if (!off) void saver.use(tileKey, image, jobId, index, slot);
            }}
          >
            {saving ? "…" : <Icon />}
          </button>
        );
      })}
      <PictureMenu items={menu} />
    </div>
  );
}

/** The ☰ button and the menu it opens: closed by choosing an item, Esc, or a click elsewhere. */
function PictureMenu({ items }: { items: (MenuItem | false | undefined | null)[] }) {
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
              <button
                key={item.label}
                type="button"
                role="menuitem"
                title={item.title}
                onClick={() => {
                  setOpen(false);
                  item.run?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
