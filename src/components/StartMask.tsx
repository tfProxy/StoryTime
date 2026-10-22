"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import MaskEditor from "./MaskEditor";
import { coverageOf, MASK_TINT as TINT, newMaskId, paintMask, type MaskResult, type PaintedArea } from "@/lib/mask";


/** The widest the small preview of a painted area is drawn: enough for a thumbnail, cheap to make. */
const PREVIEW_PX = 320;

/** A painted area as a tinted picture of the starting picture's shape (a data URL, to lay over its thumbnail), and the share of it painted (0..1). */
export function useMaskPreview(area: PaintedArea | null): { url: string | null; coverage: number } {
  return useMemo(() => {
    if (!area) return { url: null, coverage: 0 };
    const k = Math.min(1, PREVIEW_PX / Math.max(area.width, area.height));
    const w = Math.max(1, Math.round(area.width * k));
    const h = Math.max(1, Math.round(area.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { url: null, coverage: 1 };
    // paintMask draws in picture pixels, so scale the strokes down to the preview.
    const small = {
      inverted: area.inverted,
      strokes: area.strokes.map((s) => ({ ...s, size: s.size * k, points: s.points.map(([x, y, p]) => [x * k, y * k, p] as [number, number, number]) })),
    };
    paintMask(ctx, w, h, small, TINT);
    return { url: canvas.toDataURL("image/png"), coverage: coverageOf(ctx.getImageData(0, 0, w, h).data, 3) };
  }, [area]);
}

/**
 * Opens the mask editor over a starting picture. The picture's real size is read first (the mask is made at
 * that size); a mask painted before brings its own. `onFail` is told when the picture can't be loaded.
 */
export function MaskPainter({
  src,
  initial,
  onDone,
  onCancel,
  onFail,
}: {
  src: string;
  initial: PaintedArea | null;
  onDone: (area: PaintedArea) => void;
  onCancel: () => void;
  onFail: () => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(initial && { width: initial.width, height: initial.height });
  // Always the latest onFail, without making the effect start over when the parent draws again.
  const failed = useEffectEvent(onFail);
  useEffect(() => {
    if (size) return;
    const image = new Image();
    image.onload = () => (image.naturalWidth > 0 ? setSize({ width: image.naturalWidth, height: image.naturalHeight }) : failed());
    image.onerror = () => failed();
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [size, src]);
  if (!size) return null;
  const done = (r: MaskResult) => onDone({ strokes: r.strokes, softness: r.softness, inverted: r.inverted, id: newMaskId(), ...size });
  return <MaskEditor src={src} width={size.width} height={size.height} initial={initial} onDone={done} onCancel={onCancel} />;
}
