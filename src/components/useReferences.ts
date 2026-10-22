"use client";

import { useCallback, useMemo, useState } from "react";
import { MAX_REFERENCES, storedOf, type Reference, type StoredReference } from "@/lib/comfy/references";
import { restoreReference, type RefPool } from "@/lib/comfy/referenceChoices";

/** A reference picture to add to the page's References, handed down by the picture workspace; `nonce` changes with each request. */
export type RefRequest = { ref: Reference; nonce: number };

/** What is kept of a reference: not an upload, whose picture is gone with the page. */
const kept = (list: StoredReference[]) => list.filter((r) => !r.source.startsWith("upload:"));

/**
 * A page's reference pictures, one list per group (a chapter's moments; the cover has one). The lists come
 * from what was kept on the server (`initial`), found again in `pool` (saved pictures) and ComfyUI; one
 * whose picture can't be found is left out. `stored(group)` is what to keep: the same lists without uploads.
 */
export function useReferences(initial: Record<string, StoredReference[]>, pool: RefPool, comfyUrl: string) {
  // Each list holds kept references not turned back into pictures yet, and pictures chosen on this visit.
  const [lists, setLists] = useState<Record<string, (StoredReference | Reference)[]>>(() =>
    Object.fromEntries(Object.entries(initial).map(([group, list]) => [group, kept(list)])),
  );

  const resolved = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(lists).map(([group, list]) => [
          group,
          list.flatMap((r) => ("blob" in r ? [r] : [restoreReference(r, { pool, comfyUrl })].filter((x) => x !== null))),
        ]),
      ) as Record<string, Reference[]>,
    [lists, pool, comfyUrl],
  );
  const refsOf = useCallback((group: string): Reference[] => resolved[group] ?? [], [resolved]);

  /** What to keep for a group. Until ComfyUI's address is known, its own pictures can't be found, so the list is kept as it came. */
  const stored = useCallback(
    (group: string): StoredReference[] => (comfyUrl ? kept(storedOf(refsOf(group))) : kept((lists[group] ?? []).map(({ source, label, role, weight }) => ({ source, label, role, weight })))),
    [comfyUrl, refsOf, lists],
  );

  const set = useCallback((group: string, refs: Reference[]) => setLists((prev) => ({ ...prev, [group]: refs.slice(0, MAX_REFERENCES) })), []);
  /** Adds a picture unless it is there already (same picture) or the group is full. */
  const add = useCallback(
    (group: string, ref: Reference) =>
      setLists((prev) => {
        const list = prev[group] ?? [];
        if (list.length >= MAX_REFERENCES || list.some((r) => r.source === ref.source)) return prev;
        return { ...prev, [group]: [...list, ref] };
      }),
    [],
  );
  /** Replaces a group's list by kept references (Load prompt). Uploads are skipped. */
  const replace = useCallback((group: string, list: StoredReference[]) => setLists((prev) => ({ ...prev, [group]: kept(list).slice(0, MAX_REFERENCES) })), []);

  return { refsOf, stored, set, add, replace };
}
