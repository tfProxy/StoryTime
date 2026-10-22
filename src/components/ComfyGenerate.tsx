"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { SettingsIcon } from "./PictureIcons";
import { saveSettings, useSettings } from "@/lib/settings";
import { QUEUE_COUNTS, type ComfySettings } from "@/lib/settingsSchema";
import { targetKey, type PictureMoment, type PictureTarget } from "@/lib/pictureTarget";
import type { LoadedPrompt } from "./ImagePromptPanel";
import type { JobProgress, MadeWith, PendingJob, Picture, StartMode } from "./pictures";
import { editBlocked, usableEditPresets, type EditModels } from "./useEditModels";
import AutoTextarea from "./AutoTextarea";
import { usePictureQueue } from "./PictureQueue";
import { LIMITS } from "@/lib/limits";
import { EDIT_MODELS, editTuning, lightningSteps, usableLoras } from "@/lib/comfy/editModels";
import { combinePrompts } from "@/lib/ai/imagePrompt";
import { drawPresetFor, drawPresetSummary, presetName, type DrawPreset, type EditPreset, type LoraSetting } from "@/lib/comfy/presets";
import type { StartPicture } from "@/lib/comfy/startPicture";
import { readEdit, readRedraw, stateKey, writeEdit, writeRedraw } from "@/lib/comfy/editingState";
import { listCheckpoints } from "@/lib/comfy/client";
import { denoiseOf, madeWithText, type JobInput } from "@/lib/comfy/makeJob";

/** Sizes that suit SDXL (about one megapixel), tallest to widest. */
const SIZES: { name: string; width: number; height: number }[] = [
  { name: "Portrait", width: 768, height: 1344 },
  { name: "Square", width: 1024, height: 1024 },
  { name: "Landscape", width: 1344, height: 768 },
  { name: "Wide", width: 1536, height: 640 },
];

/** Sizes for a cover, tall like a book's first. */
const COVER_SIZES: { name: string; width: number; height: number }[] = [
  { name: "Book", width: 832, height: 1216 },
  { name: "Portrait", width: 768, height: 1344 },
  { name: "Square", width: 1024, height: 1024 },
];

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** The aspect ratio as small whole numbers ("7:4"); sizes with no small ratio get one decimal ("1.8:1"). */
function ratioText(width: number, height: number): string {
  if (!(width > 0 && height > 0)) return "";
  const d = gcd(width, height);
  const w = width / d;
  const h = height / d;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return width >= height ? `${(width / height).toFixed(1)}:1` : `1:${(height / width).toFixed(1)}`;
}

/** A hollow glyph for the shape, for the drop-down's options, which can't hold a picture. */
const shapeGlyph = (width: number, height: number) => (width === height ? "□" : width > height ? "▭" : "▯");

/**
 * One size option as columns: shape glyph, name, aspect ratio, pixel size. The spaces between the spans
 * keep it readable as plain text in a browser that can't lay an option out (see .size-select).
 */
function SizeColumns({ name, width, height }: { name: string; width: number; height: number }) {
  return (
    <>
      <span className="size-glyph">{shapeGlyph(width, height)}</span> <span className="size-name">{name}</span>{" "}
      <span className="size-ratio">{ratioText(width, height)}</span> <span className="size-px">{width} × {height}</span>
    </>
  );
}

/**
 * Where the settings a loaded picture was made with differ from the current ones: the change to make and
 * how to describe it, or null when they match. The size is shared by every story, so it changes only when
 * the author asks. A picture made from a starting picture took that picture's size, so only its strength is
 * offered. (The checkpoint and LoRAs are the drawing preset's, so they aren't offered here.)
 */
function otherSettings(made: MadeWith | null, now: ComfySettings, redraw: number): { size: Partial<ComfySettings>; strength: number | null; text: string } | null {
  if (!made) return null;
  const size: Partial<ComfySettings> = {};
  let strength: number | null = null;
  const text: string[] = [];
  if (made.denoise === null && (made.width !== now.width || made.height !== now.height)) {
    size.width = made.width;
    size.height = made.height;
    text.push(`${made.width} × ${made.height}`);
  }
  if (made.denoise !== null && made.denoise !== redraw) {
    strength = made.denoise;
    text.push(`strength ${made.denoise}`);
  }
  return text.length ? { size, strength, text: text.join(", ") } : null;
}

/**
 * The on/off boxes of a preset's LoRAs, on the Illustrate page (switching one changes the preset in
 * Settings). `available` is what ComfyUI lists, or null when that isn't known yet.
 */
function LoraToggles({ stack, available, href, onChange }: { stack: LoraSetting[]; available: string[] | null; href?: string; onChange: (stack: LoraSetting[]) => void }) {
  return (
    <div className="edit-lora-toggles" role="group" aria-label="LoRAs">
      <span className="meta">LoRAs:</span>
      {stack.map((l, i) => {
        const name = l.name.split(/[\\/]/).pop()!;
        const gone = available !== null && !available.includes(l.name);
        return (
          <label key={i} className="inline-label" title={gone ? `ComfyUI doesn't list ${l.name}, so it isn't used` : `${l.name} at strength ${l.strength}`}>
            <input type="checkbox" checked={l.on} onChange={(e) => onChange(stack.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
            <span className={gone ? "error" : undefined}>
              {name.replace(/\.safetensors$/i, "")} ({l.strength}){gone && " – missing"}
            </span>
          </label>
        );
      })}
      {href && (
        <Link href={href} className="meta">
          Change
        </Link>
      )}
    </div>
  );
}

type Props = {
  /** What the pictures are for: a chapter, or the story's cover. */
  target: PictureTarget;
  /** The story's drawing preset (set on its details page), and the chapter's (or the cover's) own, chosen here; null for none. */
  storyPreset: string | null;
  chapterPreset: string | null;
  /** Called when the chapter's (or cover's) drawing preset is changed here (null: follows the story's). */
  onChapterPreset?: (id: string | null) => void;
  moment: PictureMoment;
  prompt: string;
  negative: string;
  /** Text the chapter always includes; added to the prompt after the drawing preset's own. */
  fixedPrompt?: string;
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
 * prompt at a strength, or edited by an instruction with an edit model. The jobs go to the app's picture
 * queue (`PictureQueue`), so they go on when the page is left; the chapter's pictures go to `onPictures`.
 */
export default function ComfyGenerate({
  target, storyPreset, chapterPreset: savedPreset, moment, prompt: boxPrompt, negative: boxNegative, fixedPrompt = "", loaded = null, start = null, onClearStart,
  startMode = "redraw", onStartMode, editModels = { state: "checking" }, onPictures, onQueue, onChapterPreset, dock = null,
}: Props) {
  const { storyId, chapterId } = target;
  // Where this browser keeps the edit's text and strengths, and the queue's name for the target.
  const kept = stateKey(target);
  const at = targetKey(target);
  const settings = useSettings();
  // A cover has a size of its own (Settings keeps both), so choosing one doesn't change the chapters'.
  const isCover = chapterId === null;
  const comfy = isCover ? { ...settings.comfy, width: settings.comfy.coverWidth, height: settings.comfy.coverHeight } : settings.comfy;
  const sizes = isCover ? COVER_SIZES : SIZES;
  const queueCount = comfy.queueCount;
  // What to change, when editing the starting picture by instruction.
  const [instruction, setInstruction] = useState("");
  // How closely an edit follows the starting picture: 1 lets the model change it freely, lower keeps it closer.
  // It starts at the edit preset's default strength (Settings); a change here is for that preset, until another is chosen.
  const [strengthFor, setStrengthFor] = useState<{ model: string; value: number } | null>(null);
  // The same for Redraw, from the drawing preset's default.
  const [redrawFor, setRedrawFor] = useState<{ preset: string; value: number } | null>(null);
  // The instruction and changed strengths are kept in this browser, so a refresh brings them back.
  const [editKept, setEditKept] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- browser storage can only be read after the page is shown, so the server and browser draw the same first page */
  useEffect(() => {
    const saved = readEdit(kept);
    if (saved) {
      setInstruction(saved.instruction);
      setStrengthFor(saved.model ? { model: saved.model, value: saved.strength } : null);
    }
    const redraw = readRedraw(kept);
    setRedrawFor(redraw && { preset: redraw.preset, value: redraw.strength });
    setEditKept(true);
  }, [kept]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The drawing preset: the chapter's own (chosen here), else the story's, else the first.
  const [chapterPreset, setChapterPreset] = useState(savedPreset);
  const storyDraw = drawPresetFor(comfy.drawPresets, storyPreset);
  const draw = drawPresetFor(comfy.drawPresets, chapterPreset, storyPreset);
  const redrawStrength = redrawFor?.preset === draw.id ? redrawFor.value : draw.denoise;
  // What is drawn: the prompt boxes with the drawing preset's text and the chapter's always-included text added.
  // With nothing to add, the boxes are used as typed.
  const prompt = draw.prompt.trim() || fixedPrompt.trim() ? combinePrompts(draw.promptStyle, draw.prompt, fixedPrompt, boxPrompt) : boxPrompt;
  const negative = draw.negative.trim() ? combinePrompts(draw.promptStyle, boxNegative, draw.negative) : boxNegative;
  // The drawing preset's LoRAs switched on, and those of them ComfyUI doesn't list (when it is known what it lists).
  const loraFiles = editModels.state === "done" ? editModels.loras : null;
  const drawUsable = usableLoras(draw.loras, loraFiles ?? draw.loras.map((l) => l.name));

  const editing = start !== null && startMode === "edit";
  const blocked = editBlocked(editModels, comfy.editPresets);
  // The edit preset: the one last chosen, if ComfyUI has its files, else the first that it has them for.
  const usablePresets = usableEditPresets(editModels, comfy.editPresets);
  const usable = usablePresets.find((u) => u.preset.id === comfy.editPreset) ?? usablePresets[0] ?? null;
  const editPreset = usable?.preset ?? null;
  // Its model, with the files it uses.
  const chosen = usable?.check ?? null;
  // The edit preset's settings, with the model's defaults for the rest.
  const tuning = chosen && editPreset ? editTuning(chosen.model, editPreset.tuning) : null;
  const editStrength = editPreset && strengthFor?.model === editPreset.id ? strengthFor.value : (tuning?.strength ?? 1);
  const setEditStrength = (value: number) => editPreset && setStrengthFor({ model: editPreset.id, value });
  useEffect(() => {
    if (!editKept) return;
    writeEdit(kept, { instruction, strength: strengthFor?.value ?? 1, model: strengthFor?.model });
    writeRedraw(kept, redrawFor && { preset: redrawFor.preset, strength: redrawFor.value });
  }, [editKept, kept, instruction, strengthFor, redrawFor]);
  // The chosen model's speed-up file, when ComfyUI has one, and whether edits use it.
  const speedUp = chosen?.files.speedUp ?? null;
  const fast = speedUp !== null && !!editPreset?.fast;
  // The edit preset's LoRA stack, and the LoRAs of it an edit uses now.
  const loraStack = editPreset?.loras ?? [];
  const { loras: editLoras, missing: missingLoras } = usableLoras(loraStack, chosen?.loras ?? []);
  // This chapter's (or cover's) jobs being made, oldest first. The app's picture queue holds them, so they go on when the page is left.
  const pictureQueue = usePictureQueue();
  const { stop, listen } = pictureQueue;
  const queue = useMemo(() => pictureQueue.jobs.filter((j) => targetKey(j) === at && j.state === "making"), [pictureQueue.jobs, at]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // The Pictures panel shows the jobs, newest first, among the pictures.
  useEffect(() => {
    onQueue?.(queue.map((q) => ({ ...q, stop: () => stop(q.key) })).reverse());
  }, [queue, onQueue, stop]);
  useEffect(() => () => onQueue?.([]), [onQueue]);
  // The chapter's finished jobs come here: those that ended while the page was away first, then each as it ends.
  const picturesTo = useRef(onPictures);
  useEffect(() => {
    picturesTo.current = onPictures;
  }, [onPictures]);
  useEffect(() => listen({ storyId, chapterId }, { onPictures: (p) => picturesTo.current?.(p), onStatus: setStatus }), [listen, storyId, chapterId]);
  // Each prompt loaded from a saved picture starts with a new seed again, until the author ticks the box.
  const [reuseSeed, setReuseSeed] = useState(false);
  const [seenLoad, setSeenLoad] = useState(0);
  if (loaded && loaded.nonce !== seenLoad) {
    setSeenLoad(loaded.nonce);
    setReuseSeed(false);
  }
  const loadedSeed = loaded?.seed ?? null;

  // Asking ComfyUI for its checkpoints says early whether it can be reached, and whether it still has the
  // drawing preset's checkpoint.
  const checkpoint = draw.checkpoint;
  const drawName = presetName(draw);
  useEffect(() => {
    if (!comfy.url) return;
    let live = true;
    listCheckpoints(comfy.url).then(
      (list) => {
        if (live && checkpoint && !list.includes(checkpoint)) {
          setStatus({ ok: false, text: `ComfyUI doesn't list the checkpoint of the preset “${drawName}” (${checkpoint}). Choose another in Settings.` });
        }
      },
      (e) => live && setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [comfy.url, checkpoint, drawName]);

  /** Chooses the chapter's (or cover's) drawing preset; the story's own goes back to following the story. */
  function chooseDraw(id: string) {
    const next = id === storyDraw.id ? null : id;
    setChapterPreset(next);
    onChapterPreset?.(next);
    const url = chapterId === null ? `/api/stories/${storyId}/cover-preset` : `/api/chapters/${chapterId}/picture-preset`;
    fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draw_preset: next }) })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
      })
      .catch((e) => setStatus({ ok: false, text: `Couldn't keep the ${chapterId === null ? "cover" : "chapter"}'s preset: ${e instanceof Error ? e.message : String(e)}` }));
  }

  const set = (patch: Partial<ComfySettings>) => void saveSettings({ ...settings, comfy: { ...settings.comfy, ...patch } });
  /** Changes a drawing or edit preset in Settings (switching a LoRA, Fast). */
  const changeDraw = (patch: Partial<DrawPreset>) => set({ drawPresets: comfy.drawPresets.map((p) => (p.id === draw.id ? { ...p, ...patch } : p)) });
  const changeEdit = (patch: Partial<EditPreset>) =>
    editPreset && set({ editPresets: comfy.editPresets.map((p) => (p.id === editPreset.id ? { ...p, ...patch } : p)) });

  const other = otherSettings(loaded?.settings ?? null, comfy, redrawStrength);
  const size = sizes.find((s) => s.width === comfy.width && s.height === comfy.height);

  /**
   * One click asks for one picture. The picture queue gathers quick clicks with the same prompt and
   * settings into one job (see `PictureQueue`).
   */
  function ask() {
    setStatus(null);
    if (editing && !chosen) return setStatus({ ok: false, text: blocked ?? "No edit model is ready." });
    const input: JobInput = {
      // An edit follows the instruction alone, so the preset's and chapter's text isn't added to it.
      prompt: (editing ? boxPrompt : prompt).trim(),
      // Edits follow the instruction alone.
      negative: editing ? "" : negative.trim(),
      moment,
      comfy,
      draw,
      drawLoras: drawUsable.loras,
      redraw: redrawStrength,
      start,
      edit: editing && chosen && tuning ? { check: chosen, instruction: instruction.trim(), strength: editStrength, fast, loras: editLoras, tuning } : null,
      seed: reuseSeed && loadedSeed !== null ? loadedSeed : null,
    };
    pictureQueue.ask({
      chapterId,
      storyId,
      input,
      view: {
        prompt: input.prompt,
        negative: input.negative,
        checkpoint: madeWithText(input),
        width: comfy.width,
        height: comfy.height,
        denoise: denoiseOf(input),
        source: start?.source ?? null,
        instruction: input.edit?.instruction ?? null,
        editModel: input.edit?.check.model.id ?? null,
        moment,
      },
    });
  }

  // Every hook is above this.
  if (!comfy.url) {
    return (
      <p className="meta" style={{ margin: 0 }}>
        To make pictures here, add your ComfyUI machine in <Link href="/settings#comfyui">Settings</Link>.
      </p>
    );
  }

  // Size, Queue and what is being made: kept at the bottom of the column (see `dock`), so they can be used from anywhere on the page.
  const head = queue[0];
  const waiting = queue.slice(1).reduce((n, q) => n + q.count, 0);
  const bar = (
    <div className="generate-bar">
      <label className="row" style={{ gap: "0.4rem" }}>
        Size
        <select
          className="size-select"
          aria-label="Size"
          value={`${comfy.width}x${comfy.height}`}
          onChange={(e) => {
            const [width, height] = e.target.value.split("x").map(Number);
            set(isCover ? { coverWidth: width, coverHeight: height } : { width, height });
          }}
          disabled={start !== null}
          title={start ? "Pictures made from a starting picture are its size" : undefined}
          style={{ width: "auto", flex: 1 }}
        >
          {/* The closed menu shows the chosen option's columns (customizable select; other browsers ignore this). */}
          <button type="button">{createElement("selectedcontent")}</button>
          {!size && (
            <option value={`${comfy.width}x${comfy.height}`}>
              <SizeColumns name="Custom" width={comfy.width} height={comfy.height} />
            </option>
          )}
          {sizes.map((s) => (
            <option key={s.name} value={`${s.width}x${s.height}`}>
              <SizeColumns name={s.name} width={s.width} height={s.height} />
            </option>
          ))}
        </select>
      </label>
      <div className="queue-row">
        <button
          type="button"
          className="queue-button"
          onClick={() => {
            // Each is one more picture for the job being gathered, as if clicked quickly.
            for (let i = 0; i < queueCount; i++) ask();
          }}
          disabled={editing ? !chosen || !instruction.trim() : !prompt.trim()}
          title={`Each click queues ${queueCount === 1 ? "one picture" : `${queueCount} pictures`}. Quick clicks with nothing changed in between go to ComfyUI as one job.`}
        >
          Queue
        </button>
        <select
          aria-label="Pictures per click"
          title="How many pictures one click of Queue asks for"
          value={queueCount}
          onChange={(e) => set({ queueCount: Number(e.target.value) })}
          style={{ width: "auto" }}
        >
          {QUEUE_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="queue-status" aria-label="Queue">
        <span>
          In progress: {head ? head.count : 0}
          {head && ` (${briefProgress(head.progress)})`} · Queued: {waiting}
        </span>
        {head?.progress.stage === "running" && <progress value={head.progress.value} max={head.progress.max} aria-hidden="true" />}
      </div>
    </div>
  );

  // The Strength slider and its one-line explanation, the same for Redraw and Edit.
  const strength = (value: number, onChange: (v: number) => void) => (
    <>
      <label className="strength">
        Strength {value.toFixed(2)}
        <input type="range" aria-label="Strength" min={0.05} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </label>
      <p className="meta" style={{ margin: 0 }}>Low stays close to the picture; 1.00 changes it freely.</p>
    </>
  );

  return (
    <section className="ai-panel comfy-generate">
      <h2>Model Settings</h2>
      {start && (
        <div className="start-picture">
          <div className="start-picture-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
            <img src={start.thumb} alt="Starting picture" />
            <button type="button" className="secondary" onClick={onClearStart}>
              Clear starting picture
            </button>
          </div>
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
              chosen && editPreset ? (
                <>
                  <label className="row" style={{ gap: "0.4rem" }}>
                    Preset
                    <select aria-label="Edit preset" value={editPreset.id} onChange={(e) => set({ editPreset: e.target.value })} style={{ width: "auto", minWidth: 0, flex: 1 }}>
                      {EDIT_MODELS.map((m) => {
                        const mine = comfy.editPresets.filter((p) => p.model === m.id);
                        const installed = mine.some((p) => usablePresets.some((u) => u.preset.id === p.id));
                        return (
                          <optgroup key={m.id} label={installed ? m.name : `${m.name} (not installed)`}>
                            {mine.map((p) => {
                              const ok = usablePresets.some((u) => u.preset.id === p.id);
                              return (
                                <option key={p.id} value={p.id} disabled={!ok}>
                                  {presetName(p)}
                                  {installed && !ok ? " (files missing)" : ""}
                                </option>
                              );
                            })}
                          </optgroup>
                        );
                      })}
                    </select>
                  </label>
                  <p className="meta" style={{ margin: 0 }}>
                    {chosen.model.name}: {chosen.model.blurb}
                  </p>
                  {speedUp && (
                    <label className="inline-label" title={`Uses ${speedUp}: ${lightningSteps(speedUp)} steps instead of ${tuning?.steps}, with a little less detail`}>
                      <input type="checkbox" checked={editPreset.fast} onChange={(e) => changeEdit({ fast: e.target.checked })} />
                      Fast ({chosen.model.speedUp?.name ?? "speed-up"}, {lightningSteps(speedUp)} steps)
                    </label>
                  )}
                  {loraStack.length === 0 ? (
                    <p className="meta" style={{ margin: 0 }}>
                      No LoRAs in this preset. <Link href={`/settings#preset-${editPreset.id}`}>Add some in Settings</Link>
                    </p>
                  ) : (
                    <LoraToggles stack={loraStack} available={chosen.loras} href={`/settings#preset-${editPreset.id}`} onChange={(loras) => changeEdit({ loras })} />
                  )}
                  {missingLoras.length > 0 && (
                    <p className="error" style={{ margin: 0 }}>
                      ComfyUI doesn&apos;t list {missingLoras.join(", ")}, so edits go ahead without {missingLoras.length === 1 ? "it" : "them"}.
                    </p>
                  )}
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
                  {strength(editStrength, setEditStrength)}
                  <p className="meta" style={{ margin: 0 }}>
                    It starts at the preset&apos;s default ({(tuning?.strength ?? 1).toFixed(2)}),{" "}
                    <Link href={`/settings#preset-${editPreset.id}`}>set in Settings</Link>.
                  </p>
                </>
              ) : (
                <p className="error" style={{ margin: 0 }}>
                  {blocked ?? "No edit model is ready."} <Link href="/settings#setup-qwen-image-edit">Settings</Link>
                </p>
              )
            ) : (
              <>
                <p className="meta" style={{ margin: 0 }}>The new pictures are its size, drawn with the preset below.</p>
                {strength(redrawStrength, (value) => setRedrawFor({ preset: draw.id, value }))}
                <p className="meta" style={{ margin: 0 }}>
                  It starts at the preset&apos;s default ({draw.denoise.toFixed(2)}), <Link href={`/settings#preset-${draw.id}`}>set in Settings</Link>.
                </p>
              </>
            )}
          </div>
        </div>
      )}
      {!editing && (
        <div className="draw-preset">
          <div className="row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
            <label className="row" style={{ gap: "0.4rem", flex: 1, minWidth: 0 }}>
              Preset
              <select aria-label="Drawing preset" value={draw.id} onChange={(e) => chooseDraw(e.target.value)} style={{ width: "auto", minWidth: 0, flex: 1 }}>
                {comfy.drawPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {presetName(p)}
                    {p.id === storyDraw.id ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Link className="icon-link" href={`/settings#preset-${draw.id}`} aria-label="Change preset in Settings" title={`Change this preset in Settings (${drawPresetSummary(draw)})`}>
              <SettingsIcon />
            </Link>
          </div>
          {draw.loras.length > 0 && <LoraToggles stack={draw.loras} available={loraFiles} onChange={(loras) => changeDraw({ loras })} />}
          {drawUsable.missing.length > 0 && (
            <p className="error" style={{ margin: 0 }}>
              ComfyUI doesn&apos;t list {drawUsable.missing.join(", ")}, so pictures are drawn without {drawUsable.missing.length === 1 ? "it" : "them"}.
            </p>
          )}
        </div>
      )}
      {other && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const { width, height } = other.size;
              if (width && height) set(isCover ? { coverWidth: width, coverHeight: height } : { width, height });
              if (other.strength !== null) setRedrawFor({ preset: draw.id, value: other.strength });
            }}
          >
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
    </section>
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
