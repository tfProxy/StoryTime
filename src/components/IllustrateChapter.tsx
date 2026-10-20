"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import Prose from "./Prose";

const KEY = "storytime.illustrate.open";

// Which folds were left open, remembered in this browser only.
function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writeOpen(next: Record<string, boolean>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private window or blocked storage: the folds just start closed next time
  }
}

type Props = {
  chapterId: string;
  title: string;
  body: string;
  summary: string | null;
  /** What the story was before this chapter: the same text the picture prompt is written from. */
  earlier: string | null;
};

/** The chapter being illustrated, to check a picture against: its summary, with the full text and the story so far folded away. */
export default function IllustrateChapter({ chapterId, title, body, summary, earlier }: Props) {
  const box = useRef<HTMLElement>(null);
  // The folds are plain <details>; the saved state is applied after the first render so the server and browser agree on what to draw.
  useEffect(() => {
    const saved = readOpen();
    box.current?.querySelectorAll<HTMLDetailsElement>("details[data-fold]").forEach((d) => {
      d.open = Boolean(saved[d.dataset.fold!]);
    });
  }, []);
  const remember = () => {
    const now: Record<string, boolean> = {};
    box.current?.querySelectorAll<HTMLDetailsElement>("details[data-fold]").forEach((d) => {
      now[d.dataset.fold!] = d.open;
    });
    // keep what was saved for a fold this chapter doesn't have (the first chapter has no story so far)
    writeOpen({ ...readOpen(), ...now });
  };

  return (
    <aside ref={box} className="ai-panel illustrate-chapter" aria-label="The chapter">
      <h2>Chapter</h2>
      <p className="meta" style={{ margin: 0 }}>“{title}”</p>
      {summary ? (
        <p className="illustrate-summary">{summary}</p>
      ) : (
        <p className="meta" style={{ margin: 0 }}>
          No summary yet. <Link href={`/c/${chapterId}/summary`}>Write one</Link>, or read the whole chapter below.
        </p>
      )}
      <details className="illustrate-fold" data-fold="text" onToggle={remember}>
        <summary>Show the whole chapter</summary>
        <Prose text={body} />
      </details>
      {earlier && (
        <details className="illustrate-fold" data-fold="earlier" onToggle={remember}>
          <summary>Story so far</summary>
          <p className="illustrate-summary">{earlier}</p>
        </details>
      )}
    </aside>
  );
}
