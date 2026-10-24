import { airbrushStamps, averageColor, drawPaintStroke, isHexColor, normalizeHex, paintBytesEstimate, readPaintStrokes, renderPaintLayer, stampGradientStops, stampPositions, type PaintStroke } from "../../src/lib/paint.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// spacing
const line = [[0, 0, 0, 0], [50, 0, 0, 10], [50, 30, 0, 20], [120, 30, 0, 30]];
const whole = stampPositions(line, 10, 0.2); // step 2
ok(whole.stamps[0].x === 0 && whole.stamps[0].y === 0, "the first point gets a stamp");
const gaps = whole.stamps.slice(1).map((s, i) => Math.hypot(s.x - whole.stamps[i].x, s.y - whole.stamps[i].y));
ok(gaps.every((g, i) => near(g, 2) || (g < 2 && g > 0 && i >= 0 && whole.stamps[i + 1].i !== whole.stamps[i].i)), "stamps are evenly spaced (corners only shorten the straight-line gap)");
ok(whole.stamps.length === 76, "a 150px line at 2px spacing has 76 stamps");

// continuity across incremental calls, split at any index
let same = true;
for (let k = 0; k <= line.length; k++) {
  const a = stampPositions(line.slice(0, k), 10, 0.2);
  const b = stampPositions(line.slice(k), 10, 0.2, a.carry);
  const all = [...a.stamps, ...b.stamps];
  if (all.length !== whole.stamps.length || all.some((s, i) => !near(s.x, whole.stamps[i].x) || !near(s.y, whole.stamps[i].y) || !near(s.r, whole.stamps[i].r))) same = false;
}
ok(same, "splitting a stroke at any point gives the same stamps as drawing it whole");
const oneByOne = line.reduce((acc, p) => { const r = stampPositions([p], 10, 0.2, acc.carry); return { stamps: [...acc.stamps, ...r.stamps], carry: r.carry }; }, { stamps: [] as typeof whole.stamps, carry: undefined as undefined | typeof whole.carry });
ok(oneByOne.stamps.length === whole.stamps.length, "…even one point at a time");
ok(stampPositions([[5, 5, 0, 0]], 10).stamps.length === 1, "a tap is one stamp");
ok(stampPositions([], 10).stamps.length === 0, "no points, no stamps");

// pressure
const pen = stampPositions([[0, 0, 1, 0], [100, 0, 0.2, 10]], 20).stamps;
ok(near(pen[0].r, 10) && pen[pen.length - 1].r < pen[0].r, "a pen's stamps shrink as the pressure falls");
ok(pen.every((s, i) => i === 0 || s.r <= pen[i - 1].r + 1e-9), "…steadily");
ok(near(stampPositions([[0, 0, 0, 0]], 20).stamps[0].r, 10), "no pressure (not a pen) is full size");
ok(stampPositions([[0, 0, 0.01, 0]], 20).stamps[0].r > 0, "a feather touch still marks");

// airbrush
const still = airbrushStamps([[10, 10, 0, 0], [10, 10, 0, 1000]], 30).stamps;
ok(still.length >= 40 && still.every((s) => s.x === 10 && s.y === 10), "an airbrush held still keeps adding stamps over time");
const part1 = airbrushStamps([[10, 10, 0, 0], [10, 10, 0, 333]], 30);
const part2 = airbrushStamps([[10, 10, 0, 1000]], 30, part1.carry);
ok(part1.stamps.length + part2.stamps.length === still.length, "the airbrush continues across incremental calls");
const moving = airbrushStamps([[0, 0, 0, 0], [100, 0, 0, 100]], 30).stamps;
ok(moving.length === 5 && near(moving[2].x, 50), "a moving airbrush places stamps by time along the path");

// gradient stops
for (const soft of [0, 0.3, 1]) {
  const st = stampGradientStops(soft);
  ok(st.every((s, i) => i === 0 || (s.offset >= st[i - 1].offset && s.alpha <= st[i - 1].alpha + 1e-9)), `gradient stops are monotonic at softness ${soft}`);
  ok(st[0].offset === 0 && st[0].alpha === 1 && st[st.length - 1].offset === 1, `…and cover centre to edge at softness ${soft}`);
}
const hard = stampGradientStops(0);
ok(hard.length === 2 && hard[1].alpha === 1, "softness 0 is a hard edge");
const soft1 = stampGradientStops(1);
ok(soft1[soft1.length - 1].alpha === 0 && soft1[1].alpha < 1, "softness 1 falls off from the centre to nothing at the edge");
const mid = stampGradientStops(0.5);
ok(mid[1].offset === 0.5 && mid[1].alpha === 1 && mid[mid.length - 1].alpha === 0, "the centre half is opaque at softness 0.5");
ok(stampGradientStops(NaN).length === 2 && stampGradientStops(5)[stampGradientStops(5).length - 1].alpha === 0, "bad softness is clamped");

// hex
ok(isHexColor("#abc") && isHexColor("#AABBCC") && !isHexColor("abc") && !isHexColor("#abcd") && !isHexColor("#ggg") && !isHexColor(5), "hex colours are #rgb or #rrggbb");
ok(normalizeHex("#ABC") === "#aabbcc" && normalizeHex("#A1b2C3") === "#a1b2c3" && normalizeHex("red") === null, "hex colours are normalised to #rrggbb lower case");

// averageColor
ok(averageColor([0, 0, 0, 0, 255, 0, 0, 255]) === "#ff0000", "the eyedropper ignores transparent pixels");
ok(averageColor([0, 0, 0, 0]) === null, "…and gives nothing for an all transparent area");
ok(averageColor([255, 0, 0, 255, 0, 0, 255, 255]) === "#800080", "…and averages the rest");

// readPaintStrokes
const good: PaintStroke = { tool: "brush", color: "#ff0000", size: 20, softness: 0.5, opacity: 0.8, points: [[1, 2, 0.5, 0], [3, 4, 0.6, 10]] };
ok(JSON.stringify(readPaintStrokes(JSON.parse(JSON.stringify([good])))) === JSON.stringify([good]), "a stored stroke reads back unchanged");
ok(readPaintStrokes(null).length === 0 && readPaintStrokes("x").length === 0 && readPaintStrokes({}).length === 0, "garbage reads as no strokes");
ok(readPaintStrokes([null, 5, "x", {}, { ...good, tool: "pen" }, { ...good, color: "red" }, { ...good, size: "9" }, { ...good, points: [] }, { ...good, points: [[1, "a"]] }, { ...good, points: [[1, NaN]] }]).length === 0, "bad strokes are dropped");
ok(readPaintStrokes([good, { nope: 1 }, good]).length === 2, "…while good ones around them stay");
const clamped = readPaintStrokes([{ ...good, color: "#F00", size: 99999, softness: 7, opacity: -2, points: [[1, 2]] }])[0];
ok(clamped.color === "#ff0000" && clamped.size === 2000 && clamped.softness === 1 && clamped.opacity === 0, "size, softness, opacity are clamped and the colour normalised");
ok(clamped.points[0].length === 4 && clamped.points[0][2] === 0 && clamped.points[0][3] === 0, "missing pressure and time default to 0");
ok(readPaintStrokes([{ ...good, size: 0 }])[0].size === 1, "size is at least 1");
ok(readPaintStrokes(Array.from({ length: 5200 }, () => good)).length === 5000, "at most 5000 strokes");
ok(readPaintStrokes([{ ...good, points: Array.from({ length: 21000 }, (_, i) => [i, i]) }])[0].points.length === 20000, "at most 20000 points per stroke");
ok(paintBytesEstimate([]) < paintBytesEstimate([good]) && paintBytesEstimate([good]) > JSON.stringify(good).length / 2, "the size estimate grows with the strokes");

// canvas wrappers with a recording fake
type Log = string[];
function fakeCanvas(log: Log, name: string, w = 100, h = 100) {
  const props: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    canvas: { width: w, height: h },
    save: () => log.push(`${name}.save`),
    restore: () => log.push(`${name}.restore`),
    setTransform: () => {},
    clearRect: () => log.push(`${name}.clear`),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => log.push(`${name}.stamp`),
    drawImage: (src: { name?: string }) => log.push(`${name}.draw(${src.name}) op=${props.globalCompositeOperation} alpha=${props.globalAlpha}`),
  };
  return new Proxy(ctx, { set: (t, k, v) => { props[k as string] = v; return true; }, get: (t, k) => (k in t ? t[k as string] : props[k as string]) }) as unknown as CanvasRenderingContext2D;
}
function setup() {
  const log: Log = [];
  const scratch = { name: "scratch", width: 100, height: 100, getContext: () => fakeCanvas(log, "scratch") };
  return { log, scratch, make: () => scratch as never, target: fakeCanvas(log, "target") };
}
const count = (log: Log, re: RegExp) => log.filter((l) => re.test(l)).length;

{
  const { log, make, target } = setup();
  drawPaintStroke(target, { ...good, points: [[10, 10, 0, 0], [40, 10, 0, 5]], opacity: 0.6 }, 0, make);
  ok(count(log, /^scratch\.stamp$/) > 5 && count(log, /^target\.draw/) === 1, "a brush stroke draws many stamps to the scratch but composites onto the layer once");
  ok(log.some((l) => l === "target.draw(scratch) op=source-over alpha=0.6"), "…at the stroke's opacity");
}
{
  const { log, make, target } = setup();
  drawPaintStroke(target, { ...good, tool: "eraser", opacity: 1, points: [[10, 10, 0, 0], [40, 10, 0, 5]] }, 0, make);
  ok(log.some((l) => l === "target.draw(scratch) op=destination-out alpha=1"), "the eraser composites with destination-out");
}
{
  const { log, make, target } = setup();
  renderPaintLayer(target, 100, 100, [good, { ...good, tool: "airbrush" }, { ...good, tool: "eraser" }], make);
  ok(log[0] === "target.save" && log.includes("target.clear"), "replaying the layer starts by clearing it");
  ok(count(log, /^target\.draw/) === 3, "…then composites once per stroke, in order");
  ok(count(log, /^scratch\.clear$/) === 3, "…reusing one scratch, cleared for each stroke");
}
{
  const { log, make, target } = setup();
  renderPaintLayer(target, 100, 100, [], make);
  ok(count(log, /draw/) === 0, "no strokes draws nothing");
}
