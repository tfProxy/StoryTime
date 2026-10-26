// Pure helpers for the mask editor: what a mask is made of (a list of strokes in picture pixels), how it is
// drawn onto a canvas, and the maths for zooming. Nothing here needs a DOM, except that the drawing functions
// take a 2D context.

export type MaskTool = "brush" | "eraser" | "fill";
export type MaskStroke = { tool: MaskTool; size: number; points: [x: number, y: number, pressure: number][] };
export type MaskState = { strokes: MaskStroke[]; softness: number; inverted: boolean };
export type MaskResult = MaskState & { blob: Blob; coverage: number };

/** The subset of CanvasRenderingContext2D the drawing needs (so tests can pass a recorder). */
export type Ctx = CanvasRenderingContext2D;

/** The colour the painted area is shown in, in the editor and over the starting picture: a blue that stands out on skin and warm scenes. */
export const MASK_TINT = "rgb(40 120 255)";

export function emptyMask(): MaskState {
  return { strokes: [], softness: 0, inverted: false };
}

/** The mask with its last stroke taken off (the same list if there is none). */
export function withoutLastStroke(strokes: MaskStroke[]): MaskStroke[] {
  return strokes.length === 0 ? strokes : strokes.slice(0, -1);
}

/** Pressure 0 means "not a pen": the brush keeps its full size. A pen scales the line between 25% and 100%. */
export function strokeWidth(size: number, pressure: number): number {
  if (!(pressure > 0)) return size;
  return size * (0.25 + 0.75 * Math.min(1, pressure));
}

/** Picture pixels of a point given in client (screen) coordinates, from the picture's on-screen rectangle. */
export function clientToPicture(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, width: number, height: number): [number, number] {
  if (rect.width <= 0 || rect.height <= 0) return [0, 0];
  return [((clientX - rect.left) / rect.width) * width, ((clientY - rect.top) / rect.height) * height];
}

/**
 * Draws the points of a stroke from index `from` on (a stroke is drawn in pieces while it grows).
 * `from` 0 draws the whole stroke. Fill strokes are polygons, so they are always drawn whole.
 */
export function drawStroke(ctx: Ctx, stroke: MaskStroke, color: string, from = 0): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke.tool === "fill") {
    if (pts.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  const start = Math.max(0, from - 1);
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], strokeWidth(stroke.size, pts[0][2]) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = Math.max(1, start + 1); i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.lineWidth = strokeWidth(stroke.size, (a[2] + b[2]) / 2);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Clears the context and draws the whole mask in `color` on transparent: painted = opaque. Invert flips that. */
export function paintMask(ctx: Ctx, width: number, height: number, state: Pick<MaskState, "strokes" | "inverted">, color: string): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  for (const s of state.strokes) drawStroke(ctx, s, color);
  if (state.inverted) {
    // xor of an opaque fill with opaque paint is clear, with nothing is opaque: the alpha is flipped.
    ctx.globalCompositeOperation = "xor";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

/** Turns the painted layer (white on transparent, from paintMask) into the opaque black and white mask, softened. */
export function finishMask(target: Ctx, layer: CanvasImageSource, width: number, height: number, softness: number): void {
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalCompositeOperation = "source-over";
  target.fillStyle = "#000";
  target.fillRect(0, 0, width, height);
  if (softness > 0) target.filter = `blur(${softness}px)`;
  target.drawImage(layer, 0, 0);
  target.restore();
}

/** The share (0..1) of pixels whose channel (0 red .. 3 alpha) is above the threshold, from RGBA data. */
export function coverageOf(data: ArrayLike<number>, channel = 0, threshold = 127): number {
  const n = Math.floor(data.length / 4);
  if (n === 0) return 0;
  let on = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + channel] > threshold) on++;
  return on / n;
}

// ---- zoom and pan ----

export type View = { scale: number; tx: number; ty: number };
export type Size = { w: number; h: number };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/** The largest size the picture fits in the stage at, keeping its shape. */
export function fitSize(stage: Size, width: number, height: number): Size {
  if (stage.w <= 0 || stage.h <= 0 || width <= 0 || height <= 0) return { w: 0, h: 0 };
  const k = Math.min(stage.w / width, stage.h / height);
  return { w: width * k, h: height * k };
}

/** Zoom 1x with the picture centred in the stage. */
export function fitView(stage: Size, frame: Size): View {
  return { scale: 1, tx: (stage.w - frame.w) / 2, ty: (stage.h - frame.h) / 2 };
}

/** Keeps the zoom in range, and the picture from being dragged off the stage (it is centred when smaller). */
export function clampView(v: View, stage: Size, frame: Size): View {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale));
  const axis = (t: number, stageLen: number, frameLen: number) => {
    const len = frameLen * scale;
    return len <= stageLen ? (stageLen - len) / 2 : Math.min(0, Math.max(stageLen - len, t));
  };
  return { scale, tx: axis(v.tx, stage.w, frame.w), ty: axis(v.ty, stage.h, frame.h) };
}

/** Changes the zoom by `factor` keeping the stage point (px, py) still. */
export function zoomAt(v: View, factor: number, px: number, py: number, stage: Size, frame: Size): View {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * factor));
  const k = scale / v.scale;
  return clampView({ scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, stage, frame);
}

/** The view for a pinch: the point that was under the first midpoint follows the new midpoint, and the zoom follows the spread. */
export function pinchView(v0: View, mid0: [number, number], d0: number, mid: [number, number], d: number, stage: Size, frame: Size): View {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, d0 > 0 ? v0.scale * (d / d0) : v0.scale));
  const wx = (mid0[0] - v0.tx) / v0.scale;
  const wy = (mid0[1] - v0.ty) / v0.scale;
  return clampView({ scale, tx: mid[0] - wx * scale, ty: mid[1] - wy * scale }, stage, frame);
}

/** Two taps close in time and place. */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, now: { t: number; x: number; y: number }, ms = 320, px = 32): boolean {
  return !!prev && now.t - prev.t <= ms && Math.hypot(now.x - prev.x, now.y - prev.y) <= px;
}

// ---- the finished mask ----

/**
 * A mask kept for a starting picture: what was painted (the PNG is drawn from the strokes when it is needed,
 * so it survives a refresh), the picture's size it fits, and `id`, which changes whenever the mask does.
 */
export type PaintedArea = MaskState & {
  id: string;
  width: number;
  height: number;
  /**
   * The mask's PNG, already drawn. Set only on the server (`fromSpec`), where the strokes are not kept and there is
   * no canvas to draw them on; when it is missing the PNG is drawn from the strokes with `renderMask`.
   */
  render?: () => Promise<Blob>;
};

/** Renders a mask's strokes to the black and white PNG at the picture's size; null when nothing is painted or the browser can't. Browser only. */
export async function renderMask(state: MaskState, width: number, height: number): Promise<MaskResult | null> {
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const lctx = layer.getContext("2d");
  const octx = out.getContext("2d", { willReadFrequently: true });
  if (!lctx || !octx) return null;
  paintMask(lctx, width, height, state, "#fff");
  finishMask(octx, layer, width, height, state.softness);
  const coverage = coverageOf(octx.getImageData(0, 0, width, height).data, 0);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob || coverage === 0) return null;
  return { strokes: state.strokes, softness: state.softness, inverted: state.inverted, blob, coverage };
}

/** A tag for a mask, so a changed one is told apart from the last (it joins the job's "same settings" key). */
export const newMaskId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
