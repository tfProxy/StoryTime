// A Refine session: the picture being refined, where it came from, and the editor's state with its undo history.
// It lives in this browser (localStorage, `storytime.refine.<id>`), never on the server. The picture itself is
// NOT stored: it is fetched again from `original`. Pure code plus thin storage helpers (every storage access is
// in a try/catch, so the page works without storage).
import type { ComfyImage } from "../comfy/client";
import { readPaintStrokes } from "../paint";
import type { MaskState, MaskStroke } from "../mask";
import { startHistory, type History, type RefineState } from "../refineHistory";
import type { PictureTarget, SavedSlot } from "../pictureTarget";
import { parseLoras } from "../comfy/editingState";
import type { LoraOverrides } from "../comfy/loraOverrides";

/** Where a session's picture is fetched from again: one of ComfyUI's, a saved header/footer/cover (at the version it had), or a codex picture. */
export type StoredOriginal =
  | { kind: "comfy"; image: ComfyImage }
  | { kind: "saved"; slot: SavedSlot; version: number }
  | { kind: "codex"; pictureId: string };

export type RefineSession = {
  id: string;
  /** The page the author came from (Cancel goes back there). */
  target: PictureTarget;
  createdAt: number;
  /** When it was last saved (pruning goes by this). */
  updatedAt: number;
  original: StoredOriginal;
  /** The prompt and negative that made the picture, when known. */
  prompt?: string;
  negative?: string;
  /** The page's LoRA overrides when the session started (`readLoras`), kept as stored. */
  loras: unknown;
  /**
   * What Reset puts back in the Prompt panel's boxes: the picture the session works from (the original's prompt, and
   * later an applied result's own). Undefined until the panel has worked it out (the session had no prompt, so the
   * story page's draft is asked), and `sourceAlways` is the chapter's "Always include" text.
   */
  sourcePrompt?: string;
  sourceNegative?: string;
  sourceAlways?: string;
  /** What the Prompt panel's boxes hold now (undefined: still the source). The Always add box is this session's own copy, never written back. */
  boxPrompt?: string;
  boxNegative?: string;
  boxAlways?: string;
  /** The LoRA switches and strengths changed on this screen, by preset id (`loraOverrides.ts`); undefined = still the page's (`loras`). Never written to the page or the preset. */
  loraChanges?: LoraOverrides;
  /** The pictures made from here, oldest first (at most MAX_RESULTS); the images stay in ComfyUI. */
  results: RefineResult[];
  /**
   * Every working picture the history can reach, by the id `RefineState.base` holds: the original (`ORIGINAL_BASE`) and
   * each result that was applied (`resultBaseId`). Kept so a reload and Undo can fetch the picture again.
   */
  bases: Record<string, StoredBase>;
  /** What Accept has already done for the picture it is saving, so trying again after an error doesn't record it twice (`accept.ts`). */
  accepting?: AcceptRecord;
  history: History<RefineState>;
};

/**
 * Accept's progress for one picture (`sig` names the base and the visible paint). `promptId` is the synthetic ComfyUI
 * job id the new log record is made under; `image` is set once the picture is in ComfyUI, `jobId` once it is in the log.
 */
export type AcceptRecord = { sig: string; promptId: string; image?: ComfyImage; jobId?: string };

/** One working picture: where to fetch it again, and the prompt and negative that made it when known. */
export type StoredBase = { original: StoredOriginal; prompt?: string; negative?: string };

/** The base id of an applied result (the same result always has the same id). */
export const resultBaseId = (image: ComfyImage) => `result:${image.type}/${image.subfolder}/${image.filename}`;

/** The base `id` names; the original picture when it is unknown. */
export function baseOf(session: Pick<RefineSession, "bases" | "original" | "prompt" | "negative">, id: string): StoredBase {
  return session.bases[id] ?? { original: session.original, ...(session.prompt !== undefined && { prompt: session.prompt }), ...(session.negative !== undefined && { negative: session.negative }) };
}

/**
 * The text Reset in the Prompt panel goes back to for the working picture `base`: an applied result's own prompt and
 * negative, else null (the original picture's `sourcePrompt` / `sourceNegative` apply). Worked out from the base, so Undo
 * and Redo of an Apply change it with the picture.
 */
export function appliedSource(session: Pick<RefineSession, "bases">, base: string): { prompt: string; negative: string } | null {
  if (base === ORIGINAL_BASE) return null;
  const b = session.bases[base];
  return b && b.prompt !== undefined ? { prompt: b.prompt, negative: b.negative ?? "" } : null;
}

/** One picture a Refine job made. `madeFrom` is the id of the base picture the job started from. */
export type RefineResult = { image: ComfyImage; prompt: string; negative: string; seed: number; madeFrom: string; at: number };

export const MAX_RESULTS = 60;

/** Names a result (the same picture always has the same key). */
export const resultKey = (r: RefineResult) => `${r.image.type}/${r.image.subfolder}/${r.image.filename}`;

/** The results as the tray shows them, newest first; Previous and Next go along this order. */
export const trayOrder = (results: RefineResult[]): RefineResult[] => [...results].reverse();

/** The result before/after `key` in the tray (null at the ends or when `key` isn't there). */
export function neighbour(results: RefineResult[], key: string, step: -1 | 1): RefineResult | null {
  const tray = trayOrder(results);
  const i = tray.findIndex((r) => resultKey(r) === key);
  return i < 0 ? null : (tray[i + step] ?? null);
}

/** The results without `key`, and the key to select now: the next in the tray, else the previous, else null (no result left). */
export function discardResult(results: RefineResult[], key: string): { results: RefineResult[]; next: string | null } {
  const after = neighbour(results, key, 1) ?? neighbour(results, key, -1);
  return { results: results.filter((r) => resultKey(r) !== key), next: after ? resultKey(after) : null };
}

/** The results with `added` after them (a picture already there is skipped), the oldest dropped beyond MAX_RESULTS. */
export function addResults(results: RefineResult[], added: RefineResult[]): RefineResult[] {
  const have = new Set(results.map(resultKey));
  const next = [...results];
  for (const r of added) {
    if (have.has(resultKey(r))) continue;
    have.add(resultKey(r));
    next.push(r);
  }
  return next.slice(-MAX_RESULTS);
}

export const SESSION_PREFIX = "storytime.refine.";
export const SESSION_KEY = (id: string) => `${SESSION_PREFIX}${id}`;
/** The key the tool settings are kept under; it shares the prefix, so pruning leaves it alone. */
export const TOOLS_KEY_NAME = `${SESSION_PREFIX}tools`;
/** The most JSON a saved session may take; older history goes first. */
export const MAX_SESSION_BYTES = 3_000_000;
export const ORIGINAL_BASE = "original";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const SESSION_ID = /^[a-z0-9]{6,40}$/;

export function newSessionId(): string {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

export const isSessionId = (s: unknown): s is string => typeof s === "string" && SESSION_ID.test(s);

/** A new session for a picture; the editor starts empty. */
export function newSession(init: { target: PictureTarget; original: StoredOriginal; prompt?: string; negative?: string; loras?: unknown; now?: number; id?: string }): RefineSession {
  const now = init.now ?? Date.now();
  return {
    id: init.id ?? newSessionId(),
    target: init.target,
    createdAt: now,
    updatedAt: now,
    original: init.original,
    ...(init.prompt ? { prompt: init.prompt } : {}),
    ...(init.negative ? { negative: init.negative } : {}),
    loras: init.loras ?? null,
    // The source is known now when the picture has a prompt; otherwise the Prompt panel looks the story page's draft up.
    ...(init.prompt ? { sourcePrompt: init.prompt, sourceNegative: init.negative ?? "" } : {}),
    results: [],
    bases: { [ORIGINAL_BASE]: { original: init.original, ...(init.prompt ? { prompt: init.prompt, negative: init.negative ?? "" } : {}) } },
    history: startHistory<RefineState>({ base: ORIGINAL_BASE, paint: [], mask: { strokes: [], softness: 0, inverted: false }, paintVisible: true, maskVisible: true }),
  };
}

/** The original of a picture chosen to start from (a `StartPicture`), or null when it can't be fetched again. */
export function originalOf(p: { image?: ComfyImage; slot?: string; source: string; key: string }): StoredOriginal | null {
  if (p.image) return { kind: "comfy", image: { filename: p.image.filename, subfolder: p.image.subfolder, type: p.image.type } };
  if (p.source.startsWith("codex:")) return { kind: "codex", pictureId: p.source.slice("codex:".length) };
  if (p.slot === "header" || p.slot === "middle" || p.slot === "footer" || p.slot === "cover") {
    const version = Number(p.key.split(":").pop());
    return Number.isFinite(version) ? { kind: "saved", slot: p.slot, version } : null;
  }
  return null;
}

// ---- reading (defensive) ----

export function readTarget(v: unknown): PictureTarget | null {
  if (!isObject(v) || !isStr(v.storyId)) return null;
  if (v.kind === "chapter" && isStr(v.chapterId)) return { kind: "chapter", storyId: v.storyId, chapterId: v.chapterId };
  if (v.kind === "cover") return { kind: "cover", storyId: v.storyId };
  if (v.kind === "codex" && isStr(v.entryId)) return { kind: "codex", storyId: v.storyId, entryId: v.entryId };
  return null;
}

export function readOriginal(v: unknown): StoredOriginal | null {
  if (!isObject(v)) return null;
  if (v.kind === "comfy" && isObject(v.image)) {
    const im = v.image;
    if (typeof im.filename === "string" && im.filename && typeof im.subfolder === "string" && typeof im.type === "string") {
      return { kind: "comfy", image: { filename: im.filename, subfolder: im.subfolder, type: im.type } };
    }
    return null;
  }
  if (v.kind === "saved" && (v.slot === "header" || v.slot === "middle" || v.slot === "footer" || v.slot === "cover") && isNum(v.version)) return { kind: "saved", slot: v.slot, version: v.version };
  if (v.kind === "codex" && isStr(v.pictureId)) return { kind: "codex", pictureId: v.pictureId };
  return null;
}

function readMaskState(v: unknown): MaskState | null {
  if (!isObject(v) || !Array.isArray(v.strokes) || !isNum(v.softness) || typeof v.inverted !== "boolean") return null;
  const strokes: MaskStroke[] = [];
  for (const s of v.strokes) {
    if (!isObject(s) || (s.tool !== "brush" && s.tool !== "eraser" && s.tool !== "fill") || !isNum(s.size) || !Array.isArray(s.points)) return null;
    const points: MaskStroke["points"] = [];
    for (const p of s.points) {
      if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) return null;
      points.push([p[0], p[1], isNum(p[2]) ? Math.min(1, Math.max(0, p[2])) : 0]);
    }
    strokes.push({ tool: s.tool, size: Math.max(1, s.size), points });
  }
  return { strokes, softness: Math.max(0, v.softness), inverted: v.inverted };
}

export function readRefineState(v: unknown): RefineState | null {
  if (!isObject(v) || !isStr(v.base)) return null;
  const mask = readMaskState(v.mask);
  if (!mask) return null;
  return { base: v.base, paint: readPaintStrokes(v.paint), mask, paintVisible: v.paintVisible !== false, maskVisible: v.maskVisible !== false };
}

export function readHistory(v: unknown): History<RefineState> | null {
  if (!isObject(v) || !Array.isArray(v.past) || !Array.isArray(v.future)) return null;
  const present = readRefineState(v.present);
  if (!present) return null;
  const list = (a: unknown[]) => a.map(readRefineState).filter((s): s is RefineState => s !== null);
  return { past: list(v.past), present, future: list(v.future) };
}

function readResult(v: unknown): RefineResult | null {
  if (!isObject(v) || !isObject(v.image)) return null;
  const im = v.image;
  if (typeof im.filename !== "string" || !im.filename || typeof im.subfolder !== "string" || typeof im.type !== "string") return null;
  if (typeof v.prompt !== "string" || typeof v.negative !== "string" || !isNum(v.seed) || typeof v.madeFrom !== "string" || !isNum(v.at)) return null;
  return { image: { filename: im.filename, subfolder: im.subfolder, type: im.type }, prompt: v.prompt, negative: v.negative, seed: v.seed, madeFrom: v.madeFrom, at: v.at };
}

/** Stored results, defensively; a session saved before results existed has none. */
export function readResults(v: unknown): RefineResult[] {
  if (!Array.isArray(v)) return [];
  return v.map(readResult).filter((r): r is RefineResult => r !== null).slice(-MAX_RESULTS);
}

/** Stored bases, defensively; the original is always there (a session saved before bases existed has only it). */
export function readBases(v: unknown, original: StoredOriginal, prompt?: string, negative?: string): Record<string, StoredBase> {
  const out: Record<string, StoredBase> = {};
  if (isObject(v)) {
    for (const [id, b] of Object.entries(v)) {
      if (!isObject(b) || id === ORIGINAL_BASE) continue;
      const o = readOriginal(b.original);
      if (!o) continue;
      out[id] = { original: o, ...(typeof b.prompt === "string" && { prompt: b.prompt }), ...(typeof b.negative === "string" && { negative: b.negative }) };
    }
  }
  out[ORIGINAL_BASE] = { original, ...(prompt ? { prompt, negative: negative ?? "" } : {}) };
  return out;
}

const optStr = (v: unknown) => (typeof v === "string" ? v : undefined);

/** A session read back from stored JSON; null when it is not a usable session. */
export function readSession(v: unknown): RefineSession | null {
  if (!isObject(v) || !isSessionId(v.id)) return null;
  const target = readTarget(v.target);
  const original = readOriginal(v.original);
  const history = readHistory(v.history);
  if (!target || !original || !history || !isNum(v.createdAt)) return null;
  const prompt = typeof v.prompt === "string" && v.prompt ? v.prompt : undefined;
  const negative = typeof v.negative === "string" && v.negative ? v.negative : undefined;
  return {
    id: v.id,
    target,
    createdAt: v.createdAt,
    updatedAt: isNum(v.updatedAt) ? v.updatedAt : v.createdAt,
    original,
    ...(typeof v.prompt === "string" && v.prompt ? { prompt: v.prompt } : {}),
    ...(typeof v.negative === "string" && v.negative ? { negative: v.negative } : {}),
    loras: v.loras ?? null,
    ...(optStr(v.sourcePrompt) !== undefined && { sourcePrompt: optStr(v.sourcePrompt) }),
    ...(optStr(v.sourceNegative) !== undefined && { sourceNegative: optStr(v.sourceNegative) }),
    ...(optStr(v.sourceAlways) !== undefined && { sourceAlways: optStr(v.sourceAlways) }),
    ...(optStr(v.boxPrompt) !== undefined && { boxPrompt: optStr(v.boxPrompt) }),
    ...(optStr(v.boxNegative) !== undefined && { boxNegative: optStr(v.boxNegative) }),
    ...(optStr(v.boxAlways) !== undefined && { boxAlways: optStr(v.boxAlways) }),
    ...(isObject(v.loraChanges) && { loraChanges: parseLoras(v.loraChanges) }),
    results: readResults(v.results),
    bases: readBases(v.bases, original, prompt, negative),
    ...(readAccepting(v.accepting) && { accepting: readAccepting(v.accepting)! }),
    history,
  };
}

/** Stored Accept progress, defensively. */
export function readAccepting(v: unknown): AcceptRecord | null {
  if (!isObject(v) || !isStr(v.sig) || !isStr(v.promptId)) return null;
  const im = isObject(v.image) ? v.image : null;
  const image = im && isStr(im.filename) && typeof im.subfolder === "string" && isStr(im.type) ? { filename: im.filename, subfolder: im.subfolder, type: im.type } : undefined;
  return { sig: v.sig, promptId: v.promptId, ...(image && { image }), ...(isStr(v.jobId) && { jobId: v.jobId }) };
}

/** The ComfyUI picture an applied result's base id names (`resultBaseId`), or null for the original or an unknown id. */
export function imageOfResultBase(id: string): ComfyImage | null {
  const m = /^result:([^/]+)\/(.*)\/([^/]+)$/.exec(id);
  return m ? { type: m[1], subfolder: m[2], filename: m[3] } : null;
}

// ---- keeping it ----

/** The history with the oldest entries dropped (a quarter at a time, then the redo list, then all) until the whole session fits `maxBytes`. */
export function serializeSession(session: RefineSession, maxBytes = MAX_SESSION_BYTES): string | null {
  let s = session;
  for (;;) {
    const json = JSON.stringify(s);
    if (json.length <= maxBytes) return json;
    const h = s.history;
    if (h.past.length > 0) s = { ...s, history: { ...h, past: h.past.slice(Math.max(1, Math.ceil(h.past.length / 4))) } };
    else if (h.future.length > 0) s = { ...s, history: { ...h, future: [] } };
    else return null;
  }
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const store = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Saves the session; false when it could not be (no storage, full, or too big even without history). */
export function saveSession(session: RefineSession, storage: Store | null = store(), now = Date.now()): boolean {
  if (!storage) return false;
  const stamped = { ...session, updatedAt: now };
  let cap = MAX_SESSION_BYTES;
  for (let attempt = 0; attempt < 4; attempt++) {
    const json = serializeSession(stamped, cap);
    if (json === null) return false;
    try {
      storage.setItem(SESSION_KEY(session.id), json);
      return true;
    } catch {
      cap = Math.floor(cap / 3);
    }
  }
  return false;
}

export function loadSession(id: string, storage: Store | null = store()): RefineSession | null {
  if (!storage || !isSessionId(id)) return null;
  try {
    const raw = storage.getItem(SESSION_KEY(id));
    return raw ? readSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function deleteSession(id: string, storage: Store | null = store()): void {
  try {
    storage?.removeItem(SESSION_KEY(id));
  } catch {
    // nothing to do
  }
}

/** Removes sessions not saved for `maxAgeDays` days, and stored values under the prefix that are not sessions. Returns how many went. */
export function pruneSessions(maxAgeDays = 14, storage: Store | null = store(), now = Date.now()): number {
  if (!storage) return 0;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !k.startsWith(SESSION_PREFIX) || k === TOOLS_KEY_NAME) continue;
      let at: number | null = null;
      try {
        const v = JSON.parse(storage.getItem(k) ?? "null");
        if (isObject(v) && isNum(v.createdAt)) at = isNum(v.updatedAt) ? v.updatedAt : v.createdAt;
      } catch {
        // unreadable: dropped
      }
      if (at === null || now - at > maxAgeDays * 86_400_000) doomed.push(k);
    }
    for (const k of doomed) storage.removeItem(k);
  } catch {
    // storage failed half way: nothing more to do
  }
  return doomed.length;
}
