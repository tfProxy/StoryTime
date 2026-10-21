"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { saveSettings, useSettings } from "@/lib/settings";
import type { ComfySettings } from "@/lib/settingsSchema";
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { LoadedPrompt } from "./ImagePromptPanel";
import type { JobProgress, MadeWith, PendingJob, Picture, StartMode } from "./pictures";
import { editBlocked, type EditModels } from "./useEditModels";
import AutoTextarea from "./AutoTextarea";
import { LIMITS } from "@/lib/limits";
import { editSize, type EditCheck } from "@/lib/comfy/editModels";
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

/** How long after the last click a job is sent, so quick clicks with the same settings make one job. */
export const GATHER_MS = 800;
/** The most pictures one job makes; a click beyond it starts another job. */
export const MAX_BATCH = 8;

/**
 * A job being made, as the Pictures panel shows it (a PendingJob without its Stop). The size is the size
 * setting, or the starting picture's once it is read.
 */
type Queued = Omit<PendingJob, "stop">;

/** Everything a job is made with, as it was when it was asked for. */
type JobInput = {
  prompt: string;
  negative: string;
  moment: ImageMoment;
  comfy: ComfySettings;
  start: StartPicture | null;
  /** An edit of the starting picture by instruction, with the model to make it; null to redraw it or make new pictures. */
  edit: { check: EditCheck; instruction: string; strength: number } | null;
  /** The seed to use, or null for a random one. */
  seed: number | null;
};

/** The strength a job's pictures are recorded with: a redraw's, an edit's when it is less than full, else null. */
const denoiseOf = (i: JobInput) => (i.edit ? (i.edit.strength < 1 ? i.edit.strength : null) : i.start ? i.comfy.denoise : null);

/** A job not sent yet, which more clicks can still add pictures to. */
type Gathering = { key: string; input: JobInput; count: number; timer: ReturnType<typeof setTimeout> };

/** What has to match for a click to join the job being gathered. */
const sameJob = (a: JobInput) =>
  JSON.stringify([
    a.prompt, a.negative, a.moment, a.comfy.url, a.comfy.workflow, a.comfy.checkpoint, a.comfy.width, a.comfy.height, a.start?.key ?? null,
    a.start && !a.edit ? a.comfy.denoise : null, a.edit?.check.model.id ?? null, a.edit?.instruction ?? null, a.edit?.strength ?? null, a.seed,
  ]);

/**
 * Where the settings a loaded picture was made with differ from the current ones: the change to make and
 * how to describe it, or null when they match. The size is shared by every story, so it changes only when
 * the author asks. A picture made from a starting picture took that picture's size, so only its strength is
 * offered. (The checkpoint is the story's, set on its details page, so it isn't offered here.)
 */
function otherSettings(made: MadeWith | null, now: ComfySettings): { patch: Partial<ComfySettings>; text: string } | null {
  if (!made) return null;
  const patch: Partial<ComfySettings> = {};
  const text: string[] = [];
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
  /** The story's checkpoint (set on its details page); "" when none is chosen. */
  checkpoint: string;
  moment: ImageMoment;
  prompt: string;
  negative: string;
  /** A prompt brought back from a saved picture; its seed can be used again. */
  loaded?: LoadedPrompt | null;
  /** The picture new pictures start from (image to image), or null to make them from the prompt alone. */
  start?: StartPicture | null;
  onClearStart?: () => void;
  /** Whether the starting picture is redrawn from the prompt (at a strength) or edited by instruction, and how to switch. */
  startMode?: StartMode;
  onStartMode?: (mode: StartMode) => void;
  /** Which edit models ComfyUI can run. */
  editModels?: EditModels;
  /** Called with each finished job's pictures. */
  onPictures?: (pictures: Picture[]) => void;
  /** Called with the jobs being made, newest first, whenever they change; the Pictures panel shows them. */
  onQueue?: (jobs: PendingJob[]) => void;
  /** An element at the bottom of the page's column to put Size, Queue and the queue's status in, so they stay in view; without it they sit at the end of this panel. */
  dock?: HTMLElement | null;
};

/**
 * Makes pictures from the prompt on the ComfyUI machine, or from a starting picture: redrawn from the
 * prompt at a strength, or edited by an instruction with an edit model. The pictures go to `onPictures`.
 */
export default function ComfyGenerate({
  chapterId, storyId, checkpoint, moment, prompt, negative, loaded = null, start = null, onClearStart,
  startMode = "redraw", onStartMode, editModels = { state: "checking" }, onPictures, onQueue, dock = null,
}: Props) {
  const settings = useSettings();
  const comfy = settings.comfy;
  // What to change, when editing the starting picture by instruction.
  const [instruction, setInstruction] = useState("");
  // How closely an edit follows the starting picture: 1 lets the model change it freely, lower keeps it closer.
  const [editStrength, setEditStrength] = useState(1);
  const editing = start !== null && startMode === "edit";
  const blocked = editBlocked(editModels);
  const ready = editModels.state === "done" ? editModels.ready : [];
  const chosen = ready.find((c) => c.model.id === comfy.editModel) ?? ready[0] ?? null;
  // The jobs being made, oldest first; `jobs` holds what Stop needs for each.
  const [queue, setQueue] = useState<Queued[]>([]);
  const jobs = useRef(new Map<string, { promptId: string | null; ctl: AbortController; url: string }>());
  // The newest job, while clicks can still add pictures to it.
  const gathering = useRef<Gathering | null>(null);
  // A job still gathering when the page is left is not sent.
  useEffect(() => () => clearTimeout(gathering.current?.timer), []);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  function stop(key: string) {
    const g = gathering.current;
    if (g?.key === key) {
      // Not sent yet: just drop it.
      clearTimeout(g.timer);
      gathering.current = null;
      jobs.current.delete(key);
      setQueue((prev) => prev.filter((q) => q.key !== key));
      setStatus({ ok: true, text: "Stopped." });
      return;
    }
    const j = jobs.current.get(key);
    if (!j) return;
    if (j.promptId) void cancelPrompt(j.url, j.promptId);
    j.ctl.abort();
  }

  // The Pictures panel shows the jobs, newest first, among the pictures.
  useEffect(() => {
    // `stop` only uses refs and state setters, so any render's one will do.
    onQueue?.(queue.map((q) => ({ ...q, stop: () => stop(q.key) })).reverse());
  }, [queue, onQueue]);
  useEffect(() => () => onQueue?.([]), [onQueue]);
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

  // Asking ComfyUI for its checkpoints says early whether it can be reached, and whether it still has the
  // story's checkpoint.
  useEffect(() => {
    if (!comfy.url) return;
    let live = true;
    listCheckpoints(comfy.url).then(
      (list) => {
        if (live && checkpoint && !list.includes(checkpoint)) {
          setStatus({ ok: false, text: `ComfyUI doesn't list this story's checkpoint (${checkpoint}). Choose another in Story details.` });
        }
      },
      (e) => live && setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [comfy.url, checkpoint]);

  if (!comfy.url) {
    return (
      <p className="meta" style={{ margin: 0 }}>
        To make pictures here, add your ComfyUI machine in <Link href="/settings#pictures">Settings</Link>.
      </p>
    );
  }

  const set = (patch: Partial<ComfySettings>) => void saveSettings({ ...settings, comfy: { ...comfy, ...patch } });
  const other = otherSettings(loaded?.settings ?? null, comfy);
  const size = SIZES.find((s) => s.width === comfy.width && s.height === comfy.height);

  /**
   * One click asks for one picture. Clicks with the same prompt and settings, each within GATHER_MS of the
   * last, are gathered into one job (up to MAX_BATCH pictures); a click with anything changed sends the
   * job being gathered at once and starts another.
   */
  function ask() {
    setStatus(null);
    if (editing && !chosen) return setStatus({ ok: false, text: blocked ?? "No edit model is ready." });
    const input: JobInput = {
      prompt: prompt.trim(),
      // Edits follow the instruction alone.
      negative: editing ? "" : negative.trim(),
      moment,
      // The checkpoint is the story's, not the shared setting.
      comfy: { ...comfy, checkpoint },
      start,
      edit: editing && chosen ? { check: chosen, instruction: instruction.trim(), strength: editStrength } : null,
      seed: reuseSeed && loadedSeed !== null ? loadedSeed : null,
    };
    const g = gathering.current;
    if (g && sameJob(g.input) === sameJob(input) && g.count < MAX_BATCH) {
      g.count += 1;
      clearTimeout(g.timer);
      g.timer = setTimeout(() => send(g), GATHER_MS);
      const count = g.count;
      setQueue((prev) => prev.map((q) => (q.key === g.key ? { ...q, count } : q)));
      return;
    }
    if (g) {
      clearTimeout(g.timer);
      send(g);
    }
    const key = `job-${randomSeed().toString(36)}`;
    jobs.current.set(key, { promptId: null, ctl: new AbortController(), url: comfy.url });
    const next: Gathering = { key, input, count: 1, timer: setTimeout(() => send(next), GATHER_MS) };
    gathering.current = next;
    setQueue((prev) => [
      ...prev,
      {
        key,
        count: 1,
        progress: { stage: "gathering" },
        prompt: input.prompt,
        negative: input.negative,
        checkpoint: input.edit ? input.edit.check.files.model : checkpoint,
        width: comfy.width,
        height: comfy.height,
        denoise: denoiseOf(input),
        source: start?.source ?? null,
        instruction: input.edit?.instruction ?? null,
        editModel: input.edit?.check.model.id ?? null,
        moment,
      },
    ]);
  }

  /** Sends a gathered job: no more clicks join it. */
  function send(g: Gathering) {
    if (gathering.current === g) gathering.current = null;
    void generate(g.key, g.input, g.count);
  }

  /**
   * Queues one job with the prompt and settings it was asked with, and waits for its pictures. Several can
   * run at once: ComfyUI makes them one after another, and each shows its own progress and Stop.
   */
  async function generate(key: string, input: JobInput, count: number) {
    const job = jobs.current.get(key);
    if (!job) return;
    const { ctl } = job;
    const { prompt, negative, moment, comfy, start, edit } = input;
    const setProgress = (progress: Progress) => {
      setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, progress } : q)));
    };
    setProgress({ stage: "queued", ahead: null });
    const seed = input.seed ?? randomSeed();
    // Names this job's WebSocket connection, so ComfyUI sends its progress there.
    const clientId = `storytime-${randomSeed().toString(36)}`;
    try {
      // An edit uses its own workflow, so the picture workflow and the story's checkpoint don't matter.
      const base = edit ? null : parseWorkflow(comfy.workflow);
      if (edit) {
        if (!start) throw new Error("Choose a picture to edit first.");
        if (!edit.instruction) throw new Error("Say what to change first.");
      } else {
        if (!prompt) throw new Error("Write or type a prompt first.");
        if (describeWorkflow(base!).checkpoint && !comfy.checkpoint) throw new Error("This story has no checkpoint chosen. Choose one in Story details.");
        if (start && !describeWorkflow(base!).image) {
          throw new Error("Your workflow can't start from a picture. Clear the starting picture, or see Settings for how to allow it.");
        }
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
      // From a picture the pictures are its size; an edit is its shape at about one megapixel.
      const { width, height } = from && edit ? editSize(from.width, from.height) : { width: from?.width ?? comfy.width, height: from?.height ?? comfy.height };
      if (from) setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, width, height } : q)));
      const prefix = filenamePrefix(storyId, chapterId);
      const workflow =
        edit && from
          ? edit.check.model.build(edit.check.files, { image: from.name, instruction: edit.instruction, seed, count, width, height, prefix, denoise: edit.strength })
          : fillWorkflow(base!, {
              prompt,
              negative,
              checkpoint: comfy.checkpoint,
              width,
              height,
              count,
              seed,
              prefix,
              ...(from && { image: from.name, denoise: comfy.denoise }),
            });
      // What the pictures were made with: the edit model's file, or the story's checkpoint.
      const madeWith = edit ? edit.check.files.model : comfy.checkpoint;
      const denoise = from ? denoiseOf(input) : null;
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
          prompt,
          negative,
          checkpoint: madeWith,
          width,
          height,
          seed,
          count,
          moment,
          ...(from && { source: start!.source, denoise }),
          ...(edit && { instruction: edit.instruction, edit_model: edit.check.model.id }),
          images,
        });
      } catch (e) {
        setStatus({ ok: false, text: `The pictures are ready, but StoryTime couldn't record how they were made: ${e instanceof Error ? e.message : String(e)}` });
      }
      onPictures?.(
        images.map((image, i) => ({
          key: `${jobId ?? promptId}-${i}`,
          index: i,
          mark: null,
          fresh: true,
          image,
          jobId,
          prompt,
          negative,
          seed,
          checkpoint: madeWith,
          width,
          height,
          denoise,
          source: from ? start!.source : null,
          instruction: edit?.instruction ?? null,
          editModel: edit?.check.model.id ?? null,
          moment,
          chapterId,
          madeAt: Date.now(),
          batch: images.length,
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

  // Size, Queue and what is being made: kept at the bottom of the column (see `dock`), so they can be used from anywhere on the page.
  const head = queue[0];
  const waiting = queue.slice(1).reduce((n, q) => n + q.count, 0);
  const bar = (
    <div className="generate-bar">
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
          style={{ width: "auto", flex: 1 }}
        >
          {!size && <option value={`${comfy.width}x${comfy.height}`}>{`${comfy.width} × ${comfy.height}`}</option>}
          {SIZES.map((s) => (
            <option key={s.label} value={`${s.width}x${s.height}`}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="queue-button"
        onClick={ask}
        disabled={editing ? !chosen || !instruction.trim() : !prompt.trim()}
        title="Each click queues one picture. Quick clicks with nothing changed in between go to ComfyUI as one job."
      >
        Queue
      </button>
      <div className="queue-status" aria-label="Queue">
        <span>
          In progress: {head ? head.count : 0}
          {head && ` (${briefProgress(head.progress)})`} · Queued: {waiting}
        </span>
        {head?.progress.stage === "running" && <progress value={head.progress.value} max={head.progress.max} aria-hidden="true" />}
      </div>
    </div>
  );

  return (
    <div className="comfy-generate">
      <h3>Make pictures</h3>
      {start && (
        <div className="start-picture">
          {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
          <img src={start.thumb} alt="Starting picture" />
          <div className="start-picture-controls">
            <p style={{ margin: 0 }}>
              <strong>Starting from this picture.</strong>
            </p>
            <div className="row start-modes" role="tablist" aria-label="What to do with it">
              <button
                type="button"
                role="tab"
                aria-selected={!editing}
                className={editing ? "secondary" : undefined}
                onClick={() => onStartMode?.("redraw")}
                title="Make new pictures from the prompt, starting from this one"
              >
                Redraw
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editing}
                className={editing ? undefined : "secondary"}
                onClick={() => onStartMode?.("edit")}
                disabled={!editing && blocked !== null}
                title={blocked ?? "Change this picture by telling an edit model what to change"}
              >
                Edit
              </button>
            </div>
            {editing ? (
              chosen ? (
                <>
                  <label className="row" style={{ gap: "0.4rem" }}>
                    Model
                    <select aria-label="Edit model" value={chosen.model.id} onChange={(e) => set({ editModel: e.target.value })} style={{ width: "auto" }}>
                      {ready.map((c) => (
                        <option key={c.model.id} value={c.model.id}>
                          {c.model.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="meta" style={{ margin: 0 }}>{chosen.model.blurb}</p>
                  <label>
                    What to change
                    <AutoTextarea
                      aria-label="What to change"
                      style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
                      maxLength={LIMITS.picturePrompt}
                      placeholder="e.g. remove the logo on his shirt; add more smoke around him"
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                    />
                  </label>
                  <label className="strength">
                    Strength {editStrength.toFixed(2)}
                    <input
                      type="range"
                      aria-label="Strength"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={editStrength}
                      onChange={(e) => setEditStrength(Number(e.target.value))}
                    />
                  </label>
                  <p className="meta" style={{ margin: 0 }}>Low keeps the picture close; 1.00 lets the model change it freely.</p>
                  <p className="meta" style={{ margin: 0 }}>The prompt above isn&apos;t used. Edits keep the picture&apos;s shape, at about one megapixel.</p>
                </>
              ) : (
                <p className="error" style={{ margin: 0 }}>
                  {blocked ?? "No edit model is ready."} <Link href="/settings#pictures">Settings</Link>
                </p>
              )
            ) : (
              <>
                <p className="meta" style={{ margin: 0 }}>The new pictures are its size.</p>
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
              </>
            )}
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
      {loadedSeed !== null && (
        <label className="inline-label" title="The same seed with a slightly changed prompt gives a close variation">
          <input type="checkbox" checked={reuseSeed} onChange={(e) => setReuseSeed(e.target.checked)} />
          Reuse seed {loadedSeed}
        </label>
      )}
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
      {dock ? createPortal(bar, dock) : bar}
    </div>
  );
}

/** A job's progress in a few words, for the small status line under Queue. */
function briefProgress(p: JobProgress): string {
  if (p.stage === "running") return `step ${p.value} of ${p.max}`;
  if (p.stage === "queued") return p.ahead ? `waiting, ${p.ahead} ahead` : "starting";
  if (p.stage === "uploading") return "sending the picture";
  if (p.stage === "gathering") return "about to send";
  return "loading the pictures";
}
