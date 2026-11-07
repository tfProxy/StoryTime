"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const POLL_MS = 15_000;
const GIVE_UP_MS = 3 * 60_000;

/**
 * "Codex: N suggestions from this chapter · Review" on the reading page. The codex check runs in the background after
 * a chapter is posted, so the count is read when the page opens and then every 15 s while the page is visible, until
 * something is found or 3 minutes have passed. Nothing is shown when there are none.
 */
export default function CodexInboxBanner({ storyId, chapterId }: { storyId: string; chapterId: string }) {
  const [count, setCount] = useState(0);
  // Facts the AI applied on its own from this chapter ("Apply the AI's codex changes automatically"), not yet approved.
  const [applied, setApplied] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    async function read() {
      let n = 0;
      let ai = 0;
      try {
        const res = await fetch(`/api/stories/${storyId}/codex-suggestions?status=open&chapter=${encodeURIComponent(chapterId)}`);
        if (res.ok) {
          const counts = ((await res.json()) as { counts: { byChapter: Record<string, number>; aiByChapter?: Record<string, number> } }).counts;
          n = counts.byChapter[chapterId] ?? 0;
          ai = counts.aiByChapter?.[chapterId] ?? 0;
        }
      } catch {
        // try again at the next poll
      }
      if (!live) return;
      setCount(n);
      setApplied(ai);
      if (n === 0 && ai === 0 && Date.now() - started < GIVE_UP_MS) timer = setTimeout(tick, POLL_MS);
    }
    function tick() {
      // A page in the background waits; it reads again when it comes back.
      if (document.visibilityState === "visible") void read();
      else timer = setTimeout(tick, POLL_MS);
    }
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [storyId, chapterId]);

  if (count === 0 && applied === 0) return null;
  const parts = [
    ...(applied > 0 ? [`the AI updated ${applied} fact${applied === 1 ? "" : "s"}`] : []),
    ...(count > 0 ? [`${count} suggestion${count === 1 ? "" : "s"}`] : []),
  ];
  return (
    <p className="notice">
      Codex: {parts.join(" and ")} from this chapter · <Link href={`/s/${storyId}/review?tab=codex&chapter=${chapterId}`}>Review</Link>
    </p>
  );
}
