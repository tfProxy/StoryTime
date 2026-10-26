"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  clampView,
  clientToPicture,
  drawStroke,
  fitSize,
  fitView,
  isDoubleTap,
  MASK_TINT,
  paintMask,
  pinchView,
  zoomAt,
  type MaskStroke,
  type Size,
  type View,
} from "@/lib/mask";
import { drawPaintStroke, flattenToBlob, MAX_PAINT_POINTS, pickColor, renderPaintLayer, type PaintStroke } from "@/lib/paint";
import type { RefineState } from "@/lib/refineHistory";
import type { StartPicture } from "@/lib/comfy/startPicture";
import { defaultMaskSize, type RefineTool, type ToolSettings } from "@/lib/refine/tools";

/** What the screen can ask of the canvas. */
export type RefineCanvasHandle = {
  /** The working picture with the visible paint on top, as a PNG (hidden paint is left out). */
  getFlattened: () => Promise<Blob>;
  /** The picture's size once loaded. */
  size: () => { w: number; h: number } | null;
  /** Shows the brush ring at `diameter` picture pixels in the middle of the picture for a moment (while a size slider moves). */
  showBrushSize: (diameter: number) => void;
};

type Props = {
  /** The working picture. Give the component a `key` of the picture's key: a different picture is a new canvas. */
  picture: StartPicture | null;
  /**
   * A result being reviewed: it is shown in place of the working picture, the paint and mask layers and the brush are
   * hidden and nothing can be drawn (zoom and pan still work). Give a new object for each picture.
   */
  preview?: StartPicture | null;
  /** Nothing can be drawn (the picture is being saved); zoom and pan still work. */
  frozen?: boolean;
  state: RefineState;
  tool: RefineTool;
  settings: ToolSettings;
  /** The mask's soft edge while a slider is moving, before it is committed. */
  softPreview?: number | null;
  onPaintStroke: (stroke: PaintStroke) => void;
  onMaskStroke: (stroke: MaskStroke) => void;
  onPickColor: (hex: string) => void;
  /** A double tap on a touch screen takes the dot the first tap made back. */
  onUndo: () => void;
  onLoaded?: (size: { w: number; h: number }) => void;
  onError?: (message: string) => void;
  /** Keeps the zoom and pan between canvases (a new working picture is a new canvas, but it opens as the last one was left). */
  viewMemo?: { current: View | null };
  ref?: Ref<RefineCanvasHandle>;
};

const EMPTY_SIZE: Size = { w: 0, h: 0 };
/** Airbrush: how often the clock adds a point while the pointer is still. */
const AIRBRUSH_TICK_MS = 25;

type Pt = { x: number; y: number; type: string };
type Live = {
  id: number;
  tap: boolean;
  drawn: number;
  t0: number;
  /** The last place (picture pixels and pressure) the pointer was. */
  pos: [number, number, number];
  paint?: PaintStroke;
  mask?: MaskStroke;
  pick?: boolean;
  /** Redraw the whole stroke over a copy of the layer each frame (needed below full opacity, where stamps must not pile up). */
  exact: boolean;
  timer?: ReturnType<typeof setInterval>;
};

const isMaskTool = (t: RefineTool) => t === "mask-brush" || t === "mask-eraser" || t === "mask-lasso";

/**
 * The Refine screen's picture: the working picture, the paint layer and the mask tint stacked in one frame
 * that zooms and pans (wheel, pinch, double tap), drawn on with the active tool. One finger, a pen or the mouse
 * draws; two fingers pinch and pan; a pen cancels touch (palm rejection). Strokes are drawn live and then
 * handed to the screen, which keeps them in its undo history; the layers are redrawn from the state.
 */
export default function RefineCanvas({ picture, preview = null, frozen = false, state, tool, settings, softPreview = null, onPaintStroke, onMaskStroke, onPickColor, onUndo, onLoaded, onError, viewMemo, ref }: Props) {
  const stageEl = useRef<HTMLDivElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const paintCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  const snapCanvas = useRef<HTMLCanvasElement | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [loaded, setLoaded] = useState<{ bitmap: ImageBitmap; w: number; h: number } | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState<{ pic: StartPicture; bitmap: ImageBitmap } | null>(null);
  const [stage, setStage] = useState<Size>(EMPTY_SIZE);
  const [view, setViewState] = useState<View>(() => viewMemo?.current ?? { scale: 1, tx: 0, ty: 0 });
  const w = loaded?.w ?? 0;
  const h = loaded?.h ?? 0;

  // What the pointer handlers read between renders.
  const previewing = preview !== null;
  const latest = useRef({ state, tool, settings, w, h, previewing, frozen, onPaintStroke, onMaskStroke, onPickColor, onUndo });
  const viewRef = useRef(view);
  const stageRef = useRef(stage);
  const live = useRef<Live | null>(null);
  const raf = useRef(0);
  const pointers = useRef(new Map<number, Pt>());
  const penIds = useRef(new Set<number>());
  const gesture = useRef<{ d0: number; mid0: [number, number]; v0: View } | null>(null);
  /** A one-pointer drag that moves the picture (the pan tool, or the middle mouse button). */
  const panning = useRef<{ id: number; x: number; y: number; v0: View } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number; dot: boolean } | null>(null);

  const frame = fitSize(stage, w, h);
  const frameRef = useRef(frame);

  useEffect(() => {
    latest.current = { state, tool, settings, w, h, previewing, frozen, onPaintStroke, onMaskStroke, onPickColor, onUndo };
  });

  // A result being reviewed is loaded here (the working picture stays loaded under it).
  useEffect(() => {
    if (!preview) return;
    let alive = true;
    // The bitmap is not closed: the previous result stays on show until the next one has loaded.
    preview
      .blob()
      .then((blob) => createImageBitmap(blob))
      .then((bm) => {
        if (alive) setPreviewLoaded({ pic: preview, bitmap: bm });
        else bm.close();
      })
      .catch((e) => {
        if (alive) onError?.(e instanceof Error ? e.message : "Couldn't load the picture.");
      });
    return () => {
      alive = false;
    };
    // onError is only called, never depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  // Leaving review forgets the picture, so the next review never starts by showing the last one.
  if (!preview && previewLoaded) setPreviewLoaded(null);
  const shownPreview = preview ? (previewLoaded?.bitmap ?? null) : null;
  const previewReady = !!preview && previewLoaded?.pic === preview;
  useEffect(() => {
    const ctx = previewCanvas.current?.getContext("2d");
    if (ctx && shownPreview) ctx.drawImage(shownPreview, 0, 0);
  }, [shownPreview]);
  // Reviewing starts: a stroke in progress is dropped and the brush ring goes.
  useEffect(() => {
    if (!previewing) return;
    dropStroke();
    placeCursor(0, 0, false);
    // dropStroke and placeCursor only use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing]);

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    if (viewMemo) viewMemo.current = v;
    setViewState(v);
    // viewMemo is a ref object that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- loading the picture ----

  useEffect(() => {
    if (!picture) return;
    let alive = true;
    let bitmap: ImageBitmap | null = null;
    picture
      .blob()
      .then((blob) => createImageBitmap(blob))
      .then((bm) => {
        if (!alive) {
          bm.close();
          return;
        }
        bitmap = bm;
        setLoaded({ bitmap: bm, w: bm.width, h: bm.height });
        onLoaded?.({ w: bm.width, h: bm.height });
      })
      .catch((e) => {
        if (alive) onError?.(e instanceof Error ? e.message : "Couldn't load the picture.");
      });
    return () => {
      alive = false;
      bitmap?.close();
    };
    // A picture is loaded once per canvas (the screen keys the canvas by the picture).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture]);

  // The base layer.
  useEffect(() => {
    const ctx = baseCanvas.current?.getContext("2d");
    if (ctx && loaded) ctx.drawImage(loaded.bitmap, 0, 0);
  }, [loaded]);

  // The paint layer, redrawn from the state whenever the strokes change (a stroke that just ended is drawn whole, exactly).
  useEffect(() => {
    const ctx = paintCanvas.current?.getContext("2d");
    if (!ctx || !loaded) return;
    if (live.current) stopLive();
    renderPaintLayer(ctx, loaded.w, loaded.h, state.paint);
  }, [loaded, state.paint]);

  // The mask tint.
  useEffect(() => {
    const ctx = maskCanvas.current?.getContext("2d");
    if (!ctx || !loaded) return;
    if (live.current?.mask) stopLive();
    paintMask(ctx, loaded.w, loaded.h, state.mask, MASK_TINT);
  }, [loaded, state.mask]);

  // The stage's size changes (turning a tablet, the review bar coming and going): a picture that is fitted is
  // refitted, and a zoomed one keeps the same part of the picture in the middle.
  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const prevStage = stageRef.current;
      const prevFrame = frameRef.current;
      const v = viewRef.current;
      const s = { w: el.clientWidth, h: el.clientHeight };
      const f = fitSize(s, latest.current.w, latest.current.h);
      stageRef.current = s;
      frameRef.current = f;
      setStage(s);
      if (f.w === 0 || f.h === 0) return; // no picture yet: the view (maybe one kept from the last canvas) waits for it
      if (prevStage.w === 0 || prevFrame.w === 0) {
        setView(clampView(v, s, f));
      } else if (v.scale <= 1.001) {
        setView(fitView(s, f));
      } else {
        const cx = (prevStage.w / 2 - v.tx) / v.scale / prevFrame.w;
        const cy = (prevStage.h / 2 - v.ty) / v.scale / prevFrame.h;
        setView(clampView({ scale: v.scale, tx: s.w / 2 - cx * f.w * v.scale, ty: s.h / 2 - cy * f.h * v.scale }, s, f));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, setView]);

  // The wheel zooms around the cursor. Not a React handler: it must be able to stop the page scrolling.
  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015) * (e.deltaMode === 1 ? 16 : 1));
      setView(zoomAt(viewRef.current, k, e.clientX - r.left, e.clientY - r.top, stageRef.current, frameRef.current));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(previewTimer.current);
      if (live.current?.timer) clearInterval(live.current.timer);
    },
    [],
  );

  // ---- the handle ----

  useImperativeHandle(
    ref,
    () => ({
      getFlattened: async () => {
        const l = loaded;
        if (!l) throw new Error("The picture is not loaded yet.");
        const s = latest.current.state;
        return flattenToBlob(l.bitmap, l.w, l.h, s.paint, s.paintVisible);
      },
      size: () => (loaded ? { w: loaded.w, h: loaded.h } : null),
      showBrushSize: (d) => previewDiameter(d),
    }),
    // previewDiameter only uses refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded],
  );

  // ---- the brush circle ----

  const screenDiameter = (pictureDiameter: number) => (pictureDiameter * frameRef.current.w * viewRef.current.scale) / Math.max(1, latest.current.w);

  function toolSize(): number {
    const { tool: t, settings: s, w: pw, h: ph } = latest.current;
    return isMaskTool(t) ? (s.maskSize ?? defaultMaskSize(pw, ph)) : s.size;
  }

  function ringDiameter(): number {
    const t = latest.current.tool;
    if (t === "eyedropper") return 14;
    if (t === "mask-lasso") return 10;
    return Math.max(6, screenDiameter(toolSize()));
  }

  function placeCursor(sx: number, sy: number, visible: boolean, opacity = 1, diameter = ringDiameter()) {
    const c = cursorEl.current;
    if (!c) return;
    c.style.width = c.style.height = `${diameter}px`;
    c.style.transform = `translate(${sx - diameter / 2}px, ${sy - diameter / 2}px)`;
    c.style.opacity = visible && !latest.current.previewing && latest.current.tool !== "pan" ? String(opacity) : "0";
  }

  function previewDiameter(pictureDiameter: number) {
    placeCursor(stageRef.current.w / 2, stageRef.current.h / 2, true, 1, Math.max(6, screenDiameter(pictureDiameter)));
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => placeCursor(0, 0, false), 1000);
  }

  // ---- drawing ----

  function stagePoint(e: { clientX: number; clientY: number }): [number, number] {
    const r = stageEl.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function pictureXY(e: { clientX: number; clientY: number }): [number, number] {
    const c = paintCanvas.current;
    if (!c) return [0, 0];
    return clientToPicture(e.clientX, e.clientY, c.getBoundingClientRect(), latest.current.w, latest.current.h);
  }

  /** A pen reports its pressure; a mouse or finger is 0 ("not a pen": full size). */
  function pointFrom(e: { clientX: number; clientY: number; pointerType: string; pressure: number }): [number, number, number] {
    const [x, y] = pictureXY(e);
    return [x, y, e.pointerType === "pen" ? e.pressure : 0];
  }

  /** The colour of the picture with the visible paint on it around a point, for the eyedropper. */
  function sampleColor(x: number, y: number): string | null {
    const { w: pw, h: ph, state: s } = latest.current;
    const base = baseCanvas.current;
    if (!base || pw < 3 || ph < 3) return null;
    const sx = Math.min(pw - 3, Math.max(0, Math.floor(x) - 1));
    const sy = Math.min(ph - 3, Math.max(0, Math.floor(y) - 1));
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = 3;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(base, sx, sy, 3, 3, 0, 0, 3, 3);
    if (s.paintVisible && paintCanvas.current) ctx.drawImage(paintCanvas.current, sx, sy, 3, 3, 0, 0, 3, 3);
    return pickColor(ctx, Math.floor(x) - sx, Math.floor(y) - sy, 1);
  }

  function pick(e: { clientX: number; clientY: number }) {
    const [x, y] = pictureXY(e);
    if (x < 0 || y < 0 || x >= latest.current.w || y >= latest.current.h) return;
    const c = sampleColor(x, y);
    if (c) latest.current.onPickColor(c);
  }

  function renderPaintNow() {
    const ctx = paintCanvas.current?.getContext("2d");
    if (!ctx) return;
    renderPaintLayer(ctx, latest.current.w, latest.current.h, latest.current.state.paint);
    paintCanvas.current!.style.visibility = latest.current.state.paintVisible ? "visible" : "hidden";
  }

  function renderMaskNow(extra?: MaskStroke) {
    const ctx = maskCanvas.current?.getContext("2d");
    if (!ctx) return;
    const { state: s, w: pw, h: ph } = latest.current;
    if (!extra) maskCanvas.current!.style.opacity = s.maskVisible ? "0.5" : "0";
    paintMask(ctx, pw, ph, { strokes: extra ? [...s.mask.strokes, extra] : s.mask.strokes, inverted: s.mask.inverted }, MASK_TINT);
  }

  function frameDraw() {
    raf.current = 0;
    const l = live.current;
    if (!l) return;
    const { w: pw, h: ph, state: s } = latest.current;
    if (l.paint) {
      const ctx = paintCanvas.current?.getContext("2d");
      if (!ctx) return;
      if (l.exact && snapCanvas.current) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, pw, ph);
        ctx.drawImage(snapCanvas.current, 0, 0);
        ctx.restore();
        drawPaintStroke(ctx, l.paint, 0);
      } else {
        drawPaintStroke(ctx, l.paint, l.drawn);
      }
      l.drawn = l.paint.points.length;
    } else if (l.mask) {
      const ctx = maskCanvas.current?.getContext("2d");
      if (!ctx) return;
      if (l.mask.tool === "fill" || s.mask.inverted) renderMaskNow(l.mask);
      else drawStroke(ctx, l.mask, MASK_TINT, l.drawn);
      l.drawn = l.mask.points.length;
    }
  }

  function schedule() {
    if (!raf.current) raf.current = requestAnimationFrame(frameDraw);
  }

  /** Forgets the stroke being drawn without keeping it (the layers are not touched). */
  function stopLive() {
    const l = live.current;
    if (!l) return;
    if (l.timer) clearInterval(l.timer);
    live.current = null;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }

  /** Drops the stroke being drawn and puts the layers back as the state has them. */
  function dropStroke() {
    if (!live.current) return;
    stopLive();
    renderPaintNow();
    renderMaskNow();
  }

  function startGesture() {
    const [a, b] = [...pointers.current.values()];
    const r = stageEl.current!.getBoundingClientRect();
    gesture.current = {
      d0: Math.hypot(a.x - b.x, a.y - b.y),
      mid0: [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top],
      v0: viewRef.current,
    };
  }

  function beginStroke(e: React.PointerEvent) {
    // Reviewing a result: nothing is drawn (two fingers still pinch and pan).
    if (latest.current.previewing || latest.current.frozen) return;
    const { tool: t, settings: s, w: pw, h: ph } = latest.current;
    const pt = pointFrom(e);
    const base: Live = { id: e.pointerId, tap: true, drawn: 0, t0: performance.now(), pos: pt, exact: false };
    if (t === "eyedropper") {
      live.current = { ...base, pick: true };
      pick(e);
    } else if (isMaskTool(t)) {
      // Drawing with a layer hidden shows it (the screen turns it on when the stroke is kept).
      if (maskCanvas.current) maskCanvas.current.style.opacity = "0.5";
      live.current = { ...base, mask: { tool: t === "mask-brush" ? "brush" : t === "mask-eraser" ? "eraser" : "fill", size: s.maskSize ?? defaultMaskSize(pw, ph), points: [pt] } };
      schedule();
    } else {
      const stroke: PaintStroke = {
        tool: t === "airbrush" ? "airbrush" : t === "paint-eraser" ? "eraser" : "brush",
        color: s.color,
        size: s.size,
        softness: s.softness,
        opacity: s.opacity,
        points: [[pt[0], pt[1], pt[2], 0]],
      };
      if (paintCanvas.current) paintCanvas.current.style.visibility = "visible";
      const exact = s.opacity < 0.99;
      live.current = { ...base, paint: stroke, exact };
      if (exact && paintCanvas.current) {
        // A copy of the layer as it is, to draw the growing stroke over exactly (the preview then matches the finished stroke).
        const snap = (snapCanvas.current ??= document.createElement("canvas"));
        snap.width = pw;
        snap.height = ph;
        snap.getContext("2d")?.drawImage(paintCanvas.current, 0, 0);
      }
      if (stroke.tool === "airbrush") {
        const l = live.current;
        // Paint keeps building while the pointer is held still.
        l.timer = setInterval(() => {
          if (live.current !== l || !l.paint || l.paint.points.length >= MAX_PAINT_POINTS) return;
          l.paint.points.push([l.pos[0], l.pos[1], l.pos[2], performance.now() - l.t0]);
          schedule();
        }, AIRBRUSH_TICK_MS);
      }
      schedule();
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!loaded) return;
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    // Palm rejection: a hand resting on the screen while the pen is down is not a finger.
    if (e.pointerType === "touch" && penIds.current.size > 0) return;
    if (e.pointerType === "pen") {
      penIds.current.add(e.pointerId);
      for (const [id, p] of pointers.current) if (p.type === "touch") pointers.current.delete(id);
      gesture.current = null;
      dropStroke();
    }
    e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointers.current.size === 1) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture is only a convenience.
      }
      if (e.button === 1 || latest.current.tool === "pan") {
        panning.current = { id: e.pointerId, x: e.clientX, y: e.clientY, v0: viewRef.current };
        stageEl.current!.dataset.panning = "true";
        placeCursor(0, 0, false);
        return;
      }
      beginStroke(e);
      if (e.pointerType !== "mouse") placeCursor(...stagePoint(e), true, 0.55);
    } else if (pointers.current.size === 2) {
      panning.current = null;
      if (stageEl.current) delete stageEl.current.dataset.panning;
      dropStroke();
      placeCursor(0, 0, false);
      startGesture();
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = pointers.current.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== "touch") placeCursor(...stagePoint(e), true, 0.8);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    e.preventDefault();
    if (pointers.current.size >= 2) {
      const g = gesture.current;
      if (!g) return;
      const [a, b] = [...pointers.current.values()];
      const r = stageEl.current!.getBoundingClientRect();
      const mid: [number, number] = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
      setView(pinchView(g.v0, g.mid0, g.d0, mid, Math.hypot(a.x - b.x, a.y - b.y), stageRef.current, frameRef.current));
      return;
    }
    const pan = panning.current;
    if (pan && pan.id === e.pointerId) {
      const { v0 } = pan;
      setView(clampView({ scale: v0.scale, tx: v0.tx + e.clientX - pan.x, ty: v0.ty + e.clientY - pan.y }, stageRef.current, frameRef.current));
      return;
    }
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      if (l.pick) {
        pick(ev);
        l.tap = false;
        continue;
      }
      const pt = pointFrom(ev);
      l.pos = pt;
      const points = (l.paint ?? l.mask)!.points;
      const last = points[points.length - 1];
      const screenStep = Math.hypot(pt[0] - last[0], pt[1] - last[1]) * (frameRef.current.w / Math.max(1, latest.current.w)) * viewRef.current.scale;
      // The airbrush wants every move (the clock matters); the others skip moves under a pixel on the screen.
      if (l.paint?.tool === "airbrush" ? l.paint.points.length < MAX_PAINT_POINTS : screenStep > 1) {
        if (l.paint) l.paint.points.push([pt[0], pt[1], pt[2], performance.now() - l.t0]);
        else l.mask!.points.push(pt);
        if (screenStep > 1) l.tap = false;
      }
    }
    placeCursor(...stagePoint(e), true, e.pointerType === "mouse" ? 0.8 : 0.55);
    schedule();
  }

  function endPointer(e: React.PointerEvent, cancelled: boolean) {
    const p = pointers.current.get(e.pointerId);
    penIds.current.delete(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (e.pointerType !== "mouse") placeCursor(0, 0, false);
    if (panning.current?.id === e.pointerId) {
      panning.current = null;
      if (stageEl.current) delete stageEl.current.dataset.panning;
      return;
    }
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    stopLive();
    if (l.pick) return;
    if (cancelled) {
      renderPaintNow();
      renderMaskNow();
      return;
    }
    // Two quick taps of a finger reset the zoom, and the dot they just made is taken back.
    if (e.pointerType === "touch" && l.tap) {
      const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      const prev = lastTap.current;
      if (isDoubleTap(prev, now)) {
        lastTap.current = null;
        if (prev?.dot) latest.current.onUndo();
        renderPaintNow();
        renderMaskNow();
        setView(fitView(stageRef.current, frameRef.current));
        return;
      }
      lastTap.current = { ...now, dot: l.mask?.tool !== "fill" };
    } else {
      lastTap.current = null;
    }
    if (l.mask) {
      if (l.mask.tool === "fill" && l.mask.points.length < 3) {
        renderMaskNow();
        return;
      }
      latest.current.onMaskStroke(l.mask);
    } else if (l.paint) {
      latest.current.onPaintStroke(l.paint);
    }
  }

  const clamped = clampView(view, stage, frame);
  const soft = softPreview ?? state.mask.softness;
  const blurPx = frame.w > 0 && w > 0 ? (soft * frame.w) / w : 0;

  return (
    <div
      ref={stageEl}
      className="refine-stage"
      data-ready={loaded ? "1" : "0"}
      data-previewing={previewing ? "true" : "false"}
      data-preview-key={preview?.key ?? ""}
      data-preview-ready={previewReady ? "1" : "0"}
      data-picture-key={picture?.key ?? ""}
      data-tool={tool}
      data-strokes={state.paint.length}
      data-mask-strokes={state.mask.strokes.length}
      onPointerDown={onPointerDown}
      onMouseDown={(e) => {
        // The middle button pans; stop the browser's autoscroll circle.
        if (e.button === 1) e.preventDefault();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
      onPointerLeave={(e) => {
        if (!pointers.current.has(e.pointerId)) placeCursor(0, 0, false);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {loaded && (
        <div className="refine-frame" style={{ width: frame.w, height: frame.h, transform: `translate(${clamped.tx}px, ${clamped.ty}px) scale(${clamped.scale})` }}>
          <canvas ref={baseCanvas} data-layer="base" width={loaded.w} height={loaded.h} aria-hidden="true" />
          <canvas ref={paintCanvas} data-layer="paint" width={loaded.w} height={loaded.h} aria-hidden="true" style={{ visibility: state.paintVisible ? "visible" : "hidden" }} />
          <canvas
            ref={maskCanvas}
            data-layer="mask"
            width={loaded.w}
            height={loaded.h}
            aria-hidden="true"
            style={{ opacity: state.maskVisible ? 0.5 : 0, filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined }}
          />
          {shownPreview && <canvas ref={previewCanvas} data-layer="preview" width={shownPreview.width} height={shownPreview.height} aria-hidden="true" />}
        </div>
      )}
      <div ref={cursorEl} className="refine-cursor" aria-hidden="true" />
      {clamped.scale > 1.001 && (
        <button type="button" className="refine-fit" onClick={() => setView(fitView(stage, frame))}>
          Fit
        </button>
      )}
    </div>
  );
}
