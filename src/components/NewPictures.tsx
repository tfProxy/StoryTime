"use client";

import { useState } from "react";
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { ComfyImage } from "@/lib/comfy/client";
import PictureTile from "./PictureTile";
import { usePictureSaver } from "./usePictureSaver";

/** One picture made on this visit, with what made it. `jobId` is the job's record in StoryTime, or null when it couldn't be recorded. */
export type Candidate = {
  key: string;
  image: ComfyImage;
  jobId: string | null;
  prompt: string;
  negative: string;
  seed: number;
  checkpoint: string;
  width: number;
  height: number;
  /** Strength, when the picture was made from a starting picture. */
  denoise: number | null;
  moment: ImageMoment;
};

const SHOWN_PROMPT = 160;
const MOMENT_NAMES: Record<ImageMoment, string> = { start: "Chapter start", end: "Chapter end" };

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** What tells pictures from the same prompt apart: the seed and the settings. */
export function pictureCaption(c: { seed: number; checkpoint: string; width: number; height: number; denoise: number | null }): string {
  return [
    c.checkpoint.replace(/\.(safetensors|ckpt)$/i, ""),
    `${c.width} × ${c.height}`,
    `seed ${c.seed}`,
    c.denoise !== null && `strength ${c.denoise}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Pictures grouped by the prompt and negative prompt that made them, the newest group first. */
function byPrompt(candidates: Candidate[]): Candidate[][] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.prompt}\u0000${c.negative}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()];
}

type Props = {
  chapterId: string;
  comfyUrl: string;
  /** Newest first. */
  candidates: Candidate[];
  onClear: () => void;
  /** Called to make new pictures starting from one of these. */
  onStart?: (image: ComfyImage) => void;
};

/** The pictures made on this visit, grouped by prompt, with Clear at the top where it is easy to reach. */
export default function NewPictures({ chapterId, comfyUrl, candidates, onClear, onStart }: Props) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const saver = usePictureSaver(chapterId, comfyUrl, setStatus);
  const groups = byPrompt(candidates);

  return (
    <section className="ai-panel new-pictures" aria-labelledby="new-pictures-title">
      <div className="new-pictures-bar">
        <h2 id="new-pictures-title">
          New pictures{candidates.length > 0 && <span className="meta"> ({candidates.length})</span>}
        </h2>
        {candidates.length > 0 && (
          <button type="button" className="secondary" onClick={() => { onClear(); setStatus(null); }} title="They stay in ComfyUI and under Past pictures">
            Clear these pictures
          </button>
        )}
      </div>
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
      {candidates.length === 0 && <p className="meta" style={{ margin: 0 }}>Pictures you make appear here, grouped by prompt.</p>}
      {groups.map((group) => {
        const first = group[0];
        const moments = [...new Set(group.map((c) => MOMENT_NAMES[c.moment]))].join(", ");
        return (
          <div key={first.key} className="picture-group">
            <div className="picture-group-head">
              <p style={{ margin: 0 }} title={first.prompt}>
                {short(first.prompt, SHOWN_PROMPT)}
              </p>
              <p className="meta" style={{ margin: 0 }}>
                {[moments, group.length === 1 ? "1 picture" : `${group.length} pictures`, first.negative && `not: ${short(first.negative, 60)}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <ul className="candidates" aria-label="Pictures from this prompt">
              {group.map((c) => (
                <PictureTile
                  key={c.key}
                  comfyUrl={comfyUrl}
                  image={c.image}
                  tileKey={c.key}
                  jobId={c.jobId}
                  saver={saver}
                  caption={pictureCaption(c)}
                  onStart={onStart}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
