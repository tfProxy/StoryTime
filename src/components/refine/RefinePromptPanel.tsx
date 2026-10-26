"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import AutoTextarea from "../AutoTextarea";
import LoraToggles from "../LoraToggles";
import { usePictureQueue } from "../WorkQueue";
import { drawPresetFamily, drawPresetIpAdapter, useEditModels } from "../useEditModels";
import type { RefineCanvasHandle } from "../RefineCanvas";
import { useSettings } from "@/lib/settings";
import { QUEUE_COUNTS } from "@/lib/settingsSchema";
import { LIMITS } from "@/lib/limits";
import { chapterIdOf, entryIdOf, type PictureMoment } from "@/lib/pictureTarget";
import { familyProblems } from "@/lib/comfy/drawModels";
import { usableLoras } from "@/lib/comfy/editModels";
import { parseLoras } from "@/lib/comfy/editingState";
import { applyLoraOverrides, hasLoraOverrides, resetLoraOverrides, setLoraOverride, type LoraOverrides } from "@/lib/comfy/loraOverrides";
import { denoiseOf, madeWithText, maskOf, type JobInput } from "@/lib/comfy/makeJob";
import { drawPresetFor, presetName, usesFamily } from "@/lib/comfy/presets";
import type { StartPicture } from "@/lib/comfy/startPicture";
import { describeWorkflow, parseWorkflow } from "@/lib/comfy/workflow";
import type { PaintedArea } from "@/lib/mask";
import type { RefineState } from "@/lib/refineHistory";
import { appliedSource, type RefineSession } from "@/lib/refine/session";
import { maskId, maskUsed, sentPictureKey, sentPrompts } from "@/lib/refine/send";
import type { ToolSettings } from "@/lib/refine/tools";

/** What the panel learns about the target from the server: the presets, the art style, the saved prompt boxes and Always include text. */
type Context = {
  storyPreset: string | null;
  ownPreset: string | null;
  artStyle: string;
  always: string;
  draft: { prompt: string; negative: string } | null;
  moment: PictureMoment;
};

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const boxesOf = (v: unknown): { prompt: string; negative: string } | null => {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  return { prompt: str(o.prompt), negative: str(o.negative) };
};

/** Asks the server for what the Illustrate page would use for this target. The same requests as the page's own components make. */
async function loadContext(target: RefineSession["target"]): Promise<Context> {
  const { storyId } = target;
  const story = await getJson(`/api/stories/${storyId}`);
  const base = { storyPreset: strOrNull(story?.draw_preset), artStyle: str(story?.art_style) };
  if (target.kind === "chapter") {
    const id = target.chapterId;
    const [preset, draft, fixed] = await Promise.all([getJson(`/api/chapters/${id}/picture-preset`), getJson(`/api/chapters/${id}/picture-draft`), getJson(`/api/chapters/${id}/picture-fixed`)]);
    const d = draft?.draft as Record<string, unknown> | null | undefined;
    const moment = d?.moment === "end" ? "end" : "start";
    return { ...base, ownPreset: strOrNull(preset?.draw_preset), always: str(fixed?.fixed), draft: d ? boxesOf(d[moment]) : null, moment };
  }
  if (target.kind === "cover") {
    const [preset, draft] = await Promise.all([getJson(`/api/stories/${storyId}/cover-preset`), getJson(`/api/stories/${storyId}/cover-draft`)]);
    return { ...base, ownPreset: strOrNull(preset?.draw_preset), always: "", draft: boxesOf(draft?.draft), moment: "cover" };
  }
  const entry = encodeURIComponent(target.entryId);
  const [preset, draft] = await Promise.all([getJson(`/api/stories/${storyId}/codex-preset?entry=${entry}`), getJson(`/api/stories/${storyId}/codex-draft?entry=${entry}`)]);
  return { ...base, ownPreset: strOrNull(preset?.draw_preset), always: "", draft: boxesOf(draft?.draft), moment: "codex" };
}

/** A prompt box with its Clear and Reset buttons. */
function Box({
  id,
  label,
  value,
  source,
  onChange,
  min,
  note,
  children,
}: {
  id: string;
  label: string;
  value: string;
  source: string;
  onChange: (v: string) => void;
  min: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="refine-box">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <span className="refine-box-buttons">
          <button type="button" className="secondary" aria-label={`Clear ${label.toLowerCase()}`} title={`Empty the ${label.toLowerCase()} box`} disabled={value === ""} onClick={() => onChange("")}>
            Clear
          </button>
          <button
            type="button"
            className="secondary"
            aria-label={`Reset ${label.toLowerCase()}`}
            title={`Put back the ${label.toLowerCase()} of the picture this started from`}
            disabled={value === source}
            onClick={() => onChange(source)}
          >
            Reset
          </button>
        </span>
      </div>
      <AutoTextarea id={id} aria-label={label} style={{ minHeight: min, fontFamily: "inherit" }} maxLength={LIMITS.picturePrompt} value={value} onChange={(e) => onChange(e.target.value)} />
      {note && <span className="meta prompt-art-style">{note}</span>}
      {children}
    </div>
  );
}

type Props = {
  session: RefineSession;
  /** Changes the session (kept with it in this browser). */
  onSession: (change: (s: RefineSession) => RefineSession) => void;
  present: RefineState;
  canvas: RefObject<RefineCanvasHandle | null>;
  /** The working picture's start picture (for its source), and its size once loaded. */
  picture: StartPicture | null;
  dims: { w: number; h: number } | null;
  tools: ToolSettings;
  onTools: (change: (t: ToolSettings) => ToolSettings) => void;
  status: { ok: boolean; text: string } | null;
  onStatus: (s: { ok: boolean; text: string } | null) => void;
  /** A result is on show: Go is off. */
  locked?: boolean;
};

/**
 * The Prompt panel: the boxes, the strength, the LoRAs and Go. Everything here is this screen's own: it starts from
 * what the Illustrate page would use, and changing it never changes the page's boxes, the chapter's Always include
 * text, the page's LoRA changes or the drawing preset.
 */
export default function RefinePromptPanel({ session, onSession, present, canvas, picture, dims, tools, onTools, status, onStatus, locked = false }: Props) {
  const settings = useSettings();
  const comfy = settings.comfy;
  const editModels = useEditModels(comfy.url);
  const pictureQueue = usePictureQueue();
  const [ctx, setCtx] = useState<Context | null>(null);
  // The painted area is reused (the same object) while it doesn't change, so its upload to ComfyUI is reused too.
  const areaCache = useRef<PaintedArea | null>(null);

  const { target } = session;
  const storyId = target.storyId;
  const chapterId = chapterIdOf(target);
  const entryId = entryIdOf(target);
  useEffect(() => {
    let live = true;
    loadContext(target).then((c) => live && setCtx(c));
    return () => {
      live = false;
    };
    // The target is rebuilt with the session, so what matters is its ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, chapterId, entryId, target.kind]);

  // What Reset goes back to is worked out once and kept in the session: the picture's own prompt, else the page's saved boxes.
  const sourceKnown = session.sourcePrompt !== undefined && session.sourceAlways !== undefined;
  useEffect(() => {
    if (!ctx || sourceKnown) return;
    onSession((s) => ({
      ...s,
      sourcePrompt: s.sourcePrompt ?? s.prompt ?? ctx.draft?.prompt ?? "",
      sourceNegative: s.sourceNegative ?? (s.prompt !== undefined ? (s.negative ?? "") : (ctx.draft?.negative ?? "")),
      sourceAlways: s.sourceAlways ?? ctx.always,
    }));
  }, [ctx, sourceKnown, onSession]);

  // The working picture's own text when it is an applied result, else the original's (worked out from the base, so Undo changes it too).
  const applied = appliedSource(session, present.base);
  const sourcePrompt = applied?.prompt ?? session.sourcePrompt ?? session.prompt ?? "";
  const sourceNegative = applied?.negative ?? session.sourceNegative ?? session.negative ?? "";
  const sourceAlways = session.sourceAlways ?? "";
  const boxPrompt = session.boxPrompt ?? sourcePrompt;
  const boxNegative = session.boxNegative ?? sourceNegative;
  const boxAlways = session.boxAlways ?? sourceAlways;

  // The drawing preset the Illustrate page would use for this target.
  const draw = drawPresetFor(comfy.drawPresets, ctx?.ownPreset, ctx?.storyPreset);
  const fromFamily = usesFamily(draw);
  const familyCheck = drawPresetFamily(editModels, draw);
  const strength = tools.strengths[draw.id] ?? draw.denoise;
  const queueCount = tools.queueCount ?? comfy.queueCount;

  // The LoRAs: the preset's, with the page's changes as the session started, then this screen's own.
  const changes: LoraOverrides = session.loraChanges ?? parseLoras(session.loras);
  const stack = applyLoraOverrides(draw.loras, changes, draw.id);
  const loraFiles = editModels.state === "done" ? editModels.loras : null;
  const usable = usableLoras(stack, loraFiles ?? draw.loras.map((l) => l.name));
  const setChanges = (next: LoraOverrides) => onSession((s) => ({ ...s, loraChanges: next }));

  const sent = sentPrompts(draw, boxAlways, boxPrompt, boxNegative);
  const area = maskUsed(present);

  // Why Go can't be used, or null.
  let blocked: string | null = null;
  if (locked) blocked = "A result is on show: Apply it or Trash it, or select it again to go back to editing.";
  else if (!dims || !picture) blocked = "The picture isn't loaded yet.";
  else if (!ctx) blocked = "Loading the drawing preset…";
  else if (!comfy.url) blocked = "Add your ComfyUI machine in Settings first.";
  else if (!boxPrompt.trim()) blocked = "Write a prompt first.";
  else if (fromFamily && !familyCheck) {
    blocked = editModels.state === "error" ? `Couldn't ask ComfyUI which files it has: ${editModels.message}` : "Still asking ComfyUI which files it has for the drawing preset.";
  } else if (fromFamily && familyCheck && !familyCheck.ready) {
    blocked = `The drawing preset “${presetName(draw)}” can't draw yet. ${familyProblems(familyCheck).join(" ")}`;
  } else if (!fromFamily && !canStart(draw.workflow)) blocked = "The drawing preset's workflow can't start from a picture.";

  function go() {
    const cv = canvas.current;
    if (blocked || !cv || !picture || !dims || !ctx) return;
    onStatus(null);
    // The picture as the author sees it (the base and the visible paint) is taken now, so later painting doesn't change this job.
    const flat = cv.getFlattened();
    flat.catch(() => undefined);
    const start: StartPicture = { key: sentPictureKey(session.id, present), thumb: picture.thumb, source: picture.source, blob: () => flat };
    let mask: PaintedArea | null = null;
    if (area) {
      const id = maskId(area);
      if (areaCache.current?.id !== id || areaCache.current.width !== dims.w || areaCache.current.height !== dims.h) {
        areaCache.current = { ...area, id, width: dims.w, height: dims.h };
      }
      mask = areaCache.current;
    }
    const input: JobInput = {
      prompt: sent.prompt.trim(),
      negative: sent.negative.trim(),
      moment: ctx.moment,
      comfy,
      draw,
      drawLoras: usable.loras,
      family: fromFamily ? familyCheck : null,
      redraw: strength,
      start,
      mask,
      edit: null,
      seed: null,
      ipAdapter: drawPresetIpAdapter(editModels, draw),
      temporary: true,
      session: session.id,
      base: present.base,
    };
    for (let i = 0; i < queueCount; i++) {
      pictureQueue.ask({
        ...target,
        input,
        view: {
          prompt: input.prompt,
          negative: input.negative,
          checkpoint: madeWithText(input),
          width: dims.w,
          height: dims.h,
          denoise: denoiseOf(input),
          source: start.source,
          mask: maskOf(input)?.id ?? null,
          refs: [],
          instruction: null,
          editModel: null,
          moment: ctx.moment,
        },
      });
    }
    onStatus({ ok: true, text: "Queued…" });
  }

  return (
    <section className="refine-panel" aria-label="Prompt and Go">
      <h2>Prompt</h2>
      <Box id="refine-prompt" label="Prompt" value={boxPrompt} source={sourcePrompt} onChange={(v) => onSession((s) => ({ ...s, boxPrompt: v }))} min="5rem">
        {ctx?.artStyle.trim() && (
          <span className="meta prompt-art-style" title="The story's art style, added to the end of every prompt when it is written">
            {ctx.artStyle.trim()}
          </span>
        )}
        {draw.prompt.trim() && (
          <span className="meta prompt-art-style" title="The drawing preset's prompt, added to every prompt">
            Preset: {draw.prompt.trim()}
          </span>
        )}
      </Box>
      <Box id="refine-negative" label="Negative prompt" value={boxNegative} source={sourceNegative} onChange={(v) => onSession((s) => ({ ...s, boxNegative: v }))} min="2.6rem">
        {draw.negative.trim() && (
          <span className="meta prompt-art-style" title="The drawing preset's negative prompt, added to every negative prompt">
            Preset: {draw.negative.trim()}
          </span>
        )}
      </Box>
      <Box
        id="refine-always"
        label="Always add"
        value={boxAlways}
        source={sourceAlways}
        onChange={(v) => onSession((s) => ({ ...s, boxAlways: v }))}
        min="2.6rem"
        note={target.kind === "chapter" ? "Starts as the chapter's Always include text; changing it here doesn't change the chapter." : undefined}
      />
      <label className="strength">
        Strength {strength.toFixed(2)}
        <input
          type="range"
          aria-label="Strength"
          min={0.05}
          max={1}
          step={0.05}
          value={strength}
          onChange={(e) => {
            const v = Number(e.target.value);
            onTools((t) => ({ ...t, strengths: { ...t.strengths, [draw.id]: v } }));
          }}
        />
        <span className="strength-ends" aria-hidden="true">
          <span>Low</span>
          <span>High</span>
        </span>
      </label>
      {draw.loras.length > 0 && (
        <LoraToggles
          stack={stack}
          available={loraFiles}
          href={`/settings#preset-${draw.id}`}
          changed={hasLoraOverrides(draw.loras, changes, draw.id)}
          onChange={(i, patch) => setChanges(setLoraOverride(changes, draw.id, draw.loras, i, patch))}
          onReset={() => setChanges(resetLoraOverrides(changes, draw.id))}
        />
      )}
      <div className="queue-row">
        <button type="button" className="queue-button" onClick={go} disabled={blocked !== null} title={blocked ?? (area ? "Redraw the masked part of the picture" : "Redraw the whole picture")}>
          Go
        </button>
        <select
          aria-label="Pictures per click"
          title="How many pictures one click of Go asks for"
          value={queueCount}
          onChange={(e) => {
            const n = Number(e.target.value);
            onTools((t) => ({ ...t, queueCount: n }));
          }}
          style={{ width: "auto" }}
        >
          {QUEUE_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <p className="meta prompt-art-style">
        Drawing preset: {presetName(draw)}. {area ? "Redrawing only the masked part." : "No mask in use: the whole picture is redrawn."}
      </p>
      {status && (
        <p className={status.ok ? "ok" : "error"} role="status" style={{ margin: 0 }}>
          {status.text}
        </p>
      )}
    </section>
  );
}

/** Whether a drawing preset's workflow ("" is the built-in one) can start from a picture. */
function canStart(workflow: string): boolean {
  try {
    return describeWorkflow(parseWorkflow(workflow)).image;
  } catch {
    return false;
  }
}
