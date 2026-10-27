// Where to crop for a painted redraw: the mask's bounding box and the context box around it.
import { contextBox, maskBounds, type Box, type CropPlan } from "../../src/lib/comfy/inpaintRegion.ts";
import type { MaskState, MaskStroke } from "../../src/lib/mask.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const state = (strokes: MaskStroke[], o: Partial<MaskState> = {}): MaskState => ({ strokes, softness: 0, inverted: false, ...o });
const brush = (size: number, ...pts: [number, number][]): MaskStroke => ({ tool: "brush", size, points: pts.map(([x, y]) => [x, y, 0]) });
const eraser = (size: number, ...pts: [number, number][]): MaskStroke => ({ tool: "eraser", size, points: pts.map(([x, y]) => [x, y, 0]) });
const fill = (...pts: [number, number][]): MaskStroke => ({ tool: "fill", size: 20, points: pts.map(([x, y]) => [x, y, 0]) });

// ---- maskBounds ----
ok(maskBounds(state([]), 800, 600) === null, "bounds: no strokes, no box");
ok(maskBounds(state([eraser(30, [100, 100])]), 800, 600) === null, "bounds: an eraser alone paints nothing");
ok(same(maskBounds(state([brush(40, [100, 100])]), 800, 600), { x: 80, y: 80, w: 40, h: 40 }), "bounds: one brush dot is a square of the brush size");
ok(same(maskBounds(state([brush(10, [100, 100], [200, 150])]), 800, 600), { x: 95, y: 95, w: 110, h: 60 }), "bounds: a brush line is its points grown by half the brush size");
ok(same(maskBounds(state([fill([100, 100], [300, 120], [200, 400])]), 800, 600), { x: 100, y: 100, w: 200, h: 300 }), "bounds: a fill is the box of its points (the brush size is not added)");
ok(same(maskBounds(state([brush(10, [100, 100]), fill([300, 300], [400, 300], [400, 350])]), 800, 600), { x: 95, y: 95, w: 305, h: 255 }), "bounds: strokes are joined");
ok(same(maskBounds(state([brush(40, [100, 100]), eraser(200, [100, 100])]), 800, 600), { x: 80, y: 80, w: 40, h: 40 }), "bounds: an eraser is ignored (the box can be too big, never too small)");
ok(same(maskBounds(state([brush(40, [100, 100])], { softness: 5 }), 800, 600), { x: 70, y: 70, w: 60, h: 60 }), "bounds: grown by twice the softness");
ok(same(maskBounds(state([brush(40, [5, 590])]), 800, 600), { x: 0, y: 570, w: 25, h: 30 }), "bounds: clamped to the picture");
ok(same(maskBounds(state([brush(5, [10.2, 10.2])]), 800, 600), { x: 7, y: 7, w: 6, h: 6 }), "bounds: rounded outwards to whole pixels");
ok(same(maskBounds(state([], { inverted: true }), 800, 600), { x: 0, y: 0, w: 800, h: 600 }), "bounds: an inverted mask is the whole picture");
ok(maskBounds(state([brush(10, [-50, -50])]), 800, 600) === null, "bounds: a stroke wholly outside the picture is nothing");
ok(maskBounds(state([brush(10, [5, 5])]), 0, 0) === null, "bounds: a picture with no size has none");

// ---- contextBox ----
const NATIVE = 1024 * 1024;
const inside = (c: CropPlan, w: number, h: number) => c.x >= 0 && c.y >= 0 && c.x + c.w <= w && c.y + c.h <= h && c.w > 0 && c.h > 0;
const sixteen = (c: CropPlan) => c.sw % 16 === 0 && c.sh % 16 === 0 && c.sw >= 16 && c.sh >= 16;

const bigW = 3000, bigH = 2000;
const hand: Box = { x: 1400, y: 900, w: 200, h: 240 };
const c1 = contextBox(hand, bigW, bigH, NATIVE)!;
ok(c1 !== null && inside(c1, bigW, bigH) && sixteen(c1), "context: a small mask in a big picture crops, inside the picture, sizes multiples of 16");
// pad = max(64, 120) = 120 -> 440 x 480, min side 0.6 * 1024 = 614 -> 614 x 614
ok(c1.w === 614 && c1.h === 614, "context: padded by half the longer side, then at least 60% of the native side");
ok(c1.x <= hand.x && c1.y <= hand.y && c1.x + c1.w >= hand.x + hand.w && c1.y + c1.h >= hand.y + hand.h, "context: the crop holds the whole painted box");
ok(c1.scale > 1 && c1.scale <= 2 && c1.sw === Math.round((c1.w * c1.scale) / 16) * 16, "context: a small crop is scaled up toward the native size");

const tiny = contextBox({ x: 500, y: 500, w: 10, h: 10 }, bigW, bigH, NATIVE)!;
ok(tiny.w === 614 && tiny.h === 614 && tiny.x === 500 + 5 - 307 && sixteen(tiny), "context: a tiny mask still gets 64 pixels of padding and the minimum side, centred on it");

const cornerBox: Box = { x: 0, y: 0, w: 120, h: 120 };
const corner = contextBox(cornerBox, bigW, bigH, NATIVE)!;
ok(corner.x === 0 && corner.y === 0 && corner.w === 614 && corner.h === 614, "context: a mask in the corner shifts the box in without shrinking it");
const far = contextBox({ x: bigW - 100, y: bigH - 100, w: 100, h: 100 }, bigW, bigH, NATIVE)!;
ok(far.x + far.w === bigW && far.y + far.h === bigH && far.w === 614 && far.h === 614, "context: …at the far corner too");

const tall = contextBox({ x: 1400, y: 200, w: 40, h: 1500 }, bigW, bigH, NATIVE)!;
ok(tall !== null && inside(tall, bigW, bigH) && sixteen(tall) && tall.h > tall.w && tall.y >= 0 && tall.y + tall.h <= bigH, "context: a thin tall mask gets a tall crop inside the picture");
const wide = contextBox({ x: 200, y: 1000, w: 1500, h: 40 }, bigW, bigH, NATIVE)!;
ok(wide !== null && inside(wide, bigW, bigH) && sixteen(wide) && wide.w > wide.h, "context: a thin wide mask gets a wide crop inside the picture");

ok(contextBox({ x: 100, y: 100, w: 2700, h: 1800 }, bigW, bigH, NATIVE) === null, "context: a mask covering most of the picture is not cropped");
ok(contextBox({ x: 0, y: 0, w: 1344, h: 768 }, 1344, 768, NATIVE) === null, "context: a full-picture mask is not cropped");
ok(contextBox({ x: 250, y: 250, w: 200, h: 200 }, 700, 600, NATIVE) === null, "context: a small mask in a small picture is not cropped when the minimum box covers most of it");
// 1344 x 768, mask 100 x 100: the 614 x 614 box is 377k pixels of the picture's 1032k, so it crops
const small = contextBox({ x: 600, y: 300, w: 100, h: 100 }, 1344, 768, NATIVE)!;
ok(small !== null && small.w === 614 && small.h === 614 && inside(small, 1344, 768), "context: 1344 x 768 with a hand-sized mask crops to the minimum box");
ok(small.sw === 1024 && small.sh === 1024 && small.scale > 1.6 && small.scale < 1.7, "context: …and is redrawn at about the native size (1024 x 1024 here)");

const bigCrop = contextBox({ x: 100, y: 100, w: 3000, h: 3000 }, 8000, 8000, NATIVE)!;
ok(bigCrop !== null && bigCrop.scale === 0.5 && sixteen(bigCrop), "context: a huge crop is scaled down, but never below one half");
const tinyPic = contextBox({ x: 10, y: 10, w: 20, h: 20 }, 400, 400, 4096 * 4096);
ok(tinyPic === null || (tinyPic.scale <= 2 && sixteen(tinyPic)), "context: the scale never exceeds 2");
ok(contextBox({ x: 0, y: 0, w: 10, h: 10 }, 0, 0, NATIVE) === null, "context: a picture with no size has no crop");
