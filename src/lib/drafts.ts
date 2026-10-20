"use client";

// Drafts are saved on the server (see /api/drafts), so they follow you between browsers. Nothing
// is part of the story until Post. Drafts from before this lived in this browser's IndexedDB;
// they are moved to the server the first time drafts are loaded.

import type { CodexChange } from "./codex";
import type { CodexOverrides, Idea, Length } from "./ai/prompts";
import type { ModelRef } from "./settingsSchema";

export type DraftVersion = { title: string; body: string };

export type Draft = {
  /**
   * One draft per place you're writing: "first:<storyId>", "fill:<choiceId>", "new:<chapterId>" or
   * "edit:<chapterId>". ("story" was a new story's, title and all, before stories were made first.)
   */
  key: string;
  /** Where to go to resume this draft. */
  href: string;
  /** Short description shown in the drafts list. */
  label: string;
  /** Set by the server on each save; 0 for a draft that has never been saved. */
  updatedAt: number;
  storyTitle: string;
  premise: string;
  /** A new story's style notes. (Older drafts may hold unsaved changes to an existing story's; those are ignored.) */
  style?: string;
  newChoiceLabel: string;
  title: string;
  body: string;
  choices: string[];
  prompt: string;
  /** Earlier versions of title/body, newest last, so AI rewrites can be undone. */
  undo: DraftVersion[];
  /** Every draft the AI has generated here, oldest first, so you can step between them. The one being viewed lives in title/body; its entry here is only refreshed when you leave it. */
  versions?: DraftVersion[];
  /** Which of `versions` is currently showing. */
  versionIndex?: number;
  /** The chapter's summary, written by you or generated. Made at post time if left empty. */
  summary?: string;
  /** The last generated summaries and the chapter text they describe, so posting can reuse them. */
  aiSummary?: { summary: string; path_summary: string; body: string };
  /** Codex changes made while writing; they are anchored at this chapter when it is posted. */
  codexChanges?: CodexChange[];

  // Working state of the page, kept so a reload (or another browser) picks up where you were:
  /** Chapter length asked for when generating. */
  length?: Length;
  /** The unsent text in the "ask the AI to change it" box. */
  instruction?: string;
  /** Brainstorm guidance; absent until edited, so it follows the choice text. */
  guidance?: string;
  /** Each "Suggest ideas" adds a page; `ideaPage` is the one showing. */
  ideaPages?: Idea[][];
  ideaPage?: number;
  /** Ideas already added as choices on the previous chapter ("page:index" -> the text used). */
  promoted?: Record<string, string>;
  /** Suggested choices not yet added. */
  suggestions?: string[];
  /** Codex entries pinned into, or left out of, the prompt by hand. */
  codexOverrides?: CodexOverrides;
  /** Models picked on this page instead of the defaults: for writing and revising, and for ideas, choices and choice text. */
  models?: { write?: ModelRef; suggest?: ModelRef };

  // Only used when editing a posted chapter:
  /** The chapter revision this draft started from. */
  baseRevision?: number;
  /** Renames/removals of the chapter's existing choices, by choice id. */
  choiceEdits?: Record<string, { label: string; removed: boolean }>;
  /** New text for the choice leading into the chapter. */
  incomingLabel?: string;
  /** Short note describing the change, saved with the revision. */
  editNote?: string;
};

export type DraftListItem = Pick<Draft, "key" | "href" | "label" | "title" | "storyTitle" | "updatedAt">;

/** A save was refused because the draft was saved from somewhere else first. */
export class DraftConflict extends Error {
  /** The draft as stored now, or null if it has been deleted. */
  constructor(readonly current: Draft | null) {
    super("This draft was changed in another tab or browser");
  }
}

const url = (key: string) => `/api/drafts/${encodeURIComponent(key)}`;

async function failure(res: Response): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error ?? `Request failed (${res.status})`);
}

export function emptyDraft(key: string, href: string, label: string): Draft {
  return {
    key,
    href,
    label,
    updatedAt: 0,
    storyTitle: "",
    premise: "",
    newChoiceLabel: "",
    title: "",
    body: "",
    choices: [""],
    prompt: "",
    undo: [],
  };
}

export async function getDraft(key: string): Promise<Draft | undefined> {
  await moveLocalDrafts();
  const res = await fetch(url(key), { cache: "no-store" });
  if (res.status === 404) return undefined;
  if (!res.ok) throw await failure(res);
  return (await res.json()).draft as Draft;
}

/**
 * Saves the draft over the version saved at `base` (the `updatedAt` it was loaded or last saved
 * with; 0 when it has never been saved). Returns the new `updatedAt`, or throws DraftConflict.
 */
export async function saveDraft(draft: Draft, base: number): Promise<number> {
  const res = await fetch(url(draft.key), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft, base: base || null }),
  });
  if (res.status === 409) throw new DraftConflict(((await res.json()).current as Draft | null) ?? null);
  if (!res.ok) throw await failure(res);
  return (await res.json()).updatedAt as number;
}

export async function deleteDraft(key: string): Promise<void> {
  const res = await fetch(url(key), { method: "DELETE" });
  if (!res.ok) throw await failure(res);
}

export async function listDrafts(): Promise<DraftListItem[]> {
  await moveLocalDrafts();
  const res = await fetch("/api/drafts", { cache: "no-store" });
  if (!res.ok) throw await failure(res);
  return (await res.json()).drafts as DraftListItem[];
}

// ---- moving drafts out of browser storage (older versions kept them there) ----

const LOCAL_DB = "storytime";
const LOCAL_STORE = "drafts";
let moving: Promise<void> | null = null;

/** Runs once per page load. Failures leave the local drafts in place for next time. */
function moveLocalDrafts(): Promise<void> {
  return (moving ??= moveLocal().catch(() => {}));
}

async function moveLocal(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  // Don't create the old database just to find it empty.
  if (typeof indexedDB.databases === "function") {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === LOCAL_DB)) return;
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(LOCAL_STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const store = (mode: IDBTransactionMode) => db.transaction(LOCAL_STORE, mode).objectStore(LOCAL_STORE);
  const done = <T,>(req: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  try {
    const local = await done(store("readonly").getAll() as IDBRequest<Draft[]>);
    let left = local.length;
    for (const d of local) {
      const res = await fetch(url(d.key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: d, imported: true }),
      });
      if (!res.ok) continue;
      await done(store("readwrite").delete(d.key));
      left--;
    }
    if (left > 0) return;
  } finally {
    db.close();
  }
  indexedDB.deleteDatabase(LOCAL_DB);
}
