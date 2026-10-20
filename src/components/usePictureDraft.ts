"use client";

import { useEffect, useRef, useState } from "react";
import type { PictureDraft } from "@/lib/pictureDrafts";

// How long typing has to pause before the prompt boxes are saved.
const PAUSE_MS = 700;

const EMPTY: PictureDraft = { prompt: "", negative: "", scene: "", direction: "", moment: "start" };
const keyOf = (d: PictureDraft) => JSON.stringify([d.prompt, d.negative, d.scene, d.direction, d.moment]);

function put(url: string, draft: PictureDraft, keepalive = false) {
  return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), keepalive });
}

/**
 * Keeps the chapter's prompt boxes saved on the server: a moment after each change, and straight away when
 * the page is left (closed, reloaded, or another page opened in the app). `saved` is what the page opened
 * with. Returns why the last save failed, or null.
 */
export function usePictureDraft(chapterId: string, current: PictureDraft, saved: PictureDraft | null): string | null {
  const url = `/api/chapters/${chapterId}/picture-draft`;
  const [error, setError] = useState<string | null>(null);
  // What the server has, and a change not sent yet.
  const stored = useRef(keyOf(saved ?? EMPTY));
  const pending = useRef<PictureDraft | null>(null);
  const key = keyOf(current);

  useEffect(() => {
    if (key === stored.current) {
      pending.current = null;
      return;
    }
    const draft: PictureDraft = JSON.parse(JSON.stringify(current));
    pending.current = draft;
    const timer = setTimeout(() => {
      pending.current = null;
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
      );
    }, PAUSE_MS);
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
