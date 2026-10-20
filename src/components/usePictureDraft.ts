"use client";

import { useEffect, useRef, useState } from "react";
import type { PictureBoxes, PictureDraft, PictureDraftInput } from "@/lib/pictureDrafts";

// How long typing has to pause before the prompt boxes are saved.
const PAUSE_MS = 700;

export const EMPTY_BOXES: PictureBoxes = { prompt: "", negative: "", scene: "", direction: "" };

const keyOf = (d: PictureDraftInput) => JSON.stringify([d.prompt, d.negative, d.scene, d.direction, d.moment]);

function put(url: string, draft: PictureDraftInput, keepalive = false) {
  return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), keepalive });
}

/**
 * Keeps the chapter's prompt boxes saved on the server, for the moment being shown: a moment after each
 * change, and straight away when the page is left (closed, reloaded, or another page opened in the app) or
 * another moment is chosen. Choosing a moment saves it too, so the page opens on it next time. `saved` is
 * what the page opened with. Returns why the last save failed, or null.
 */
export function usePictureDraft(chapterId: string, current: PictureDraftInput, saved: PictureDraft | null): string | null {
  const url = `/api/chapters/${chapterId}/picture-draft`;
  const [error, setError] = useState<string | null>(null);
  // What the server has as the current moment's boxes, and a change not sent yet.
  const stored = useRef(keyOf(saved ? { moment: saved.moment, ...saved[saved.moment] } : { moment: "start", ...EMPTY_BOXES }));
  const pending = useRef<PictureDraftInput | null>(null);
  // Saves go one after another: the one saved last decides the moment the page opens on.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const key = keyOf(current);

  useEffect(() => {
    const send = (draft: PictureDraftInput) => {
      queue.current = queue.current.then(() =>
        put(url, draft).then(
          async (res) => {
            if (res.ok) {
              stored.current = keyOf(draft);
              setError(null);
            } else {
              const data = await res.json().catch(() => ({}));
              setError(data.error ?? `the server answered ${res.status}`);
            }
          },
          () => setError("StoryTime couldn't be reached"),
        ),
      );
    };
    const draft: PictureDraftInput = { ...current };
    // A change to the other moment's boxes still waiting is sent now, before this moment's.
    const waiting = pending.current;
    pending.current = null;
    const switched = waiting !== null && waiting.moment !== draft.moment;
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
    // `current` is fully described by `key`
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
  }, [url]);

  return error;
}
