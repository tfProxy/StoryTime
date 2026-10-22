// Turning what the author asked for on the Illustrate page into a job on ComfyUI: checking it, uploading
// the starting picture, filling the workflow and queueing it. The picture queue (`PictureQueue`) calls it
// and then waits for the pictures. Browser code, no React.
import type { PictureMoment, PictureTarget } from "../pictureTarget";
import type { ComfySettings } from "../settingsSchema";
import { buildDraw, drawTuning, familyProblems, type FamilyCheck } from "./drawModels";
import { buildEdit, EDIT_REFS, editFilesText, editSize, type EditCheck, type EditLora, type EditTuning, type TextEncoderDevice } from "./editModels";
import { drawFilesText, presetName, usesFamily, type DrawPreset } from "./presets";
import { ipAdapterProblem, type IpAdapterCheck } from "./ipAdapter";
import { MAX_REFERENCES, storedOf, uploadReference, type Reference } from "./references";
import { uploadStart, type StartPicture, type Uploaded } from "./startPicture";
import { builtinSampler, describeWorkflow, fillWorkflow, filenamePrefix, parseWorkflow, randomSeed } from "./workflow";
import { cancelPrompt, queuePrompt, uploadImage, type Progress } from "./client";
import { renderMask, type PaintedArea } from "../mask";
import type { JobRecord, JobTag } from "./jobTag";

/** Everything a job is made with, as it was when it was asked for. */
export type JobInput = {
  prompt: string;
  negative: string;
  moment: PictureMoment;
  comfy: ComfySettings;
  /** The drawing preset, its LoRAs that are switched on and in ComfyUI, and the Redraw strength (for new pictures and Redraw). */
  draw: DrawPreset;
  drawLoras: EditLora[];
  /** What ComfyUI has for the drawing preset's model family and the files it chose; null for a checkpoint preset, one with a workflow of its own, or before ComfyUI has answered. */
  family: FamilyCheck | null;
  redraw: number;
  start: StartPicture | null;
  /** The painted part of the starting picture to redraw (Redraw only; ignored by an edit); null for the whole picture. */
  mask?: PaintedArea | null;
  /** An edit of the starting picture by instruction, with the model to make it; null to redraw it or make new pictures. */
  edit: {
    check: EditCheck;
    instruction: string;
    strength: number;
    /** With the model's speed-up (Qwen's Lightning LoRA). */
    fast: boolean;
    /** The author's LoRAs for the model that are switched on and in ComfyUI. */
    loras: EditLora[];
    /** The model's settings from Settings (steps, CFG, sampler…). */
    tuning: EditTuning;
    /** Where the text encoder is loaded (the preset's setting). */
    textEncoderDevice: TextEncoderDevice;
  } | null;
  /** The seed to use, or null for a random one. */
  seed: number | null;
  /** Reference pictures (at most MAX_REFERENCES); none by default. A drawing uses them through IP-Adapter, an edit as extra images. */
  refs?: Reference[];
  /** What ComfyUI has for IP-Adapter for the drawing preset's model base (see `drawPresetIpAdapter`); needed when `refs` is used for drawing. */
  ipAdapter?: IpAdapterCheck | null;
};

/** How many references an edit model really uses: the rest are left out of the job and its record. */
export const editRefLimit = (modelId: string) => (modelId === "flux-kontext" ? EDIT_REFS.kontext : EDIT_REFS.qwen);

/** The references a job really uses (an edit model takes only its first one or two). */
export const refsOf = (i: JobInput): Reference[] => (i.edit ? (i.refs ?? []).slice(0, editRefLimit(i.edit.check.model.id)) : i.refs ?? []);

/** The strength a job's pictures are recorded with: a redraw's, an edit's when it is less than full, else null. */
export const denoiseOf = (i: JobInput) => (i.edit ? (i.edit.strength < 1 ? i.edit.strength : null) : i.start ? i.redraw : null);

/** What the log will say the pictures were made with: the edit model's files, or the drawing preset's checkpoint (or family's model file) and LoRAs. */
export const madeWithText = (i: JobInput) =>
  i.edit ? editFilesText(i.edit.check, i.edit.fast, i.edit.loras) : drawFilesText(i.family?.files.model ?? i.draw.checkpoint, i.drawLoras);

/** The mask a job really uses: only a Redraw from a starting picture has one. */
export const maskOf = (i: JobInput) => (i.start && !i.edit ? i.mask ?? null : null);

/** What has to match for a click to join the job being gathered. */
export const sameJob = (a: JobInput) =>
  JSON.stringify([
    a.prompt, a.negative, a.moment, a.comfy.url, a.comfy.width, a.comfy.height, a.start?.key ?? null,
    a.edit ? null : [a.draw.checkpoint, a.draw.workflow, a.draw.sampler, a.drawLoras, a.draw.family, a.family?.files ?? null, a.draw.textEncoderDevice],
    a.start && !a.edit ? a.redraw : null, maskOf(a)?.id ?? null,
    a.edit?.check.model.id ?? null, a.edit?.instruction ?? null,
    a.edit?.strength ?? null, a.edit?.fast ?? null, a.edit?.loras ?? null, a.edit?.tuning ?? null, a.edit?.textEncoderDevice ?? null, a.seed,
    refsOf(a).map((r) => [r.key, r.role, r.weight]),
  ]);

/** A mask's upload to ComfyUI, kept (by the mask object, which changes whenever the mask does) so the next job with it doesn't send it again. */
const maskUploads = new WeakMap<PaintedArea, { url: string; name: Promise<string> }>();

/** Draws the mask and uploads it next to the starting picture; its name in ComfyUI's input folder. */
function uploadMask(comfyUrl: string, area: PaintedArea): Promise<string> {
  const cached = maskUploads.get(area);
  if (cached?.url === comfyUrl) return cached.name;
  const name = (async () => {
    const rendered = await renderMask(area, area.width, area.height);
    if (!rendered) throw new Error("The painted area is empty. Paint the part to redraw again, or clear it.");
    return uploadImage(comfyUrl, rendered.blob, `storytime-mask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`);
  })();
  maskUploads.set(area, { url: comfyUrl, name });
  // the next job tries the upload again
  name.catch(() => {
    if (maskUploads.get(area)?.name === name) maskUploads.delete(area);
  });
  return name;
}

/** A starting picture's upload to ComfyUI, kept so the next job from it doesn't send it again. */
export type UploadCache = { current: { key: string; upload: Promise<Uploaded> } | null };

export type MadeJob = { promptId: string; clientId: string; record: JobRecord };

/**
 * Checks the job, uploads its starting picture and queues it on ComfyUI with the prompt and settings it was
 * asked with. `onSize` is told the pictures' size once a starting picture decides it; `onPromptId` the
 * ComfyUI id as soon as it is known, so Stop can take the job off ComfyUI's queue.
 */
export async function queueJob(
  input: JobInput,
  count: number,
  ids: PictureTarget & { instance: string | null },
  hooks: {
    signal: AbortSignal;
    uploads: UploadCache;
    onProgress: (p: Progress) => void;
    onSize: (width: number, height: number) => void;
    onPromptId: (id: string) => void;
    /** Called once the job is checked and ready, just before it goes to ComfyUI; must not throw. */
    beforeQueue?: () => Promise<void>;
  },
): Promise<MadeJob> {
  const { prompt, negative, moment, comfy, draw, drawLoras, start, edit, family } = input;
  const { signal, uploads, onProgress } = hooks;
  onProgress({ stage: "queued", ahead: null });
  const seed = input.seed ?? randomSeed();
  // Names this job's WebSocket connection, so ComfyUI sends its progress there.
  const clientId = `storytime-${randomSeed().toString(36)}`;
  // An edit uses its own workflow, so the drawing preset doesn't matter. A model family has its own, unless the preset pastes one.
  const fromFamily = !edit && usesFamily(draw);
  const base = edit || fromFamily ? null : parseWorkflow(draw.workflow);
  if (edit) {
    if (!start) throw new Error("Choose a picture to edit first.");
    if (!edit.instruction) throw new Error("Say what to change first.");
  } else if (fromFamily) {
    if (!prompt) throw new Error("Write or type a prompt first.");
    if (!family) throw new Error(`Still asking ComfyUI which files it has for the drawing preset “${presetName(draw)}”. Try again in a moment.`);
    if (!family.ready) throw new Error(`The drawing preset “${presetName(draw)}” can't draw yet. ${familyProblems(family).join(" ")} Settings › Drawing has the details.`);
  } else {
    if (!prompt) throw new Error("Write or type a prompt first.");
    if (describeWorkflow(base!).checkpoint && !draw.checkpoint) {
      throw new Error(`The drawing preset “${presetName(draw)}” has no checkpoint. Choose one in Settings › Drawing.`);
    }
    if (start && !describeWorkflow(base!).image) {
      throw new Error("Your workflow can't start from a picture. Clear the starting picture, or see Settings for how to allow it.");
    }
    if (start && maskOf(input) && !describeWorkflow(base!).mask) {
      throw new Error("Your workflow can't redraw only part of a picture. Clear the painted area, or add {{mask}} to the workflow (see Settings).");
    }
  }
  const refs = refsOf(input);
  if (refs.length > MAX_REFERENCES) throw new Error(`A picture can use at most ${MAX_REFERENCES} reference pictures.`);
  if (refs.length > 0 && !edit) {
    if (fromFamily) {
      throw new Error(`The drawing preset “${presetName(draw)}” is for a model family, and those can't use reference pictures yet. Take the references out, or draw with a checkpoint preset.`);
    }
    if (!describeWorkflow(base!).refs) {
      throw new Error("Your workflow can't take reference pictures (it has placeholders). Take the references out, or use a workflow without placeholders.");
    }
    const problem = ipAdapterProblem(input.ipAdapter ?? null);
    if (problem) throw new Error(problem);
  }
  let from: Uploaded | null = null;
  if (start) {
    onProgress({ stage: "uploading" });
    const key = `${comfy.url}\n${start.key}`;
    if (uploads.current?.key !== key) uploads.current = { key, upload: uploadStart(comfy.url, start) };
    const upload = uploads.current;
    try {
      from = await upload.upload;
    } catch (e) {
      // the next job tries the upload again
      if (uploads.current === upload) uploads.current = null;
      throw e;
    }
    onProgress({ stage: "queued", ahead: null });
  }
  // The painted part of a Redraw goes up beside the starting picture, and has to be its size.
  let maskName: string | null = null;
  const area = maskOf(input);
  if (from && area) {
    if (area.width !== from.width || area.height !== from.height) {
      throw new Error("The painted area was made for a picture of another size. Paint it again, or clear it.");
    }
    onProgress({ stage: "uploading" });
    maskName = await uploadMask(comfy.url, area);
    onProgress({ stage: "queued", ahead: null });
  }
  // The references go up once each, like the starting picture.
  let refNames: string[] = [];
  if (refs.length > 0) {
    onProgress({ stage: "uploading" });
    refNames = await Promise.all(refs.map((r) => uploadReference(comfy.url, r)));
    onProgress({ stage: "queued", ahead: null });
  }
  // From a picture the pictures are its size; an edit is its shape at about one megapixel.
  const { width, height } = from && edit ? editSize(from.width, from.height) : { width: from?.width ?? comfy.width, height: from?.height ?? comfy.height };
  if (from) hooks.onSize(width, height);
  const prefix = filenamePrefix(ids.storyId, ids.chapterId);
  const workflow =
    edit && from
      ? buildEdit(
          edit.check,
          { image: from.name, instruction: edit.instruction, seed, count, width, height, prefix, denoise: edit.strength, loras: edit.loras, tuning: edit.tuning, textEncoderDevice: edit.textEncoderDevice, refs: refNames },
          edit.fast,
        )
      : fromFamily && family
        ? buildDraw(family, {
            prompt, negative, seed, count, width, height, prefix,
            loras: drawLoras,
            tuning: drawTuning(family.model, draw.sampler),
            textEncoderDevice: draw.textEncoderDevice,
            ...(from && { image: from.name, denoise: input.redraw, ...(maskName && { mask: maskName }) }),
          })
      : fillWorkflow(base!, {
          prompt,
          negative,
          checkpoint: draw.checkpoint,
          width,
          height,
          count,
          seed,
          prefix,
          sampler: builtinSampler(draw.sampler),
          loras: drawLoras,
          ...(refs.length > 0 && {
            refs: refs.map((r, i) => ({ image: refNames[i], role: r.role, weight: r.weight })),
            ipAdapter: { ipadapter: input.ipAdapter!.files.ipAdapter, clipVision: input.ipAdapter!.files.clipVision },
          }),
          ...(from && { image: from.name, denoise: input.redraw, ...(maskName && { mask: maskName }) }),
        });
  const denoise = from ? denoiseOf(input) : null;
  // Everything the log records about the job. It goes to ComfyUI with the job too, so a page opened while
  // the job is being made can find it again (see `PictureQueue`).
  const record: JobRecord = {
    prompt,
    negative,
    checkpoint: madeWithText(input),
    width,
    height,
    seed,
    count,
    moment,
    ...(from && { source: start!.source, denoise }),
    ...(maskName && { mask: maskName }),
    ...(refs.length > 0 && { refs: storedOf(refs) }),
    ...(edit && { instruction: edit.instruction, edit_model: edit.check.model.id }),
  };
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  // A text model on the same machine lets go of the graphics memory first (never holds the job up for long).
  await hooks.beforeQueue?.();
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  const promptId = await queuePrompt(comfy.url, workflow, clientId, { storytime: { chapterId: ids.chapterId, storyId: ids.storyId, clientId, job: record, ...(ids.instance && { instance: ids.instance }) } satisfies JobTag });
  hooks.onPromptId(promptId);
  // Stopped while it was being queued: take it off ComfyUI's queue again.
  if (signal.aborted) {
    void cancelPrompt(comfy.url, promptId);
    throw new DOMException("Stopped", "AbortError");
  }
  return { promptId, clientId, record };
}
