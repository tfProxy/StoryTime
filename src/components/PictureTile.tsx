"use client";

import { useEffect, useRef, useState } from "react";
import { IMAGE_SLOTS, type ImageSlot } from "@/lib/imageSlots";
import { imageUrl, type ComfyImage } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import { SLOT_NAMES, type PictureSaver } from "./usePictureSaver";
import { FooterIcon, HeaderIcon, MenuIcon, PinIcon } from "./PictureIcons";

export const SLOT_TITLES: Record<ImageSlot, string> = { header: "Header", footer: "Footer" };
export const SLOT_ICONS: Record<ImageSlot, () => React.JSX.Element> = { header: HeaderIcon, footer: FooterIcon };

type Props = {
  comfyUrl: string;
  image: ComfyImage;
  /** Tells this tile's save buttons apart from the others'. */
  tileKey: string;
  /** The picture job's record in StoryTime, or null when it couldn't be recorded. */
  jobId: string | null;
  /** Which of the job's pictures this is. */
  index: number;
  saver: PictureSaver;
  /** The slots this picture is saved in now (the chapter's header, footer, or both). */
  inUse?: ImageSlot[];
  /** Called to make new pictures starting from this one. */
  onStart?: (image: ComfyImage) => void;
  /** A short line under the picture, such as its seed and checkpoint. */
  caption?: string;
  /** Called to bring back the prompt this picture was made with. */
  onLoadPrompt?: () => void;
  /** Whether the author pinned or rejected it, and how to change that (no buttons without it). */
  mark?: PictureMark | null;
  onMark?: (mark: PictureMark | null) => void;
  /** Called to show the picture full size; without it (or with Ctrl, Cmd, Shift or the middle button) it opens in a new tab. */
  onOpen?: () => void;
};

/**
 * One picture from ComfyUI. Over it: pin and reject, use as the chapter's header or footer, and a ☰ menu
 * with the rest (start from it, load its prompt, open it in a new tab); and, when it is the chapter's header
 * or footer now, a badge saying so. A picture ComfyUI no longer has (or can't be reached for) says so, and
 * can't be used.
 */
export default function PictureTile({ comfyUrl, image, tileKey, jobId, index, saver, inUse = [], onStart, caption, onLoadPrompt, mark = null, onMark, onOpen }: Props) {
  const [missing, setMissing] = useState(false);
  const src = imageUrl(comfyUrl, image);
  // A picture whose job couldn't be recorded has nothing to keep a mark on.
  const unmarkable = jobId === null ? "StoryTime couldn't record this picture, so it can't be pinned or rejected" : undefined;
  return (
    <li className={`picture-tile${mark ? ` ${mark}` : ""}${inUse.length ? " in-use" : ""}`}>
      <div className="picture-frame">
        {missing ? (
          <p className="meta picture-missing" role="status">
            ComfyUI no longer has this picture, or can&apos;t be reached.
          </p>
        ) : (
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            title="Open full size"
            onClick={(e) => {
              if (!onOpen || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onOpen();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI */}
            <img src={src} alt={`Picture ${image.filename}`} loading="lazy" onError={() => setMissing(true)} />
          </a>
        )}
        {inUse.length > 0 && (
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
        )}
        <div className="picture-marks">
          {onMark && (
            <>
              <button
                type="button"
                aria-label={mark === "pinned" ? "Unpin" : "Pin"}
                aria-pressed={mark === "pinned"}
                title={unmarkable ?? (mark === "pinned" ? "Unpin" : "Pin: keep it in view as a contender")}
                disabled={jobId === null}
                onClick={() => onMark(mark === "pinned" ? null : "pinned")}
              >
                <PinIcon filled={mark === "pinned"} />
              </button>
              <button
                type="button"
                aria-label={mark === "rejected" ? "Restore" : "Reject"}
                title={unmarkable ?? (mark === "rejected" ? "Restore: bring it back from Rejected" : "Reject: hide it (it stays under Rejected)")}
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
            return (
              <button
                key={slot}
                type="button"
                aria-label={`Use as ${SLOT_NAMES[slot]}`}
                aria-pressed={used}
                aria-busy={saving}
                title={used ? `This is the chapter's ${SLOT_NAMES[slot]}` : `Use as the chapter's ${SLOT_NAMES[slot]}`}
                disabled={used || saver.saving !== null || missing}
                onClick={() => void saver.use(tileKey, image, jobId, index, slot)}
              >
                {saving ? "…" : <Icon />}
              </button>
            );
          })}
          <TileMenu
            items={[
              onStart && !missing && { label: "Start from this", title: "Make new pictures starting from this one", run: () => onStart(image) },
              onLoadPrompt && { label: "Load prompt", title: "Put this picture's prompt back in the prompt boxes", run: onLoadPrompt },
              !missing && { label: "Open in a new tab", href: src },
            ]}
          />
        </div>
      </div>
      {caption && <p className="meta picture-caption">{caption}</p>}
    </li>
  );
}

type MenuItem = { label: string; title?: string; run?: () => void; href?: string };

/** The ☰ button and the menu it opens: closed by choosing an item, Esc, or a click elsewhere. */
function TileMenu({ items }: { items: (MenuItem | false | undefined | null)[] }) {
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
