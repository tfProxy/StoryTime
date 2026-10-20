"use client";

import { useState } from "react";
import { IMAGE_SLOTS } from "@/lib/imageSlots";
import { imageUrl, type ComfyImage } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import { SLOT_NAMES, type PictureSaver } from "./usePictureSaver";

const SLOT_TITLES: Record<(typeof IMAGE_SLOTS)[number], string> = { header: "Header", footer: "Footer" };

type Props = {
  comfyUrl: string;
  image: ComfyImage;
  /** Tells this tile's save buttons apart from the others'. */
  tileKey: string;
  /** The picture job's record in StoryTime, or null when it couldn't be recorded. */
  jobId: string | null;
  saver: PictureSaver;
  /** Called to make new pictures starting from this one. */
  onStart?: (image: ComfyImage) => void;
  /** A short line under the picture, such as its seed and checkpoint. */
  caption?: string;
  /** Called to bring back the prompt this picture was made with. */
  onLoadPrompt?: () => void;
  /** Whether the author pinned or rejected it, and how to change that (no buttons without it). */
  mark?: PictureMark | null;
  onMark?: (mark: PictureMark | null) => void;
};

/**
 * One picture from ComfyUI with the buttons to use it as the chapter's header or footer, and to pin or
 * reject it. A picture ComfyUI no longer has (or can't be reached for) says so, and can't be used.
 */
export default function PictureTile({ comfyUrl, image, tileKey, jobId, saver, onStart, caption, onLoadPrompt, mark = null, onMark }: Props) {
  const [missing, setMissing] = useState(false);
  const src = imageUrl(comfyUrl, image);
  // A picture whose job couldn't be recorded has nothing to keep a mark on.
  const unmarkable = jobId === null ? "StoryTime couldn't record this picture, so it can't be pinned or rejected" : undefined;
  return (
    <li className={`picture-tile${mark ? ` ${mark}` : ""}`}>
      <div className="picture-frame">
        {missing ? (
          <p className="meta picture-missing" role="status">
            ComfyUI no longer has this picture, or can&apos;t be reached.
          </p>
        ) : (
          <a href={src} target="_blank" rel="noreferrer" title="Open full size">
            {/* eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI */}
            <img src={src} alt={`Picture ${image.filename}`} loading="lazy" onError={() => setMissing(true)} />
          </a>
        )}
        {onMark && (
          <div className="picture-marks">
            <button
              type="button"
              aria-label={mark === "pinned" ? "Unpin" : "Pin"}
              aria-pressed={mark === "pinned"}
              title={unmarkable ?? (mark === "pinned" ? "Unpin" : "Pin: keep it in view as a contender")}
              disabled={jobId === null}
              onClick={() => onMark(mark === "pinned" ? null : "pinned")}
            >
              {mark === "pinned" ? "★" : "☆"}
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
          </div>
        )}
      </div>
      {caption && <p className="meta picture-caption">{caption}</p>}
      <div className="tile-actions">
        <span className="meta">Use as</span>
        {IMAGE_SLOTS.map((slot) => (
          <button
            key={slot}
            type="button"
            className="secondary"
            aria-label={`Use as ${SLOT_NAMES[slot]}`}
            disabled={saver.saving !== null || missing}
            onClick={() => void saver.use(tileKey, image, jobId, slot)}
          >
            {saver.saving === `${tileKey}-${slot}` ? "Saving…" : SLOT_TITLES[slot]}
          </button>
        ))}
        {onStart && (
          <button type="button" className="secondary" disabled={missing} onClick={() => onStart(image)}>
            Start from this
          </button>
        )}
        {onLoadPrompt && (
          <button type="button" className="secondary" onClick={onLoadPrompt} title="Put this picture's prompt back in the prompt boxes">
            Load prompt
          </button>
        )}
      </div>
    </li>
  );
}
