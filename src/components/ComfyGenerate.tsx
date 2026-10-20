"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { saveSettings, useSettings } from "@/lib/settings";
import type { ComfySettings } from "@/lib/settingsSchema";
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { LoadedPrompt } from "./ImagePromptPanel";
import type { MadeWith, Picture } from "./pictures";
import { uploadStart, type StartPicture, type Uploaded } from "@/lib/comfy/startPicture";
import { describeWorkflow, fillWorkflow, filenamePrefix, parseWorkflow, randomSeed } from "@/lib/comfy/workflow";
import { cancelPrompt, listCheckpoints, queuePrompt, waitForPictures, type Progress } from "@/lib/comfy/client";

/** Sizes that suit SDXL (about one megapixel). */
const SIZES: { label: string; width: number; height: number }[] = [
  { label: "Landscape 1344 × 768", width: 1344, height: 768 },
  { label: "Wide 1536 × 640", width: 1536, height: 640 },
  { label: "Square 1024 × 1024", width: 1024, height: 1024 },
  { label: "Portrait 768 × 1344", width: 768, height: 1344 },
];

/** Records a finished job in StoryTime's log; returns the record's id. */
async function recordJob(job: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/picture-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't record the job (${res.status})`);
  return data.id;
}

function progressText(p: Progress): string {
  if (p.stage === "uploading") return "Sending the starting picture to ComfyUI…";
  if (p.stage === "queued") return p.ahead ? `Waiting in ComfyUI's queue (${p.ahead} ahead)…` : "Starting…";
  if (p.stage === "running") return `Step ${p.value} of ${p.max}…`;
  return "Loading the pictures…";
}

/** A job being made, as listed under the Make pictures button. */
type Queued = { key: string; prompt: string; count: number; progress: Progress };

const SHOWN_PROMPT = 70;

/**
 * Where the settings a loaded picture was made with differ from the current ones: the change to make and
 * how to describe it, or null when they match. The checkpoint and size are shared by every story, so they
 * change only when the author asks. A picture made from a starting picture took that picture's size, so
 * only its strength is offered.
 */
function otherSettings(made: MadeWith | null, now: ComfySettings): { patch: Partial<ComfySettings>; text: string } | null {
  if (!made) return null;
  const patch: Partial<ComfySettings> = {};
  const text: string[] = [];
  if (made.checkpoint && made.checkpoint !== now.checkpoint) {
    patch.checkpoint = made.checkpoint;
    text.push(made.checkpoint);
  }
  if (made.denoise === null && (made.width !== now.width || made.height !== now.height)) {
    patch.width = made.width;
    patch.height = made.height;
    text.push(`${made.width} × ${made.height}`);
  }
  if (made.denoise !== null && made.denoise !== now.denoise) {
    patch.denoise = made.denoise;
    text.push(`strength ${made.denoise}`);
  }
  return text.length ? { patch, text: text.join(", ") } : null;
}

type Props = {
  chapterId: string;
  storyId: string;
  moment: ImageMoment;
  prompt: string;
  negative: string;
  /** A prompt brought back from a saved picture; its seed can be used again. */
  loaded?: LoadedPrompt | null;
  /** The picture new pictures start from (image to image), or null to make them from the prompt alone. */
  start?: StartPicture | null;
  onClearStart?: () => void;
  /** Called with each finished job's pictures. */
  onPictures?: (pictures: Picture[]) => void;
  /** Where to show the jobs being made (beside the new pictures); without it they show under the button. */
  queueSlot?: HTMLElement | null;
};

/** Makes pictures from the prompt on the ComfyUI machine; the pictures go to `onPictures`. */
export default function ComfyGenerate({ chapterId, storyId, moment, prompt, negative, loaded = null, start = null, onClearStart, onPictures, queueSlot = null }: Props) {
  const settings = useSettings();
  const comfy = settings.comfy;
  const [checkpoints, setCheckpoints] = useState<string[] | null>(null);
  // The jobs being made, oldest first, as shown; `jobs` holds what Stop needs for each.
  const [queue, setQueue] = useState<Queued[]>([]);
  const jobs = useRef(new Map<string, { promptId: string | null; ctl: AbortController }>());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // The starting picture's upload to ComfyUI, kept so the next job from it doesn't send it again.
  const uploaded = useRef<{ key: string; upload: Promise<Uploaded> } | null>(null);
  // Each prompt loaded from a saved picture starts with a new seed again, until the author ticks the box.
  const [reuseSeed, setReuseSeed] = useState(false);
  const [seenLoad, setSeenLoad] = useState(0);
  if (loaded && loaded.nonce !== seenLoad) {
    setSeenLoad(loaded.nonce);
    setReuseSeed(false);
  }
  const loadedSeed = loaded?.seed ?? null;

  // The checkpoint list comes from ComfyUI whenever its address changes.
  useEffect(() => {
    if (!comfy.url) return;
    let live = true;
    listCheckpoints(comfy.url).then(
      (list) => live && setCheckpoints(list),
      (e) => live && setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [comfy.url]);

  if (!comfy.url) {
    return (
      <p className="meta" style={{ margin: 0 }}>
        To make pictures here, add your ComfyUI machine in <Link href="/settings#pictures">Settings</Link>.
      </p>
    );
  }

  const set = (patch: Partial<ComfySettings>) => void saveSettings({ ...settings, comfy: { ...comfy, ...patch } });
  const other = otherSettings(loaded?.settings ?? null, comfy);
  const busy = queue.length > 0;
  // The list of jobs goes where the new pictures arrive, when the page offers a place for it.
  const withSlot = (list: ReactNode) => (queueSlot ? createPortal(list, queueSlot) : list);
  const size = SIZES.find((s) => s.width === comfy.width && s.height === comfy.height);

  /**
   * Queues one job with the prompt and settings as they are now, and waits for its pictures. Several can
   * run at once: ComfyUI makes them one after another, and each shows its own progress and Stop.
   */
  async function generate() {
    setStatus(null);
    const ctl = new AbortController();
    const key = `job-${randomSeed().toString(36)}`;
    const job = { promptId: null as string | null, ctl };
    jobs.current.set(key, job);
    const setProgress = (progress: Progress) => {
      setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, progress } : q)));
    };
    setQueue((prev) => [...prev, { key, prompt: prompt.trim(), count: comfy.count, progress: { stage: "queued", ahead: null } }]);
    const seed = reuseSeed && loadedSeed !== null ? loadedSeed : randomSeed();
    // Names this job's WebSocket connection, so ComfyUI sends its progress there.
    const clientId = `storytime-${randomSeed().toString(36)}`;
    try {
      if (!prompt.trim()) throw new Error("Write or type a prompt first.");
      const base = parseWorkflow(comfy.workflow);
      if (describeWorkflow(base).checkpoint && !comfy.checkpoint) throw new Error("Pick a checkpoint first.");
      if (start && !describeWorkflow(base).image) {
        throw new Error("Your workflow can't start from a picture. Clear the starting picture, or see Settings for how to allow it.");
      }
      let from: Uploaded | null = null;
      if (start) {
        setProgress({ stage: "uploading" });
        if (uploaded.current?.key !== start.key) uploaded.current = { key: start.key, upload: uploadStart(comfy.url, start) };
        const upload = uploaded.current;
        try {
          from = await upload.upload;
        } catch (e) {
          // the next job tries the upload again
          if (uploaded.current === upload) uploaded.current = null;
          throw e;
        }
        setProgress({ stage: "queued", ahead: null });
      }
      // From a picture the pictures are its size.
      const width = from?.width ?? comfy.width;
      const height = from?.height ?? comfy.height;
      const workflow = fillWorkflow(base, {
        prompt: prompt.trim(),
        negative: negative.trim(),
        checkpoint: comfy.checkpoint,
        width,
        height,
        count: comfy.count,
        seed,
        prefix: filenamePrefix(storyId, chapterId),
        ...(from && { image: from.name, denoise: comfy.denoise }),
      });
      if (ctl.signal.aborted) throw new DOMException("Stopped", "AbortError");
      const promptId = await queuePrompt(comfy.url, workflow, clientId, { storytime: { chapterId, storyId } });
      job.promptId = promptId;
      // Stopped while it was being queued: take it off ComfyUI's queue again.
      if (ctl.signal.aborted) {
        void cancelPrompt(comfy.url, promptId);
        throw new DOMException("Stopped", "AbortError");
      }
      const images = await waitForPictures(comfy.url, promptId, clientId, setProgress, ctl.signal);
      if (images.length === 0) throw new Error("ComfyUI finished but sent back no pictures. Does the workflow end in a Save Image node?");
      // The pictures are usable even if this fails; they just won't be listed later or keep their prompt.
      let jobId: string | null = null;
      try {
        jobId = await recordJob({
          chapter_id: chapterId,
          prompt_id: promptId,
          prompt: prompt.trim(),
          negative: negative.trim(),
          checkpoint: comfy.checkpoint,
          width,
          height,
          seed,
          count: comfy.count,
          moment,
          ...(from && { source: start!.source, denoise: comfy.denoise }),
          images,
        });
      } catch (e) {
        setStatus({ ok: false, text: `The pictures are ready, but StoryTime couldn't record how they were made: ${e instanceof Error ? e.message : String(e)}` });
      }
      const denoise = from ? comfy.denoise : null;
      onPictures?.(
        images.map((image, i) => ({
          key: `${jobId ?? promptId}-${i}`,
          index: i,
          mark: null,
          fresh: true,
          image,
          jobId,
          prompt: prompt.trim(),
          negative: negative.trim(),
          seed,
          checkpoint: comfy.checkpoint,
          width,
          height,
          denoise,
          moment,
        })),
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setStatus({ ok: true, text: "Stopped." });
      else setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      jobs.current.delete(key);
      setQueue((prev) => prev.filter((q) => q.key !== key));
    }
  }

  function stop(key: string) {
    const j = jobs.current.get(key);
    if (!j) return;
    if (j.promptId) void cancelPrompt(comfy.url, j.promptId);
    j.ctl.abort();
  }

  return (
    <div className="comfy-generate">
      <h3>Make pictures</h3>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label className="row" style={{ gap: "0.4rem" }}>
          Checkpoint
          <select
            aria-label="Checkpoint"
            value={comfy.checkpoint}
            onChange={(e) => set({ checkpoint: e.target.value })}
            style={{ width: "auto", maxWidth: "min(20rem, 100%)" }}
          >
            {!comfy.checkpoint && <option value="">{checkpoints === null ? "Loading…" : "Pick a checkpoint"}</option>}
            {comfy.checkpoint && !checkpoints?.includes(comfy.checkpoint) && <option value={comfy.checkpoint}>{comfy.checkpoint}</option>}
            {(checkpoints ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: "0.4rem" }}>
          Size
          <select
            aria-label="Size"
            value={`${comfy.width}x${comfy.height}`}
            onChange={(e) => {
              const [width, height] = e.target.value.split("x").map(Number);
              set({ width, height });
            }}
            disabled={start !== null}
            title={start ? "Pictures made from a starting picture are its size" : undefined}
            style={{ width: "auto" }}
          >
            {!size && <option value={`${comfy.width}x${comfy.height}`}>{`${comfy.width} × ${comfy.height}`}</option>}
            {SIZES.map((s) => (
              <option key={s.label} value={`${s.width}x${s.height}`}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: "0.4rem" }}>
          How many
          <select aria-label="How many" value={comfy.count} onChange={(e) => set({ count: Number(e.target.value) })} style={{ width: "auto" }}>
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {start && (
        <div className="start-picture">
          {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
          <img src={start.thumb} alt="Starting picture" />
          <div className="start-picture-controls">
            <p style={{ margin: 0 }}>
              <strong>Starting from this picture.</strong> <span className="meta">The new pictures are its size.</span>
            </p>
            <label className="strength">
              Strength {comfy.denoise.toFixed(2)}
              <input
                type="range"
                aria-label="Strength"
                min={0.05}
                max={1}
                step={0.05}
                value={comfy.denoise}
                onChange={(e) => set({ denoise: Number(e.target.value) })}
              />
            </label>
            <p className="meta" style={{ margin: 0 }}>Low keeps the picture close; high changes more.</p>
            <div>
              <button type="button" className="secondary" onClick={onClearStart}>
                Clear starting picture
              </button>
            </div>
          </div>
        </div>
      )}
      {other && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="secondary" onClick={() => set(other.patch)}>
            Use its settings
          </button>
          <span className="meta">The loaded picture was made with {other.text}.</span>
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!prompt.trim()}
          title={busy ? "Adds a job with the prompt and settings as they are now; ComfyUI makes it after the others" : undefined}
        >
          {busy ? "Queue more" : "Make pictures"}
        </button>
        {loadedSeed !== null && (
          <label className="inline-label" title="The same seed with a slightly changed prompt gives a close variation">
            <input type="checkbox" checked={reuseSeed} onChange={(e) => setReuseSeed(e.target.checked)} />
            Reuse seed {loadedSeed}
          </label>
        )}
      </div>
      {busy && withSlot(
        <ul className="comfy-queue" aria-label="Pictures being made">
          {queue.map((q) => (
            <li key={q.key}>
              <div className="comfy-queue-line">
                <span className="comfy-queue-prompt" title={q.prompt}>
                  {q.prompt.length > SHOWN_PROMPT ? `${q.prompt.slice(0, SHOWN_PROMPT).trimEnd()}…` : q.prompt}
                  <span className="meta"> ×{q.count}</span>
                </span>
                <button type="button" className="secondary" onClick={() => stop(q.key)}>
                  Stop
                </button>
              </div>
              <span className="meta" role="status">
                {progressText(q.progress)}
              </span>
              {q.progress.stage === "running" && <progress value={q.progress.value} max={q.progress.max} aria-label="Progress" />}
            </li>
          ))}
        </ul>,
      )}
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
    </div>
  );
}
