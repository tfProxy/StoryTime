// What the Illustrate page keeps in this browser so a refresh doesn't lose the picture being changed by
// instruction, and the edit's text and strength. Per chapter (and one set for the story's cover),
// named by `stateKey`; browser code.
import type { PictureSlot, PictureTarget } from "../pictureTarget";
import type { ComfyImage } from "./client";
import type { LoraOverride, LoraOverrides } from "./loraOverrides";

/** What the stored values are kept under: the chapter's id (as before covers), `cover-<story id>` or `codex-<entry id>`. */
export const stateKey = (t: PictureTarget) => (t.kind === "chapter" ? t.chapterId : t.kind === "cover" ? `cover-${t.storyId}` : `codex-${t.entryId}`);

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

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The Instruct starting picture (one of ComfyUI's, or a saved header, footer or cover). It is written with
 * `mode: "edit"`; a start stored by an earlier version as `"redraw"` (with a painted area, which is
 * ignored) still loads, as the Instruct starting picture.
 */
export type StoredStart = { mode: "edit"; image?: ComfyImage; slot?: PictureSlot };

export function readStart(chapterId: string): StoredStart | null {
  const v = read("start", chapterId);
  if (!isObject(v) || (v.mode !== "redraw" && v.mode !== "edit")) return null;
  const im = v.image;
  if (isObject(im) && typeof im.filename === "string" && typeof im.subfolder === "string" && typeof im.type === "string") {
    return { mode: "edit", image: { filename: im.filename, subfolder: im.subfolder, type: im.type } };
  }
  if (v.slot === "header" || v.slot === "footer" || v.slot === "cover") return { mode: "edit", slot: v.slot };
  return null;
}

export const writeStart = (chapterId: string, start: StoredStart | null) => write("start", chapterId, start);

/**
 * What the Instruct panel has in it: the instruction, and the strength when it was moved from the preset's
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

/** The LoRA switches and strengths changed on the page (never the preset's own), by preset id; see `loraOverrides.ts`. */
export const readLoras = (chapterId: string): LoraOverrides => parseLoras(read("loras", chapterId));

/** LoRA overrides read defensively from stored JSON (anything unusable is left out). */
export function parseLoras(v: unknown): LoraOverrides {
  const out: LoraOverrides = {};
  if (!isObject(v)) return out;
  for (const [preset, rows] of Object.entries(v)) {
    if (!preset || !isObject(rows)) continue;
    const mine: Record<string, LoraOverride> = {};
    for (const [index, o] of Object.entries(rows)) {
      if (!/^\d{1,2}$/.test(index) || !isObject(o) || typeof o.name !== "string" || !o.name) continue;
      const row: LoraOverride = { name: o.name };
      if (typeof o.on === "boolean") row.on = o.on;
      if (isNum(o.strength)) row.strength = Math.min(4, Math.max(-4, o.strength));
      if (row.on !== undefined || row.strength !== undefined) mine[index] = row;
    }
    if (Object.keys(mine).length > 0) out[preset] = mine;
  }
  return out;
}

export const writeLoras = (chapterId: string, loras: LoraOverrides) => write("loras", chapterId, Object.keys(loras).length > 0 ? loras : null);
