// Undo and redo for the whole Refine editor state. The history is a plain value (it can be kept in React state
// or saved as JSON). States are immutable and share structure (a stroke list grows by spreading, so each past
// state costs only a new array of references). Heavy data, such as the working picture's blob, must NOT be in
// the state: hold it elsewhere by id and put the id in the state.

import { emptyMask, type MaskState, type MaskStroke } from "./mask";
import type { PaintStroke } from "./paint";

export type History<T> = { past: T[]; present: T; future: T[] };

export const startHistory = <T>(initial: T): History<T> => ({ past: [], present: initial, future: [] });

/** Makes `next` the present; the old present becomes undoable, redo is cleared, the oldest beyond `limit` go. The same object is no change. */
export function commit<T>(h: History<T>, next: T, limit = 200): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// ---- the editor's state ----

export type RefineState = {
  /** Id of the working picture (its blob is held elsewhere). */
  base: string;
  paint: PaintStroke[];
  mask: MaskState;
  paintVisible: boolean;
  maskVisible: boolean;
};

export const initialRefineState = (base: string): RefineState => ({ base, paint: [], mask: emptyMask(), paintVisible: true, maskVisible: true });

export const addPaintStroke = (s: RefineState, stroke: PaintStroke): RefineState => ({ ...s, paint: [...s.paint, stroke] });

export const addMaskStroke = (s: RefineState, stroke: MaskStroke): RefineState => ({ ...s, mask: { ...s.mask, strokes: [...s.mask.strokes, stroke] } });

/** Changes the mask's softness and/or inverted. The same state when nothing differs. */
export function setMask(s: RefineState, patch: Partial<Pick<MaskState, "softness" | "inverted">>): RefineState {
  const softness = patch.softness ?? s.mask.softness;
  const inverted = patch.inverted ?? s.mask.inverted;
  if (softness === s.mask.softness && inverted === s.mask.inverted) return s;
  return { ...s, mask: { ...s.mask, softness, inverted } };
}

/** Takes every stroke off the mask and un-inverts it (an inverted empty mask would cover everything); the soft edge stays. */
export const clearMask = (s: RefineState): RefineState => (s.mask.strokes.length === 0 && !s.mask.inverted ? s : { ...s, mask: { ...s.mask, strokes: [], inverted: false } });

export const togglePaintVisible = (s: RefineState): RefineState => ({ ...s, paintVisible: !s.paintVisible });
export const toggleMaskVisible = (s: RefineState): RefineState => ({ ...s, maskVisible: !s.maskVisible });

/** A result became the working picture: the paint is part of it (or was thrown away), so it goes; the mask stays for the next try. */
export const applyResult = (s: RefineState, newBaseId: string): RefineState => ({ ...s, base: newBaseId, paint: [] });

export const clearPaint = (s: RefineState): RefineState => (s.paint.length === 0 ? s : { ...s, paint: [] });

/** The paint a job or an apply may use: hidden paint is never sent or committed. */
export const visiblePaintForJob = (s: RefineState): PaintStroke[] => (s.paintVisible ? s.paint : []);
