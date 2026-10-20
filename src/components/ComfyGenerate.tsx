"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveSettings, useSettings } from "@/lib/settings";
import type { ComfySettings } from "@/lib/settingsSchema";
import { IMAGE_SLOTS, type ImageSlot } from "@/lib/imageSlots";
import { prepareImage } from "@/lib/prepareImage";
import { describeWorkflow, fillWorkflow, parseWorkflow, randomSeed } from "@/lib/comfy/workflow";
import {
  cancelPrompt,
  fetchImage,
  imageUrl,
  listCheckpoints,
  queuePrompt,
  waitForPictures,
  type ComfyImage,
  type Progress,
} from "@/lib/comfy/client";

// Saved pictures keep at most this many pixels on their longest side, like uploads.
const MAX_SIDE = 1600;

/** Sizes that suit SDXL (about one megapixel). */
const SIZES: { label: string; width: number; height: number }[] = [
  { label: "Landscape 1344 × 768", width: 1344, height: 768 },
  { label: "Wide 1536 × 640", width: 1536, height: 640 },
  { label: "Square 1024 × 1024", width: 1024, height: 1024 },
  { label: "Portrait 768 × 1344", width: 768, height: 1344 },
];

const SLOT_NAMES: Record<ImageSlot, string> = { header: "header picture", footer: "footer picture" };

type Candidate = { image: ComfyImage; seed: number; key: string };

function progressText(p: Progress): string {
  if (p.stage === "queued") return p.ahead ? `Waiting in ComfyUI's queue (${p.ahead} ahead)…` : "Starting…";
  if (p.stage === "running") return `Step ${p.value} of ${p.max}…`;
  return "Loading the pictures…";
}

/** Makes pictures from the prompt on the ComfyUI machine, and saves the ones the author picks. */
export default function ComfyGenerate({ chapterId, prompt, negative }: { chapterId: string; prompt: string; negative: string }) {
  const router = useRouter();
  const settings = useSettings();
  const comfy = settings.comfy;
  const [checkpoints, setCheckpoints] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const job = useRef<{ promptId: string | null; ctl: AbortController } | null>(null);

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
  const busy = progress !== null;
  const size = SIZES.find((s) => s.width === comfy.width && s.height === comfy.height);

  async function generate() {
    setStatus(null);
    const ctl = new AbortController();
    job.current = { promptId: null, ctl };
    setProgress({ stage: "queued", ahead: null });
    const seed = randomSeed();
    // Names this job's WebSocket connection, so ComfyUI sends its progress there.
    const clientId = `storytime-${seed.toString(36)}`;
    try {
      if (!prompt.trim()) throw new Error("Write or type a prompt first.");
      const base = parseWorkflow(comfy.workflow);
      if (describeWorkflow(base).checkpoint && !comfy.checkpoint) throw new Error("Pick a checkpoint first.");
      const workflow = fillWorkflow(base, {
        prompt: prompt.trim(),
        negative: negative.trim(),
        checkpoint: comfy.checkpoint,
        width: comfy.width,
        height: comfy.height,
        count: comfy.count,
        seed,
      });
      const promptId = await queuePrompt(comfy.url, workflow, clientId);
      job.current.promptId = promptId;
      const images = await waitForPictures(comfy.url, promptId, clientId, setProgress, ctl.signal);
      if (images.length === 0) throw new Error("ComfyUI finished but sent back no pictures. Does the workflow end in a Save Image node?");
      setCandidates((prev) => [...images.map((image, i) => ({ image, seed, key: `${promptId}-${i}` })), ...prev]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setStatus({ ok: true, text: "Stopped." });
      else setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      job.current = null;
      setProgress(null);
    }
  }

  function stop() {
    const j = job.current;
    if (!j) return;
    if (j.promptId) void cancelPrompt(comfy.url, j.promptId);
    j.ctl.abort();
  }

  async function use(c: Candidate, slot: ImageSlot) {
    setSaving(`${c.key}-${slot}`);
    setStatus(null);
    try {
      const blob = await prepareImage(await fetchImage(comfy.url, c.image), MAX_SIDE);
      const res = await fetch(`/api/chapters/${chapterId}/images/${slot}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't save the picture (${res.status})`);
      setStatus({ ok: true, text: `Saved as the ${SLOT_NAMES[slot]}.` });
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
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
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={() => void generate()} disabled={busy || !prompt.trim()}>
          {busy ? "Making pictures…" : candidates.length ? "Make more" : "Make pictures"}
        </button>
        {busy && (
          <button type="button" className="secondary" onClick={stop}>
            Stop
          </button>
        )}
        {progress && (
          <span className="meta" role="status">
            {progressText(progress)}
          </span>
        )}
      </div>
      {progress?.stage === "running" && <progress value={progress.value} max={progress.max} aria-label="Progress" />}
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}

      {candidates.length > 0 && (
        <>
          <ul className="candidates" aria-label="Pictures from ComfyUI">
            {candidates.map((c) => (
              <li key={c.key}>
                <a href={imageUrl(comfy.url, c.image)} target="_blank" rel="noreferrer" title="Open full size">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI */}
                  <img src={imageUrl(comfy.url, c.image)} alt={`Picture ${c.image.filename}`} loading="lazy" />
                </a>
                {IMAGE_SLOTS.map((slot) => (
                  <button key={slot} type="button" className="secondary" disabled={saving !== null} onClick={() => void use(c, slot)}>
                    {saving === `${c.key}-${slot}` ? "Saving…" : `Use as ${SLOT_NAMES[slot]}`}
                  </button>
                ))}
              </li>
            ))}
          </ul>
          <p className="row" style={{ margin: 0 }}>
            <button type="button" className="secondary" onClick={() => setCandidates([])} disabled={busy}>
              Clear these pictures
            </button>
            <span className="meta">They stay in ComfyUI&apos;s output folder.</span>
          </p>
        </>
      )}
    </div>
  );
}
