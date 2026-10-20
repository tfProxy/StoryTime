"use client";

import { useState } from "react";
import type { ImageSlot } from "@/lib/imageSlots";
import { imageUrl, type ComfyImage } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import type { PictureSaver } from "./usePictureSaver";
import PictureButtons, { InUseBadge, startItems } from "./PictureButtons";
import type { StartMode } from "./pictures";

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
  /** Called to make new pictures starting from this one: redrawn from the prompt, or edited by instruction. */
  onStart?: (image: ComfyImage, mode: StartMode) => void;
  /** Why it can't be edited by instruction now (no edit model installed), or null. */
  editBlocked?: string | null;
  /** A short line under the picture, such as its seed and checkpoint. */
  caption?: string;
  /** Called to bring back the prompt this picture was made with. */
  onLoadPrompt?: () => void;
  /** Whether the author pinned or rejected it, and how to change that (no buttons without it). */
  mark?: PictureMark | null;
  onMark?: (mark: PictureMark | null) => void;
  /** Called to show the picture full size; without it (or with Ctrl, Cmd, Shift or the middle button) it opens in a new tab. */
  onOpen?: () => void;
  /** Shows everything the picture was made with (the Info popup). */
  onInfo?: () => void;
};

/**
 * One picture from ComfyUI, with its buttons (see PictureButtons, the same in the full-size viewer) and,
 * when it is the chapter's header or footer now, a badge saying so. A picture ComfyUI no longer has (or
 * can't be reached for) says so, and can't be used.
 */
export default function PictureTile({ comfyUrl, image, tileKey, jobId, index, saver, inUse = [], onStart, editBlocked = null, caption, onLoadPrompt, mark = null, onMark, onOpen, onInfo }: Props) {
  const [missing, setMissing] = useState(false);
  const src = imageUrl(comfyUrl, image);
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
        <InUseBadge inUse={inUse} />
        <PictureButtons
          image={image}
          tileKey={tileKey}
          jobId={jobId}
          index={index}
          saver={saver}
          inUse={inUse}
          missing={missing}
          mark={mark}
          onMark={onMark}
          menu={[
            ...(onStart && !missing ? startItems((mode) => onStart(image, mode), editBlocked) : []),
            onLoadPrompt && { label: "Load prompt", title: "Put this picture's prompt back in the prompt boxes", run: onLoadPrompt },
            onInfo && { label: "Info", title: "Everything this picture was made with, to copy", run: onInfo },
            !missing && { label: "Open in a new tab", href: src },
          ]}
        />
      </div>
      {caption && <p className="meta picture-caption">{caption}</p>}
    </li>
  );
}
