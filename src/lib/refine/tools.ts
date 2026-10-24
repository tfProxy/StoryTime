// The Refine screen's tools and the brush settings kept between sessions (`storytime.refine.tools`).
import { MAX_PAINT_SIZE, MIN_PAINT_SIZE, normalizeHex } from "../paint";
import { QUEUE_COUNTS } from "../settingsSchema";
import { TOOLS_KEY_NAME } from "./session";

export type RefineTool = "paint-brush" | "airbrush" | "paint-eraser" | "eyedropper" | "mask-brush" | "mask-eraser" | "mask-lasso";

export const PAINT_TOOLS: readonly RefineTool[] = ["paint-brush", "airbrush", "paint-eraser", "eyedropper"];
export const MASK_TOOLS: readonly RefineTool[] = ["mask-brush", "mask-eraser", "mask-lasso"];
export const isMaskTool = (t: RefineTool) => MASK_TOOLS.includes(t);

export type ToolSettings = {
  color: string;
  /** Paint brush diameter in picture pixels. */
  size: number;
  /** 0..1, shared by the brush, airbrush and eraser. */
  softness: number;
  /** 0..1 */
  opacity: number;
  /** Mask brush diameter in picture pixels; null = a size that suits the picture. */
  maskSize: number | null;
  /** The strength last used for a Refine job, by drawing preset id; a preset not here starts at its own Redraw strength. */
  strengths: Record<string, number>;
  /** The Pictures per click last chosen here; null = the Illustrate page's setting (`settings.comfy.queueCount`). */
  queueCount: number | null;
};

/** The mask brush's starting size, its largest, and the largest soft edge, for a picture of this size (as in the old mask editor). */
export const defaultMaskSize = (w: number, h: number) => Math.max(4, Math.round(Math.max(w, h) / 20));
export const maxMaskSize = (w: number, h: number) => Math.max(8, Math.round(Math.max(w, h) / 4));
export const maxSoftEdge = (w: number, h: number) => Math.max(4, Math.round(Math.max(w, h) / 20));

export const DEFAULT_TOOLS: ToolSettings = { color: "#e53935", size: 48, softness: 0.4, opacity: 1, maskSize: null, strengths: {}, queueCount: null };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function readTools(raw: unknown): ToolSettings {
  const d = DEFAULT_TOOLS;
  if (typeof raw !== "object" || raw === null) return { ...d };
  const o = raw as Record<string, unknown>;
  return {
    color: normalizeHex(o.color) ?? d.color,
    size: isNum(o.size) ? clamp(o.size, MIN_PAINT_SIZE, MAX_PAINT_SIZE) : d.size,
    softness: isNum(o.softness) ? clamp(o.softness, 0, 1) : d.softness,
    opacity: isNum(o.opacity) ? clamp(o.opacity, 0.05, 1) : d.opacity,
    maskSize: isNum(o.maskSize) ? clamp(o.maskSize, 1, MAX_PAINT_SIZE) : null,
    strengths: readStrengths(o.strengths),
    queueCount: isNum(o.queueCount) && (QUEUE_COUNTS as readonly number[]).includes(o.queueCount) ? o.queueCount : null,
  };
}

function readStrengths(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) if (id && isNum(v)) out[id] = clamp(v, 0.05, 1);
  return out;
}

export function loadTools(): ToolSettings {
  try {
    return readTools(JSON.parse(localStorage.getItem(TOOLS_KEY_NAME) ?? "null"));
  } catch {
    return { ...DEFAULT_TOOLS };
  }
}

export function saveTools(t: ToolSettings): void {
  try {
    localStorage.setItem(TOOLS_KEY_NAME, JSON.stringify(t));
  } catch {
    // private window or blocked storage: the next session starts from the defaults
  }
}
