import { addMaskStroke, addPaintStroke, applyResult, canRedo, canUndo, clearPaint, commit, initialRefineState, redo, setMask, startHistory, toggleMaskVisible, togglePaintVisible, undo, visiblePaintForJob } from "../../src/lib/refineHistory.ts";
import type { PaintStroke } from "../../src/lib/paint.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// History
let h = startHistory(1);
ok(h.present === 1 && !canUndo(h) && !canRedo(h), "a new history has nothing to undo or redo");
ok(undo(h) === h && redo(h) === h, "undo and redo with nothing are no change");
h = commit(commit(commit(h, 2), 3), 4);
ok(h.present === 4 && h.past.join() === "1,2,3" && canUndo(h), "commits pile up");
h = undo(undo(h));
ok(h.present === 2 && h.future.join() === "3,4" && canRedo(h), "undo steps back and keeps the redo list");
h = redo(h);
ok(h.present === 3 && h.future.join() === "4", "redo steps forward");
h = commit(h, 9);
ok(h.present === 9 && h.future.length === 0 && !canRedo(h), "a new commit clears redo");
const same = commit(h, h.present);
ok(same === h, "committing the same object is ignored");
let lim = startHistory(0);
for (let i = 1; i <= 10; i++) lim = commit(lim, i, 3);
ok(lim.past.join() === "7,8,9" && lim.present === 10, "the oldest states beyond the limit are dropped");
ok(JSON.stringify(JSON.parse(JSON.stringify(lim))) === JSON.stringify(lim), "a history is plain data");

// RefineState
const stroke = (n: number): PaintStroke => ({ tool: "brush", color: "#ff0000", size: 10, softness: 0, opacity: 1, points: [[n, n, 0, 0]] });
const s0 = initialRefineState("img1");
ok(s0.base === "img1" && s0.paint.length === 0 && s0.mask.strokes.length === 0 && s0.paintVisible && s0.maskVisible, "the editor starts empty and everything visible");
const s1 = addPaintStroke(s0, stroke(1));
const s2 = addMaskStroke(s1, { tool: "brush", size: 5, points: [[1, 1, 0]] });
ok(s0.paint.length === 0 && s1.paint.length === 1 && s2.mask.strokes.length === 1 && s2.paint === s1.paint, "reducers return new states and share what did not change");
ok(setMask(s2, { softness: 4 }).mask.softness === 4 && setMask(s2, { inverted: true }).mask.inverted && setMask(s2, { softness: 0 }) === s2, "setMask changes softness or inverted, and nothing is no change");
ok(togglePaintVisible(s0).paintVisible === false && toggleMaskVisible(s0).maskVisible === false, "visibility toggles");

const applied = applyResult(setMask(s2, { softness: 3 }), "img2");
ok(applied.base === "img2" && applied.paint.length === 0, "applying a result sets the base and clears the paint");
ok(applied.mask.strokes.length === 1 && applied.mask.softness === 3, "…and keeps the mask");
ok(clearPaint(s0) === s0 && clearPaint(s1).paint.length === 0, "clearPaint empties the paint");

ok(visiblePaintForJob(s1).length === 1 && visiblePaintForJob(togglePaintVisible(s1)).length === 0, "hidden paint is not sent");

let eh = startHistory(s0);
eh = commit(eh, s1);
eh = commit(eh, applyResult(s1, "img2"));
ok(eh.present.paint.length === 0 && eh.present.base === "img2", "apply is a commit");
eh = undo(eh);
ok(eh.present.paint.length === 1 && eh.present.base === "img1", "undoing an apply brings back the paint and the old picture");
