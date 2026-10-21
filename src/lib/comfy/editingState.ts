// What the Illustrate page keeps in this browser so a refresh doesn't lose the picture being edited or
// redrawn, the mode, and the edit's text and strength. Per chapter; browser code.
import type { ImageSlot } from "../imageSlots";
import type { ComfyImage } from "./client";

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

/** What the Edit tab has in it: the instruction and the strength. */
export type StoredEdit = { instruction: string; strength: number };

export function readEdit(chapterId: string): StoredEdit | null {
  const v = read("edit", chapterId);
  if (!isObject(v) || typeof v.instruction !== "string" || typeof v.strength !== "number") return null;
  return { instruction: v.instruction, strength: Math.min(1, Math.max(0.05, v.strength)) };
}

export const writeEdit = (chapterId: string, edit: StoredEdit) => write("edit", chapterId, edit);
