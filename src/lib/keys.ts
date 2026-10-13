"use client";

import { useSyncExternalStore } from "react";

// Edit keys prove "this browser posted that chapter". They live only in localStorage
// (and in the settings export file); the server stores just a hash of each one.

const STORAGE_KEY = "storytime.editKeys.v1";
const listeners = new Set<() => void>();

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(keys: Record<string, string>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    return false;
  }
  listeners.forEach((l) => l());
  return true;
}

export function newEditKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function saveEditKey(chapterId: string, key: string): boolean {
  return write({ ...read(), [chapterId]: key });
}

export function getEditKey(chapterId: string): string | null {
  return read()[chapterId] ?? null;
}

export function getAllEditKeys(): Record<string, string> {
  return read();
}

/** Adds keys from an imported file without discarding ones already here. */
export function mergeEditKeys(incoming: unknown): number {
  if (!incoming || typeof incoming !== "object") return 0;
  const current = read();
  let added = 0;
  for (const [id, key] of Object.entries(incoming as Record<string, unknown>)) {
    if (typeof key === "string" && key.length >= 16 && key.length <= 128 && current[id] !== key) {
      current[id] = key;
      added++;
    }
  }
  if (added > 0) write(current);
  return added;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The edit key for a chapter if this browser has it, else null. */
export function useEditKey(chapterId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getEditKey(chapterId),
    () => null,
  );
}
