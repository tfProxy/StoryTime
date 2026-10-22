"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampView,
  clientToPicture,
  coverageOf,
  drawStroke,
  finishMask,
  fitSize,
  fitView,
  isDoubleTap,
  paintMask,
  pinchView,
  withoutLastStroke,
  zoomAt,
  type MaskResult,
  type MaskState,
  type MaskStroke,
  type MaskTool,
  type Size,
  type View,
} from "@/lib/mask";

export type { MaskResult, MaskState, MaskStroke } from "@/lib/mask";

type Props = {
  /** The picture, as a URL (it may be on another origin: it is only shown, never drawn into a canvas). */
  src: string;
  width: number;
  height: number;
  initial?: MaskState | null;
  onDone: (result: MaskResult) => void;
  onCancel: () => void;
};

const TINT = "rgb(255 40 70)";
const EMPTY_SIZE: Size = { w: 0, h: 0 };

type Pt = { x: number; y: number; type: string };
type Live = { id: number; stroke: MaskStroke; drawn: number; tap: boolean };

/**
 * Paints a mask over a picture, to choose the part to redraw. A modal <dialog>: the picture fitted to the
 * screen with the mask tinted over it, and a tool bar (below on a phone, beside on a wide screen).
 * One finger, a pen or the mouse paints; two fingers pinch and pan; the wheel zooms. Done hands back a
 * black and white PNG of the picture's size: white where to redraw.
 */
export default function MaskEditor({ src, width, height, initial = null, onDone, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [strokes, setStrokes] = useState<MaskStroke[]>(initial?.strokes ?? []);
  const [inverted, setInverted] = useState(initial?.inverted ?? false);
  const [softness, setSoftness] = useState(initial?.softness ?? 0);
  const [tool, setTool] = useState<MaskTool>("brush");
  const [size, setSize] = useState(() => Math.max(4, Math.round(Math.max(width, height) / 20)));
  const [more, setMore] = useState(false);
  const [showMask, setShowMask] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [coverage, setCoverage] = useState(initial && initial.strokes.length > 0 ? 1 : 0);
  const [stage, setStage] = useState<Size>(EMPTY_SIZE);
  const [view, setViewState] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [busy, setBusy] = useState(false);

  // What the pointer handlers read between renders.
  const maskRef = useRef({ strokes, inverted });
  const viewRef = useRef(view);
  const stageRef = useRef(stage);
  const live = useRef<Live | null>(null);
  const raf = useRef(0);
  const pointers = useRef(new Map<number, Pt>());
  const penIds = useRef(new Set<number>());
  const gesture = useRef<{ d0: number; mid0: [number, number]; v0: View } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number; dot: boolean } | null>(null);

  const frame = fitSize(stage, width, height);
  const frameRef = useRef(frame);

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  // The mask on the screen canvas: the committed strokes, and the one being drawn.
  const redraw = (extra?: MaskStroke) => {
    const c = canvas.current;
    const ctx = c?.getContext("2d", { willReadFrequently: true });
    if (!c || !ctx) return;
    const { strokes: list, inverted: inv } = maskRef.current;
    paintMask(ctx, width, height, { strokes: extra ? [...list, extra] : list, inverted: inv }, TINT);
  };

  // Commits a new list of strokes (or an inversion): shows it, and counts how much is painted.
  const apply = (next: { strokes?: MaskStroke[]; inverted?: boolean }) => {
    maskRef.current = { strokes: next.strokes ?? maskRef.current.strokes, inverted: next.inverted ?? maskRef.current.inverted };
    setStrokes(maskRef.current.strokes);
    setInverted(maskRef.current.inverted);
    setDirty(true);
    redraw();
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    setCoverage(ctx ? coverageOf(ctx.getImageData(0, 0, width, height).data, 3) : 0);
  };

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    redraw();
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    if (ctx) setCoverage(coverageOf(ctx.getImageData(0, 0, width, height).data, 3));
    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(previewTimer.current);
    };
    // Only on opening: later changes go through apply().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The stage's size: the picture is refitted (zoom reset) when it changes, as on turning a tablet.
  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = { w: el.clientWidth, h: el.clientHeight };
      stageRef.current = s;
      frameRef.current = fitSize(s, width, height);
      setStage(s);
      setView(fitView(s, frameRef.current));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, setView]);

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

  // ---- the brush circle ----

  const screenDiameter = (s: number) => (s * frameRef.current.w * viewRef.current.scale) / width;

  function placeCursor(sx: number, sy: number, visible: boolean, opacity = 1, diameter = screenDiameter(size)) {
    const c = cursorEl.current;
    if (!c) return;
    c.style.width = c.style.height = `${diameter}px`;
    c.style.transform = `translate(${sx - diameter / 2}px, ${sy - diameter / 2}px)`;
    c.style.opacity = visible ? String(opacity) : "0";
  }

  function previewSize(s: number) {
    placeCursor(stage.w / 2, stage.h / 2, true, 1, screenDiameter(s));
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => placeCursor(0, 0, false), 1000);
  }

  // ---- pointers ----

  function stagePoint(e: { clientX: number; clientY: number }): [number, number] {
    const r = stageEl.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function pictureXY(e: { clientX: number; clientY: number }): [number, number] {
    const c = canvas.current;
    if (!c) return [0, 0];
    return clientToPicture(e.clientX, e.clientY, c.getBoundingClientRect(), width, height);
  }

  function pointFrom(e: { clientX: number; clientY: number; pointerType: string; pressure: number }): [number, number, number] {
    const [x, y] = pictureXY(e);
    return [x, y, e.pointerType === "pen" ? e.pressure : 0];
  }

  function frameDraw() {
    raf.current = 0;
    const l = live.current;
    if (!l) return;
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    if (l.stroke.tool === "fill" || maskRef.current.inverted) {
      redraw(l.stroke);
    } else {
      drawStroke(ctx, l.stroke, TINT, l.drawn);
    }
    l.drawn = l.stroke.points.length;
  }

  function schedule() {
    if (!raf.current) raf.current = requestAnimationFrame(frameDraw);
  }

  function dropStroke() {
    if (!live.current) return;
    live.current = null;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    redraw();
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

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
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
      live.current = { id: e.pointerId, stroke: { tool, size, points: [pointFrom(e)] }, drawn: 0, tap: true };
      if (e.pointerType !== "mouse") placeCursor(...stagePoint(e), true, 0.55);
      schedule();
    } else if (pointers.current.size === 2) {
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
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const pt = pointFrom(ev);
      const last = l.stroke.points[l.stroke.points.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) * (frameRef.current.w / width) * viewRef.current.scale > 1) {
        l.stroke.points.push(pt);
        l.tap = false;
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
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    live.current = null;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (cancelled) {
      redraw();
      return;
    }
    // Two quick taps of a finger reset the zoom, and the dots they just made are taken back.
    if (e.pointerType === "touch" && l.tap) {
      const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      const prev = lastTap.current;
      if (isDoubleTap(prev, now)) {
        lastTap.current = null;
        if (prev?.dot) apply({ strokes: withoutLastStroke(maskRef.current.strokes) });
        else redraw();
        setView(fitView(stageRef.current, frameRef.current));
        return;
      }
      lastTap.current = { ...now, dot: l.stroke.tool !== "fill" };
    } else {
      lastTap.current = null;
    }
    if (l.stroke.tool === "fill" && l.stroke.points.length < 3) {
      redraw();
      return;
    }
    apply({ strokes: [...maskRef.current.strokes, l.stroke] });
  }

  // ---- actions ----

  function undo() {
    if (strokes.length > 0) apply({ strokes: withoutLastStroke(strokes) });
  }

  function clear() {
    if (strokes.length > 0 || inverted) apply({ strokes: [], inverted: false });
  }

  function fit() {
    setView(fitView(stage, frame));
  }

  function requestCancel() {
    if (dirty) setConfirming(true);
    else onCancel();
  }

  async function done() {
    if (busy || coverage === 0) return;
    setBusy(true);
    try {
      const layer = document.createElement("canvas");
      layer.width = width;
      layer.height = height;
      const lctx = layer.getContext("2d");
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const octx = out.getContext("2d", { willReadFrequently: true });
      if (!lctx || !octx) return;
      paintMask(lctx, width, height, { strokes, inverted }, "#fff");
      finishMask(octx, layer, width, height, softness);
      const share = coverageOf(octx.getImageData(0, 0, width, height).data, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob || share === 0) return;
      onDone({ strokes, softness, inverted, blob, coverage: share });
    } finally {
      setBusy(false);
    }
  }

  const clamped = clampView(view, stage, frame);
  const blurPx = frame.w > 0 ? (softness * frame.w) / width : 0;
  const maxSize = Math.max(8, Math.round(Math.max(width, height) / 4));
  const maxSoft = Math.max(4, Math.round(Math.max(width, height) / 20));

  return (
    <dialog
      ref={dialog}
      className="mask-editor"
      aria-label="Paint the area to change"
      onCancel={(e) => {
        e.preventDefault();
        requestCancel();
      }}
    >
      <div
        ref={stageEl}
        className="mask-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onPointerLeave={(e) => {
          if (!pointers.current.has(e.pointerId)) placeCursor(0, 0, false);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {frame.w > 0 && (
          <div
            className="mask-frame"
            style={{ width: frame.w, height: frame.h, transform: `translate(${clamped.tx}px, ${clamped.ty}px) scale(${clamped.scale})` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI, never drawn into a canvas */}
            <img src={src} alt="" draggable={false} />
            <canvas
              ref={canvas}
              width={width}
              height={height}
              aria-hidden="true"
              style={{ opacity: showMask ? 0.5 : 0, filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined }}
            />
          </div>
        )}
        <div ref={cursorEl} className="mask-cursor" aria-hidden="true" />
        {clamped.scale > 1.001 && (
          <button type="button" className="mask-fit" onClick={fit}>
            Fit
          </button>
        )}
        {confirming && (
          <div className="mask-confirm" role="alert">
            <p>Discard this mask?</p>
            <div>
              <button type="button" onClick={() => setConfirming(false)}>
                Keep painting
              </button>
              <button type="button" onClick={onCancel}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="mask-bar">
        <div className="mask-row">
          <button type="button" aria-pressed={tool === "brush"} onClick={() => setTool("brush")}>
            Brush
          </button>
          <button type="button" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>
            Eraser
          </button>
          <button type="button" aria-pressed={tool === "fill"} onClick={() => setTool("fill")} title="Trace an outline: the inside is filled">
            Fill shape
          </button>
        </div>
        <label className="mask-slider">
          <span>Size</span>
          <input
            type="range"
            aria-label="Brush size"
            min={2}
            max={maxSize}
            value={Math.min(size, maxSize)}
            onChange={(e) => {
              const s = Number(e.target.value);
              setSize(s);
              previewSize(s);
            }}
          />
        </label>
        <div className="mask-row">
          <button type="button" onClick={undo} disabled={strokes.length === 0}>
            Undo
          </button>
          <button type="button" onClick={clear} disabled={strokes.length === 0 && !inverted}>
            Clear
          </button>
          <button type="button" aria-pressed={inverted} onClick={() => apply({ inverted: !inverted })} title="Swap the painted and unpainted areas">
            Invert
          </button>
          <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>
            More
          </button>
        </div>
        {more && (
          <div className="mask-more">
            <label className="mask-slider">
              <span>Soft edge</span>
              <input
                type="range"
                aria-label="Soft edge"
                min={0}
                max={maxSoft}
                value={Math.min(softness, maxSoft)}
                onChange={(e) => {
                  setSoftness(Number(e.target.value));
                  setDirty(true);
                }}
              />
            </label>
            <button type="button" aria-pressed={showMask} onClick={() => setShowMask(!showMask)}>
              Show mask
            </button>
          </div>
        )}
        <div className="mask-row mask-actions">
          <button type="button" onClick={requestCancel}>
            Cancel
          </button>
          <button type="button" className="mask-done" onClick={done} disabled={coverage === 0 || busy}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
