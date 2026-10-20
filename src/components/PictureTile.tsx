"use client";

import { useState } from "react";
import { IMAGE_SLOTS } from "@/lib/imageSlots";
import { imageUrl, type ComfyImage } from "@/lib/comfy/client";
import { SLOT_NAMES, type PictureSaver } from "./usePictureSaver";

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
};

/**
 * One picture from ComfyUI with the buttons to use it as the chapter's header or footer. A picture ComfyUI
 * no longer has (or can't be reached for) says so, and can't be used.
 */
export default function PictureTile({ comfyUrl, image, tileKey, jobId, saver, onStart }: Props) {
  const [missing, setMissing] = useState(false);
  const src = imageUrl(comfyUrl, image);
  return (
    <li className="picture-tile">
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
      <div className="row" style={{ flexWrap: "wrap" }}>
        {IMAGE_SLOTS.map((slot) => (
          <button key={slot} type="button" className="secondary" disabled={saver.saving !== null || missing} onClick={() => void saver.use(tileKey, image, jobId, slot)}>
            {saver.saving === `${tileKey}-${slot}` ? "Saving…" : `Use as ${SLOT_NAMES[slot]}`}
          </button>
        ))}
        {onStart && (
          <button type="button" className="secondary" disabled={missing} onClick={() => onStart(image)}>
            Start from this
          </button>
        )}
      </div>
    </li>
  );
}
