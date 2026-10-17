"use client";

// Drafts live only in this browser (IndexedDB). Nothing reaches the server until Post.

import type { CodexChange } from "./codex";

export type DraftVersion = { title: string; body: string };

export type Draft = {
  /** One draft per place you're writing: "story", "fill:<choiceId>" or "new:<chapterId>". */
  key: string;
  /** Where to go to resume this draft. */
  href: string;
  /** Short description shown in the drafts list. */
  label: string;
  updatedAt: number;
  storyTitle: string;
  premise: string;
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

const DB_NAME = "storytime";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function emptyDraft(key: string, href: string, label: string): Draft {
  return {
    key,
    href,
    label,
    updatedAt: Date.now(),
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
  return run("readonly", (s) => s.get(key) as IDBRequest<Draft | undefined>);
}

export async function putDraft(draft: Draft): Promise<void> {
  await run("readwrite", (s) => s.put({ ...draft, updatedAt: Date.now() }));
}

export async function deleteDraft(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}

export async function listDrafts(): Promise<Draft[]> {
  const all = await run("readonly", (s) => s.getAll() as IDBRequest<Draft[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
