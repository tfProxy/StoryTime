"use client";

import { useEffect, useRef, useState } from "react";
import type { PictureBoxes, PictureDraft, PictureDraftInput } from "@/lib/pictureDrafts";
import type { CoverDraft } from "@/lib/coverPictures";

// How long typing has to pause before the prompt boxes are saved.
const PAUSE_MS = 700;

export const EMPTY_BOXES: PictureBoxes = { prompt: "", negative: "", scene: "", direction: "", refs: [] };

function put(url: string, draft: unknown, keepalive = false) {
  return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), keepalive });
}

/**
 * Keeps prompt boxes saved on the server at `url` (PUT with the boxes as JSON): a moment after each change,
 * and straight away when the page is left (closed, reloaded, or another page opened in the app) or the
 * `group` changes (the chapter's other moment chosen: its own boxes, so the other's waiting change is sent
 * first). `keyOf` tells whether two sets of boxes differ; `saved` is the key of what the page opened with.
 * Returns why the last save failed, or null.
 */
function useSavedBoxes<T>(url: string, current: T, saved: string, keyOf: (d: T) => string, groupOf: (d: T) => string): string | null {
  const [error, setError] = useState<string | null>(null);
  // What the server has as the current boxes, and a change not sent yet.
  const stored = useRef(saved);
  const pending = useRef<T | null>(null);
  // Saves go one after another: the one saved last decides the moment the page opens on.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const key = keyOf(current);

  useEffect(() => {
    const send = (draft: T) => {
      // What the server will have once the queue is through, set now rather than when this save finishes:
      // otherwise switching back to a moment while an earlier save is still on its way compares against a
      // save that is about to be overtaken, and the moment switched back to is never saved.
      const sent = keyOf(draft);
      stored.current = sent;
      queue.current = queue.current.then(() =>
        put(url, draft).then(
          async (res) => {
            if (res.ok) {
              setError(null);
            } else {
              // Not kept: the next change (even back to these same boxes) is sent again.
              if (stored.current === sent) stored.current = "";
              const data = await res.json().catch(() => ({}));
              setError(data.error ?? `the server answered ${res.status}`);
            }
          },
          () => {
            if (stored.current === sent) stored.current = "";
            setError("StoryTime couldn't be reached");
          },
        ),
      );
    };
    const draft: T = { ...current };
    // A change to another group's boxes still waiting is sent now, before this one's.
    const waiting = pending.current;
    pending.current = null;
    const switched = waiting !== null && groupOf(waiting) !== groupOf(draft);
    if (switched) send(waiting);
    if (key === stored.current && !switched) return;
    pending.current = draft;
    const timer = setTimeout(
      () => {
        pending.current = null;
        send(draft);
      },
      switched ? 0 : PAUSE_MS,
    );
    return () => clearTimeout(timer);
    // `current` is fully described by `key`; keyOf and groupOf are fixed for a caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);

  // A change still waiting for its pause is sent as the page goes away.
  useEffect(() => {
    const flush = () => {
      const draft = pending.current;
      if (!draft) return;
      pending.current = null;
      stored.current = keyOf(draft);
      void put(url, draft, true).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return error;
}

const refsKey = (refs: PictureBoxes["refs"]) => refs.map((r) => [r.source, r.label, r.role, r.weight]);
const draftKey = (d: PictureDraftInput) => JSON.stringify([d.prompt, d.negative, d.scene, d.direction, d.moment, refsKey(d.refs)]);
const momentOf = (d: PictureDraftInput) => d.moment;

/**
 * Keeps the chapter's prompt boxes saved on the server, for the moment being shown. Choosing a moment
 * saves it too, so the page opens on it next time. `saved` is what the page opened with.
 */
export function usePictureDraft(chapterId: string, current: PictureDraftInput, saved: PictureDraft | null): string | null {
  const opened = draftKey(saved ? { moment: saved.moment, ...saved[saved.moment] } : { moment: "start", ...EMPTY_BOXES });
  return useSavedBoxes(`/api/chapters/${chapterId}/picture-draft`, current, opened, draftKey, momentOf);
}

const coverKey = (d: CoverDraft) => JSON.stringify([d.prompt, d.negative, d.scene, d.direction, d.source, d.path_chapter_id, refsKey(d.refs)]);
const oneGroup = () => "";

/** An empty set of cover boxes, written from the premise. */
export const EMPTY_COVER: CoverDraft = { ...EMPTY_BOXES, source: "premise", path_chapter_id: null };

/** Keeps the cover page's prompt boxes (and what the prompt is written from) saved on the server. */
export function useCoverDraft(storyId: string, current: CoverDraft, saved: CoverDraft | null): string | null {
  return useSavedBoxes(`/api/stories/${storyId}/cover-draft`, current, coverKey(saved ?? EMPTY_COVER), coverKey, oneGroup);
}
