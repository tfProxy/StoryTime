// What the Illustrate page keeps in this browser so a refresh doesn't lose the picture being edited or
// redrawn, the mode, and the edit's text and strength. Per chapter (and one set for the story's cover),
// named by `stateKey`; browser code.
import type { ImageSlot } from "../imageSlots";
import type { PictureTarget } from "../pictureTarget";
import type { ComfyImage } from "./client";

/** What the stored values are kept under: the chapter's id (as before covers), or `cover-<story id>`. */
export const stateKey = (t: PictureTarget) => t.chapterId ?? `cover-${t.storyId}`;

const key = (name: string, chapterId: string) => `storytime.illustrate.${name}.${chapterId}`;

function read(name: string, chapterId: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key(name, chapterId)) ?? "null");
  } catch {
    return null;
  }
}

function write(name: string, chapterId: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key(name, chapterId));
    else localStorage.setItem(key(name, chapterId), JSON.stringify(value));
  } catch {
    // private window or blocked storage: the page just starts fresh next time
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The starting picture (one of ComfyUI's, or a saved header or footer) and whether it is redrawn or edited. */
export type StoredStart = { mode: "redraw" | "edit"; image?: ComfyImage; slot?: ImageSlot };

export function readStart(chapterId: string): StoredStart | null {
  const v = read("start", chapterId);
  if (!isObject(v) || (v.mode !== "redraw" && v.mode !== "edit")) return null;
  const im = v.image;
  if (isObject(im) && typeof im.filename === "string" && typeof im.subfolder === "string" && typeof im.type === "string") {
    return { mode: v.mode, image: { filename: im.filename, subfolder: im.subfolder, type: im.type } };
  }
  if (v.slot === "header" || v.slot === "footer") return { mode: v.mode, slot: v.slot };
  return null;
}

export const writeStart = (chapterId: string, start: StoredStart | null) => write("start", chapterId, start);

/**
 * What the Edit tab has in it: the instruction, and the strength when it was moved from the preset's
 * default (`model` is the edit preset it was moved for; without it the default applies). It is named
 * `model` because it was an edit model's id before presets, and each model's first preset has its id.
 */
export type StoredEdit = { instruction: string; strength: number; model?: string };

export function readEdit(chapterId: string): StoredEdit | null {
  const v = read("edit", chapterId);
  if (!isObject(v) || typeof v.instruction !== "string" || typeof v.strength !== "number") return null;
  return {
    instruction: v.instruction,
    strength: Math.min(1, Math.max(0.05, v.strength)),
    ...(typeof v.model === "string" && v.model && { model: v.model }),
  };
}

export const writeEdit = (chapterId: string, edit: StoredEdit) => write("edit", chapterId, edit);

/** The Redraw tab's strength when it was moved from the drawing preset's default, and the preset it was moved for. */
export type StoredRedraw = { preset: string; strength: number };

export function readRedraw(chapterId: string): StoredRedraw | null {
  const v = read("redraw", chapterId);
  if (!isObject(v) || typeof v.preset !== "string" || !v.preset || typeof v.strength !== "number") return null;
  return { preset: v.preset, strength: Math.min(1, Math.max(0.05, v.strength)) };
}

export const writeRedraw = (chapterId: string, redraw: StoredRedraw | null) => write("redraw", chapterId, redraw);
