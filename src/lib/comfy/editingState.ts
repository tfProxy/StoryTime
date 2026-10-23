// What the Illustrate page keeps in this browser so a refresh doesn't lose the picture being edited or
// redrawn, the mode, and the edit's text and strength. Per chapter (and one set for the story's cover),
// named by `stateKey`; browser code.
import type { PictureSlot, PictureTarget } from "../pictureTarget";
import type { MaskState, MaskStroke } from "../mask";
import type { ComfyImage } from "./client";
import type { LoraOverride, LoraOverrides } from "./loraOverrides";

/** What the stored values are kept under: the chapter's id (as before covers), `cover-<story id>` or `codex-<entry id>`. */
export const stateKey = (t: PictureTarget) => (t.kind === "chapter" ? t.chapterId : t.kind === "cover" ? `cover-${t.storyId}` : `codex-${t.entryId}`);

const key = (name: string, chapterId: string) => `storytime.illustrate.${name}.${chapterId}`;

function read(name: string, chapterId: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key(name, chapterId)) ?? "null");
  } catch {
    return null;
  }
}

function write(name: string, chapterId: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key(name, chapterId));
    else localStorage.setItem(key(name, chapterId), JSON.stringify(value));
  } catch {
    // private window or blocked storage: the page just starts fresh next time
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The starting picture (one of ComfyUI's, or a saved header, footer or cover) and whether it is redrawn or edited. */
export type StoredStart = { mode: "redraw" | "edit"; image?: ComfyImage; slot?: PictureSlot; mask?: StoredMask };

/** The painted area of a starting picture: its strokes (the PNG is drawn from them again) and the picture's size. */
export type StoredMask = MaskState & { width: number; height: number };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readMask(v: unknown): StoredMask | undefined {
  if (!isObject(v) || !Array.isArray(v.strokes) || !isNum(v.softness) || typeof v.inverted !== "boolean") return undefined;
  if (!isNum(v.width) || !isNum(v.height) || v.width < 1 || v.height < 1 || v.width > 16384 || v.height > 16384) return undefined;
  const strokes: MaskStroke[] = [];
  for (const s of v.strokes) {
    if (!isObject(s) || (s.tool !== "brush" && s.tool !== "eraser" && s.tool !== "fill") || !isNum(s.size) || !Array.isArray(s.points)) return undefined;
    const points: MaskStroke["points"] = [];
    for (const p of s.points) {
      if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) return undefined;
      points.push([p[0], p[1], isNum(p[2]) ? p[2] : 0]);
    }
    strokes.push({ tool: s.tool, size: s.size, points });
  }
  return strokes.length > 0 ? { strokes, softness: Math.max(0, v.softness), inverted: v.inverted, width: v.width, height: v.height } : undefined;
}

export function readStart(chapterId: string): StoredStart | null {
  const v = read("start", chapterId);
  if (!isObject(v) || (v.mode !== "redraw" && v.mode !== "edit")) return null;
  const mask = readMask(v.mask);
  const im = v.image;
  if (isObject(im) && typeof im.filename === "string" && typeof im.subfolder === "string" && typeof im.type === "string") {
    return { mode: v.mode, image: { filename: im.filename, subfolder: im.subfolder, type: im.type }, ...(mask && { mask }) };
  }
  if (v.slot === "header" || v.slot === "footer" || v.slot === "cover") return { mode: v.mode, slot: v.slot, ...(mask && { mask }) };
  return null;
}

export const writeStart = (chapterId: string, start: StoredStart | null) => write("start", chapterId, start);

/**
 * What the Edit tab has in it: the instruction, and the strength when it was moved from the preset's
 * default (`model` is the edit preset it was moved for; without it the default applies). It is named
 * `model` because it was an edit model's id before presets, and each model's first preset has its id.
 */
export type StoredEdit = { instruction: string; strength: number; model?: string };

export function readEdit(chapterId: string): StoredEdit | null {
  const v = read("edit", chapterId);
  if (!isObject(v) || typeof v.instruction !== "string" || typeof v.strength !== "number") return null;
  return {
    instruction: v.instruction,
    strength: Math.min(1, Math.max(0.05, v.strength)),
    ...(typeof v.model === "string" && v.model && { model: v.model }),
  };
}

export const writeEdit = (chapterId: string, edit: StoredEdit) => write("edit", chapterId, edit);

/** The LoRA switches and strengths changed on the page (never the preset's own), by preset id; see `loraOverrides.ts`. */
export function readLoras(chapterId: string): LoraOverrides {
  const v = read("loras", chapterId);
  const out: LoraOverrides = {};
  if (!isObject(v)) return out;
  for (const [preset, rows] of Object.entries(v)) {
    if (!preset || !isObject(rows)) continue;
    const mine: Record<string, LoraOverride> = {};
    for (const [index, o] of Object.entries(rows)) {
      if (!/^\d{1,2}$/.test(index) || !isObject(o) || typeof o.name !== "string" || !o.name) continue;
      const row: LoraOverride = { name: o.name };
      if (typeof o.on === "boolean") row.on = o.on;
      if (isNum(o.strength)) row.strength = Math.min(4, Math.max(-4, o.strength));
      if (row.on !== undefined || row.strength !== undefined) mine[index] = row;
    }
    if (Object.keys(mine).length > 0) out[preset] = mine;
  }
  return out;
}

export const writeLoras = (chapterId: string, loras: LoraOverrides) => write("loras", chapterId, Object.keys(loras).length > 0 ? loras : null);

/** The Redraw tab's strength when it was moved from the drawing preset's default, and the preset it was moved for. */
export type StoredRedraw = { preset: string; strength: number };

export function readRedraw(chapterId: string): StoredRedraw | null {
  const v = read("redraw", chapterId);
  if (!isObject(v) || typeof v.preset !== "string" || !v.preset || typeof v.strength !== "number") return null;
  return { preset: v.preset, strength: Math.min(1, Math.max(0.05, v.strength)) };
}

export const writeRedraw = (chapterId: string, redraw: StoredRedraw | null) => write("redraw", chapterId, redraw);
