// The paint layer of the Refine screen: what a paint stroke is made of, the geometry that turns a stroke into
// soft round stamps (pure, so it can be tested without a canvas), and thin canvas wrappers that draw the stamps.
// The paint layer is separate from the picture and from the mask; erasing only removes paint, so the picture
// underneath comes back.

import { strokeWidth, type Ctx } from "./mask";

export type PaintTool = "brush" | "airbrush" | "eraser";
export type PaintPoint = [x: number, y: number, pressure: number, t: number];
export type PaintStroke = {
  tool: PaintTool;
  /** "#rrggbb" (ignored by the eraser). */
  color: string;
  /** Diameter in picture pixels. */
  size: number;
  /** 0 hard edge .. 1 very soft. */
  softness: number;
  /** 0..1: the most paint a single stroke can lay down. */
  opacity: number;
  /** x, y in picture pixels; pressure 0 = not a pen; t = ms since the stroke started (the airbrush uses it). */
  points: PaintPoint[];
};

export const MAX_PAINT_STROKES = 5000;
export const MAX_PAINT_POINTS = 20000;
export const MIN_PAINT_SIZE = 1;
export const MAX_PAINT_SIZE = 2000;

/** How much of its opacity each airbrush stamp lays down (paint builds up over many stamps). */
export const AIRBRUSH_FLOW = 0.08;
/** Airbrush stamps per second, also while the pointer is still. */
export const AIRBRUSH_RATE = 40;

// ---- colour ----

export const isHexColor = (s: unknown): s is string => typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

/** "#rgb" or "#rrggbb" in any case → "#rrggbb" lower case; null for anything else. */
export function normalizeHex(s: unknown): string | null {
  if (!isHexColor(s)) return null;
  const h = s.slice(1).toLowerCase();
  return "#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
}

function rgbOf(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

// ---- geometry (pure) ----

export type Stamp = { x: number; y: number; /** radius in picture pixels */ r: number; /** index of the point that ended the segment this stamp is on */ i: number };

/** Where a stroke left off, so the next call carries on with the same spacing. Pass back what the last call returned. */
export type StampCarry = { last: [x: number, y: number, pressure: number] | null; /** distance still to go until the next stamp */ next: number };

const radiusOf = (size: number, pressure: number) => strokeWidth(size, pressure) / 2;

/**
 * Evenly spaced stamp centres along the polyline `points`. Spacing is `spacingFraction` of the size (not of the
 * pressure-scaled size, so it stays steady). A pen scales each stamp's radius with the pressure at that place
 * (interpolated); pressure 0 (mouse, finger) is full size. For incremental drawing pass only the NEW points and
 * the `carry` the last call returned: splitting a stroke anywhere gives the same stamps as drawing it whole.
 * The very first point of a stroke gets a stamp straight away.
 */
export function stampPositions(points: ArrayLike<readonly number[]>, size: number, spacingFraction = 0.12, carry?: StampCarry | null, indexOffset = 0): { stamps: Stamp[]; carry: StampCarry } {
  const step = Math.max(0.5, size * spacingFraction);
  const stamps: Stamp[] = [];
  let last = carry?.last ?? null;
  let next = carry?.next ?? 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const cur: [number, number, number] = [p[0], p[1], p[2] ?? 0];
    if (!last) {
      stamps.push({ x: cur[0], y: cur[1], r: radiusOf(size, cur[2]), i: indexOffset + i });
      last = cur;
      next = step;
      continue;
    }
    const dx = cur[0] - last[0];
    const dy = cur[1] - last[1];
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      let pos = next;
      while (pos <= len) {
        const f = pos / len;
        stamps.push({ x: last[0] + dx * f, y: last[1] + dy * f, r: radiusOf(size, last[2] + (cur[2] - last[2]) * f), i: indexOffset + i });
        pos += step;
      }
      next = pos - len;
    }
    last = cur;
  }
  return { stamps, carry: { last, next } };
}

export type AirbrushCarry = { last: PaintPoint | null; /** time of the next stamp, ms since the stroke started */ nextT: number };

/**
 * Airbrush stamps at `rate` per second by the clock (`t`), so holding still keeps adding paint as long as the
 * caller keeps appending points with a later `t` (the same place is fine). Incremental like `stampPositions`.
 */
export function airbrushStamps(points: ArrayLike<readonly number[]>, size: number, carry?: AirbrushCarry | null, rate = AIRBRUSH_RATE, indexOffset = 0): { stamps: Stamp[]; carry: AirbrushCarry } {
  const interval = 1000 / Math.max(1, rate);
  const stamps: Stamp[] = [];
  let last = carry?.last ?? null;
  let nextT = carry?.nextT ?? 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const cur: PaintPoint = [p[0], p[1], p[2] ?? 0, p[3] ?? 0];
    if (!last) {
      stamps.push({ x: cur[0], y: cur[1], r: radiusOf(size, cur[2]), i: indexOffset + i });
      last = cur;
      nextT = cur[3] + interval;
      continue;
    }
    const span = cur[3] - last[3];
    while (nextT <= cur[3]) {
      const f = span > 0 ? (nextT - last[3]) / span : 1;
      stamps.push({ x: last[0] + (cur[0] - last[0]) * f, y: last[1] + (cur[1] - last[1]) * f, r: radiusOf(size, last[2] + (cur[2] - last[2]) * f), i: indexOffset + i });
      nextT += interval;
    }
    last = cur;
  }
  return { stamps, carry: { last, nextT } };
}

/** The stamps of a whole stroke (the airbrush by time, the others by distance). */
export function strokeStamps(stroke: PaintStroke): Stamp[] {
  return stroke.tool === "airbrush" ? airbrushStamps(stroke.points, stroke.size).stamps : stampPositions(stroke.points, stroke.size).stamps;
}

/**
 * The alpha (0..1) at each offset (0 centre .. 1 edge) of a stamp's radial gradient. Hardness is 1 − softness:
 * fully opaque out to hardness·r, then a smooth falloff to 0 at r. Offsets rise and alphas never rise.
 */
export function stampGradientStops(softness: number): { offset: number; alpha: number }[] {
  const s = Math.min(1, Math.max(0, Number.isFinite(softness) ? softness : 0));
  const h = 1 - s;
  if (h >= 1) return [{ offset: 0, alpha: 1 }, { offset: 1, alpha: 1 }];
  const stops = [{ offset: 0, alpha: 1 }];
  if (h > 0) stops.push({ offset: h, alpha: 1 });
  const n = 6;
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    stops.push({ offset: h + (1 - h) * u, alpha: k === n ? 0 : 1 - u * u * (3 - 2 * u) });
  }
  return stops;
}

// ---- canvases ----

type CanvasLike = (HTMLCanvasElement | OffscreenCanvas) & CanvasImageSource;
export type MakeCanvas = (width: number, height: number) => CanvasLike;

/** A new canvas: an OffscreenCanvas where there is one, else a canvas element. */
export const defaultMakeCanvas: MakeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h) as CanvasLike;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c as CanvasLike;
};

const ctxOf = (c: CanvasLike) => c.getContext("2d") as Ctx | null;

function drawStamps(ctx: Ctx, stroke: PaintStroke, stamps: Stamp[], flow: number, color: string) {
  const [r, g, b] = rgbOf(color);
  const stops = stampGradientStops(stroke.softness);
  for (const s of stamps) {
    if (!(s.r > 0)) continue;
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
    for (const st of stops) grad.addColorStop(st.offset, `rgba(${r},${g},${b},${(st.alpha * flow).toFixed(4)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
}

/** Draws one stroke into `scratch` at full alpha, then composites it onto `ctx` ONCE at the stroke's opacity. */
function compositeStroke(ctx: Ctx, scratchCanvas: CanvasLike, stroke: PaintStroke) {
  const sctx = ctxOf(scratchCanvas);
  if (!sctx || stroke.points.length === 0) return;
  sctx.save();
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = "source-over";
  sctx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  drawStamps(sctx, stroke, strokeStamps(stroke), stroke.tool === "airbrush" ? AIRBRUSH_FLOW : 1, stroke.tool === "eraser" ? "#000000" : stroke.color);
  sctx.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.globalAlpha = Math.min(1, Math.max(0, stroke.opacity));
  ctx.drawImage(scratchCanvas, 0, 0);
  ctx.restore();
}

/**
 * Draws a stroke onto the paint layer `ctx` (which must have its `canvas`). `from` 0 draws the whole stroke
 * exactly: stamps go to a scratch layer at full alpha and are composited once at the stroke's opacity, so
 * overlapping stamps never exceed it. `from` > 0 is the live preview while a stroke grows: it draws only the
 * stamps on points from index `from` on, straight onto `ctx` at the stroke's opacity (overlaps at the joins
 * may be a little denser until the finished stroke is drawn whole). The eraser removes paint with
 * `destination-out`; it only touches this layer, never the picture.
 */
export function drawPaintStroke(ctx: Ctx, stroke: PaintStroke, from = 0, makeCanvas: MakeCanvas = defaultMakeCanvas): void {
  if (stroke.points.length === 0) return;
  if (from <= 0) {
    compositeStroke(ctx, makeCanvas(ctx.canvas.width, ctx.canvas.height), stroke);
    return;
  }
  const stamps = strokeStamps(stroke).filter((s) => s.i >= from);
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.globalAlpha = Math.min(1, Math.max(0, stroke.opacity));
  drawStamps(ctx, stroke, stamps, stroke.tool === "airbrush" ? AIRBRUSH_FLOW : 1, stroke.tool === "eraser" ? "#000000" : stroke.color);
  ctx.restore();
}

/** Clears `ctx` and replays all the strokes in order onto it (transparent where nothing is painted). */
export function renderPaintLayer(ctx: Ctx, width: number, height: number, strokes: PaintStroke[], makeCanvas: MakeCanvas = defaultMakeCanvas): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  ctx.restore();
  if (strokes.length === 0) return;
  const scratch = makeCanvas(width, height);
  for (const s of strokes) compositeStroke(ctx, scratch, s);
}

const toBlob = (c: CanvasLike): Promise<Blob> =>
  "convertToBlob" in c
    ? (c as OffscreenCanvas).convertToBlob({ type: "image/png" })
    : new Promise((resolve, reject) => (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("Could not make the picture."))), "image/png"));

/** A PNG of the base picture with the paint layer on top when `visible` (hidden paint is never included). */
export async function flattenToBlob(base: CanvasImageSource, width: number, height: number, strokes: PaintStroke[], visible: boolean, makeCanvas: MakeCanvas = defaultMakeCanvas): Promise<Blob> {
  const out = makeCanvas(width, height);
  const octx = ctxOf(out);
  if (!octx) throw new Error("Could not make the picture.");
  octx.drawImage(base, 0, 0, width, height);
  if (visible && strokes.length > 0) {
    const layer = makeCanvas(width, height);
    const lctx = ctxOf(layer);
    if (lctx) {
      renderPaintLayer(lctx, width, height, strokes, makeCanvas);
      octx.drawImage(layer, 0, 0);
    }
  }
  return toBlob(out);
}

/** The alpha-weighted average colour of RGBA data as "#rrggbb"; null when every pixel is fully transparent. */
export function averageColor(data: ArrayLike<number>): string | null {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= 0) continue;
    r += data[i] * a;
    g += data[i + 1] * a;
    b += data[i + 2] * a;
    w += a;
  }
  return w > 0 ? toHex(r / w, g / w, b / w) : null;
}

/** Eyedropper: the average colour of the square of side 2·radius+1 around (x, y) of an already flattened view; null if it is all transparent. */
export function pickColor(ctx: Ctx, x: number, y: number, radius = 1): string | null {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor(x) - radius);
  const y0 = Math.max(0, Math.floor(y) - radius);
  const x1 = Math.min(w, Math.floor(x) + radius + 1);
  const y1 = Math.min(h, Math.floor(y) + radius + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  return averageColor(ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data);
}

// ---- keeping it ----

/** What is kept in localStorage for a picture's paint: the picture size it fits, and the strokes. */
export type StoredPaint = { width: number; height: number; strokes: PaintStroke[] };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Strokes read back from storage; anything malformed is dropped (a stroke) or gives an empty list (not a list). */
export function readPaintStrokes(v: unknown): PaintStroke[] {
  if (!Array.isArray(v)) return [];
  const out: PaintStroke[] = [];
  for (const s of v) {
    if (out.length >= MAX_PAINT_STROKES) break;
    if (!isObject(s) || (s.tool !== "brush" && s.tool !== "airbrush" && s.tool !== "eraser") || !isNum(s.size) || !isNum(s.softness) || !isNum(s.opacity) || !Array.isArray(s.points)) continue;
    const color = normalizeHex(s.color);
    if (!color) continue;
    const points: PaintPoint[] = [];
    let bad = false;
    for (const p of s.points) {
      if (points.length >= MAX_PAINT_POINTS) break;
      if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) { bad = true; break; }
      points.push([p[0], p[1], isNum(p[2]) ? clamp(p[2], 0, 1) : 0, isNum(p[3]) ? Math.max(0, p[3]) : 0]);
    }
    if (bad || points.length === 0) continue;
    out.push({ tool: s.tool, color, size: clamp(s.size, MIN_PAINT_SIZE, MAX_PAINT_SIZE), softness: clamp(s.softness, 0, 1), opacity: clamp(s.opacity, 0, 1), points });
  }
  return out;
}

/** Roughly how many bytes the strokes take as JSON (to keep within localStorage). */
export function paintBytesEstimate(strokes: PaintStroke[]): number {
  let n = 2;
  for (const s of strokes) n += 90 + s.points.length * 28;
  return n;
}
