import { clampView, clientToPicture, coverageOf, drawStroke, emptyMask, fitSize, fitView, isDoubleTap, paintMask, pinchView, strokeWidth, withoutLastStroke, zoomAt, type MaskStroke } from "../../src/lib/mask.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

ok(JSON.stringify(emptyMask()) === '{"strokes":[],"softness":0,"inverted":false}', "an empty mask has no strokes, no softness, not inverted");
ok(emptyMask().strokes !== emptyMask().strokes, "each empty mask has its own list");

const s = (n: number): MaskStroke => ({ tool: "brush", size: 10, points: [[n, n, 0]] });
const list = [s(1), s(2), s(3)];
ok(withoutLastStroke(list).length === 2 && list.length === 3, "undo drops the last stroke without changing the list");
ok(withoutLastStroke([]).length === 0, "undo of nothing is nothing");

ok(strokeWidth(20, 0) === 20, "no pressure (mouse, finger) keeps the full size");
ok(near(strokeWidth(20, 1), 20) && near(strokeWidth(20, 0.5), 20 * 0.625), "a pen scales the size by pressure");
ok(strokeWidth(20, 0.01) > 0, "a feather touch still marks");

const rect = { left: 100, top: 50, width: 500, height: 250 };
const [x, y] = clientToPicture(350, 175, rect, 1000, 500);
ok(x === 500 && y === 250, "the middle of the on-screen picture is the middle of the picture");
const [x2, y2] = clientToPicture(100, 50, rect, 1000, 500);
ok(x2 === 0 && y2 === 0, "its corner is the origin");
const zoomed = { left: -400, top: -200, width: 2000, height: 1000 }; // 4x zoom, panned
const [x3, y3] = clientToPicture(600, 300, zoomed, 1000, 500);
ok(x3 === 500 && y3 === 250, "a zoomed, panned rectangle maps the same way");

// coverage
const rgba = (px: number[][]) => Uint8ClampedArray.from(px.flat());
ok(coverageOf(rgba([[255, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255]])) === 0.5, "coverage counts white pixels (red channel)");
ok(coverageOf(rgba([[0, 0, 0, 0], [255, 0, 0, 200]]), 3) === 0.5, "…or opaque ones (alpha channel)");
ok(coverageOf(new Uint8ClampedArray(0)) === 0, "no pixels, no coverage");
ok(coverageOf(rgba([[128, 0, 0, 255], [127, 0, 0, 255]])) === 0.5, "a mid-grey counts from 128 up");

// fit and zoom
const stage = { w: 400, h: 800 };
const frame = fitSize(stage, 1000, 500);
ok(frame.w === 400 && frame.h === 200, "a wide picture fits the width of a portrait stage");
const v0 = fitView(stage, frame);
ok(v0.scale === 1 && v0.tx === 0 && v0.ty === 300, "…and is centred");
const z = zoomAt(v0, 100, 200, 400, stage, frame);
ok(z.scale === 8, "zoom stops at 8x");
ok(zoomAt(v0, 0.1, 200, 400, stage, frame).scale === 1, "…and at 1x");
const z2 = zoomAt(v0, 2, 100, 350, stage, frame);
const pic = (v: typeof z2, px: number, py: number) => [(px - v.tx) / v.scale, (py - v.ty) / v.scale];
ok(near(pic(z2, 100, 350)[0], pic(v0, 100, 350)[0]), "zooming keeps the point under the cursor still (across, where the picture overflows)");
const far = clampView({ scale: 4, tx: 500, ty: 500 }, stage, frame);
ok(far.tx === 0 && far.ty === 300 + 0 || far.ty <= 800, "a zoomed picture can't be dragged away from the stage");
ok(far.tx === 0, "…horizontally");
const far2 = clampView({ scale: 4, tx: -9999, ty: 0 }, stage, frame);
ok(far2.tx === 400 - 1600, "…or off the far side");
const p = pinchView(v0, [200, 400], 100, [200, 400], 300, stage, frame);
ok(p.scale === 3, "spreading two fingers 3x zooms 3x");
const pan = pinchView(z2, [200, 400], 100, [250, 400], 100, stage, frame);
ok(pan.scale === z2.scale && pan.tx >= z2.tx, "moving two fingers together pans");

ok(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 200, x: 10, y: 5 }), "two close taps are a double tap");
ok(!isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 600, x: 0, y: 0 }), "…not when slow");
ok(!isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 200, y: 0 }), "…or far apart");
ok(!isDoubleTap(null, { t: 100, x: 0, y: 0 }), "…or the first");

// drawing, against a recorder
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { calls.push(`${k}(${a.join(",")})`); }),
    set: (t, k: string, v) => { t[k] = v; if (k === "lineWidth") calls.push(`w=${v}`); if (k === "globalCompositeOperation") calls.push(`op=${v}`); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
{
  const { ctx, calls } = recorder();
  drawStroke(ctx, { tool: "brush", size: 10, points: [[0, 0, 0], [5, 5, 0], [9, 9, 0]] }, "#fff");
  ok(calls.filter((c) => c.startsWith("stroke(")).length === 2, "a brush stroke of 3 points is 2 segments");
}
{
  const { ctx, calls } = recorder();
  drawStroke(ctx, { tool: "brush", size: 10, points: [[0, 0, 0], [5, 5, 0], [9, 9, 0]] }, "#fff", 2);
  ok(calls.filter((c) => c.startsWith("stroke(")).length === 1 && calls.includes("moveTo(5,5)"), "drawing from a later point adds only the new segment");
}
{
  const { ctx, calls } = recorder();
  drawStroke(ctx, { tool: "eraser", size: 10, points: [[1, 1, 0], [2, 2, 0]] }, "#fff");
  ok(calls.includes("op=destination-out"), "the eraser removes paint");
}
{
  const { ctx, calls } = recorder();
  drawStroke(ctx, { tool: "fill", size: 10, points: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] }, "#fff");
  ok(calls.includes("closePath()") && calls.includes("fill()"), "a fill stroke is a closed, filled polygon");
}
{
  const { ctx, calls } = recorder();
  drawStroke(ctx, { tool: "fill", size: 10, points: [[0, 0, 0], [10, 0, 0]] }, "#fff");
  ok(!calls.includes("fill()"), "a fill of fewer than 3 points paints nothing");
}
{
  const { ctx, calls } = recorder();
  paintMask(ctx, 100, 100, { strokes: [], inverted: true }, "#fff");
  ok(calls.includes("op=xor") && calls.includes("fillRect(0,0,100,100)"), "inverting flips the whole picture");
}
