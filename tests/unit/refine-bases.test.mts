// Refine: the working pictures a session can reach (bases), the tray's order and Discard, and the helpers Apply uses.
import { sizeDiffers, uploadedImage } from "../../src/lib/refine/apply.ts";
import { addResults, appliedSource, baseOf, discardResult, neighbour, newSession, ORIGINAL_BASE, readSession, resultBaseId, resultKey, saveSession, loadSession, trayOrder, type RefineResult } from "../../src/lib/refine/session.ts";
import { applyResult, commit, undo, redo, addPaintStroke, setMask } from "../../src/lib/refineHistory.ts";
import type { PaintStroke } from "../../src/lib/paint.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const target = { kind: "chapter", storyId: "s1", chapterId: "c1" } as const;
const original = { kind: "comfy", image: { filename: "a.png", subfolder: "StoryTime/s1", type: "output" } } as const;
const img = (n: number) => ({ filename: `r${n}.png`, subfolder: "", type: "output" });
const res = (n: number): RefineResult => ({ image: img(n), prompt: `prompt ${n}`, negative: `neg ${n}`, seed: n, madeFrom: ORIGINAL_BASE, at: n });
const stroke: PaintStroke = { tool: "brush", color: "#ff0000", size: 10, softness: 0.2, opacity: 1, points: [[1, 1, 0.5, 0]] };

// a new session holds the original as a base
const s = newSession({ target, original, prompt: "a cat", negative: "blurry", now: 1 });
ok(JSON.stringify(Object.keys(s.bases)) === JSON.stringify([ORIGINAL_BASE]) && s.bases[ORIGINAL_BASE].original === original && s.bases[ORIGINAL_BASE].prompt === "a cat", "a new session has the original as its one base, with its prompt");
const noPrompt = newSession({ target, original, now: 1 });
ok(noPrompt.bases[ORIGINAL_BASE].prompt === undefined, "…and no prompt when the picture has none");

// base ids and lookups
ok(resultBaseId(img(1)) === resultBaseId({ ...img(1) }) && resultBaseId(img(1)) !== resultBaseId(img(2)) && resultBaseId(img(1)) !== resultBaseId({ ...img(1), type: "input" }), "a result's base id names its picture (type, folder and file)");
ok(baseOf(s, ORIGINAL_BASE).original === original && baseOf(s, "nope").original === original, "baseOf gives the original for the original base and for an unknown one");

// applied source text comes from the base in the present state, so undo and redo change it
const id1 = resultBaseId(img(1));
const withBase = { ...s, bases: { ...s.bases, [id1]: { original: { kind: "comfy" as const, image: img(1) }, prompt: "prompt 1", negative: "neg 1" } } };
ok(appliedSource(withBase, ORIGINAL_BASE) === null && appliedSource(withBase, "missing") === null, "the original base (or an unknown one) has no applied source: Reset uses the session's source");
const a = appliedSource(withBase, id1);
ok(a?.prompt === "prompt 1" && a.negative === "neg 1", "an applied result's source is its own prompt and negative");
let h = withBase.history;
h = commit(h, addPaintStroke(h.present, stroke));
h = commit(h, applyResult(h.present, id1));
ok(appliedSource(withBase, h.present.base)?.prompt === "prompt 1" && appliedSource(withBase, undo(h).present.base) === null && appliedSource(withBase, redo(undo(h)).present.base)?.prompt === "prompt 1", "undoing an Apply gives back the previous source text, redo the applied one");
ok(h.present.paint.length === 0 && undo(h).present.paint.length === 1, "an Apply clears the paint and undo brings it back");
const masked = setMask(h.present, { softness: 5 });
ok(applyResult(masked, "x").mask === masked.mask, "an Apply keeps the mask");

// storing and reading bases
const store = (() => { const m = new Map<string, string>(); return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; })();
ok(saveSession({ ...withBase, history: h }, store), "a session with an applied base is saved");
const back = loadSession(s.id, store);
ok(back?.bases[id1]?.original.kind === "comfy" && back.bases[id1].prompt === "prompt 1" && back.bases[ORIGINAL_BASE].original.kind === "comfy" && back.history.present.base === id1, "bases and the applied state read back");
const old = readSession(JSON.parse(JSON.stringify({ ...s, bases: undefined })));
ok(old !== null && old.bases[ORIGINAL_BASE].original.kind === "comfy" && old.bases[ORIGINAL_BASE].prompt === "a cat", "a session saved before bases existed gets the original as its base");
const damaged = readSession(JSON.parse(JSON.stringify({ ...s, bases: { [id1]: { original: { kind: "bogus" } }, [ORIGINAL_BASE]: { original: { kind: "bogus" } }, ok: { original: { kind: "codex", pictureId: "p1" }, prompt: 5 } } })));
ok(damaged !== null && !(id1 in damaged.bases) && damaged.bases[ORIGINAL_BASE].original.kind === "comfy" && damaged.bases.ok?.original.kind === "codex" && damaged.bases.ok.prompt === undefined, "damaged bases are dropped, the original base cannot be replaced");

// the tray: newest first; previous / next along it; Discard picks the next, else the previous, else none
const list = addResults([], [res(0), res(1), res(2)]);
const k = (n: number) => resultKey(res(n));
ok(trayOrder(list).map((r) => r.seed).join() === "2,1,0", "the tray is newest first");
ok(neighbour(list, k(1), -1)?.seed === 2 && neighbour(list, k(1), 1)?.seed === 0 && neighbour(list, k(2), -1) === null && neighbour(list, k(0), 1) === null && neighbour(list, "nope", 1) === null, "previous and next go along the tray and stop at its ends");
let d = discardResult(list, k(1));
ok(d.results.map((r) => r.seed).join() === "0,2" && d.next === k(0), "discarding a middle result selects the next one in the tray");
d = discardResult(list, k(0));
ok(d.next === k(1) && d.results.length === 2, "discarding the last in the tray selects the previous one");
d = discardResult(list, k(2));
ok(d.next === k(1), "discarding the first in the tray selects the next one");
d = discardResult([res(5)], k(5));
ok(d.results.length === 0 && d.next === null, "discarding the only result selects nothing");

// Apply's helpers
ok(!sizeDiffers(96, 60, { w: 96, h: 60 }) && sizeDiffers(112, 64, { w: 96, h: 60 }) && sizeDiffers(96, 64, { w: 96, h: 60 }), "a size differs when either side does");
const up = uploadedImage("storytime-refine-x.png");
ok(up.filename === "storytime-refine-x.png" && up.subfolder === "" && up.type === "input", "an uploaded name is a picture of the input folder");
const sub = uploadedImage("a/b/x.png");
ok(sub.filename === "x.png" && sub.subfolder === "a/b" && sub.type === "input", "…with the subfolder split off");
