// Where to crop when redrawing a painted area: the area's bounding box, and a box around it with some
// context, scaled toward the model's native size. Pure maths on the strokes, no DOM and no network.

import type { MaskState } from "../mask";

export type Box = { x: number; y: number; w: number; h: number };
/** The box to crop, and the size (sw by sh, multiples of 16) it is redrawn at; `scale` is about sw / w. */
export type CropPlan = Box & { sw: number; sh: number; scale: number };

/**
 * The painted pixels' bounding box, from the strokes: null when nothing is painted. An inverted mask is the
 * whole picture. An eraser can only shrink the painted area, so it is ignored: the box is then slightly too
 * big, never too small. The box is grown by twice the softness (the blur's reach), clamped to the picture and
 * rounded outwards to whole pixels.
 */
export function maskBounds(state: MaskState, width: number, height: number): Box | null {
  if (!(width > 0 && height > 0)) return null;
  if (state.inverted) return { x: 0, y: 0, w: width, h: height };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of state.strokes) {
    if (s.tool === "eraser" || s.points.length === 0) continue;
    const r = s.tool === "fill" ? 0 : s.size / 2;
    for (const [px, py] of s.points) {
      x0 = Math.min(x0, px - r);
      y0 = Math.min(y0, py - r);
      x1 = Math.max(x1, px + r);
      y1 = Math.max(y1, py + r);
    }
  }
  if (!Number.isFinite(x0)) return null;
  const soft = 2 * Math.max(0, state.softness);
  x0 = Math.max(0, Math.floor(x0 - soft));
  y0 = Math.max(0, Math.floor(y0 - soft));
  x1 = Math.min(width, Math.ceil(x1 + soft));
  y1 = Math.min(height, Math.ceil(y1 + soft));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The box to redraw around `bounds`: padded for context, at least 60% of the model's native side, inside the
 * picture, and the size it is redrawn at. Null when the box would cover 80% or more of the picture (cropping
 * is then not worth it).
 */
export function contextBox(bounds: Box, picW: number, picH: number, nativeArea: number): CropPlan | null {
  if (!(picW > 0 && picH > 0 && nativeArea > 0)) return null;
  // 1. context
  const pad = Math.max(64, Math.round(0.5 * Math.max(bounds.w, bounds.h)));
  let { x, y, w, h } = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad };
  // 2. not tiny
  const minSide = Math.round(0.6 * Math.sqrt(nativeArea));
  if (w < minSide) {
    x -= Math.floor((minSide - w) / 2);
    w = minSide;
  }
  if (h < minSide) {
    y -= Math.floor((minSide - h) / 2);
    h = minSide;
  }
  // 3. inside the picture: a side longer than the picture is the whole side, otherwise shift the box
  if (w >= picW) {
    x = 0;
    w = picW;
  } else {
    x = Math.min(Math.max(0, x), picW - w);
  }
  if (h >= picH) {
    y = 0;
    h = picH;
  } else {
    y = Math.min(Math.max(0, y), picH - h);
  }
  // 4. not worth it
  if (w * h >= 0.8 * picW * picH) return null;
  // 5. the size it is redrawn at
  const scale = Math.min(2, Math.max(0.5, Math.sqrt(nativeArea / (w * h))));
  const snap = (v: number) => Math.max(16, Math.round((v * scale) / 16) * 16);
  return { x, y, w, h, sw: snap(w), sh: snap(h), scale };
}
