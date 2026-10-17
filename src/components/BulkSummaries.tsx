"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useSettings } from "@/lib/settings";
import { summarizeChapter } from "@/lib/ai/summaries";
import type { StoryChapter } from "@/lib/tree";

type Props = {
  story: { title: string; premise: string };
  /** Parents before children. */
  chapters: StoryChapter[];
};

/**
 * Redoes the summaries of a whole story, one chapter at a time from the first chapter down so each
 * chapter's story-so-far builds on its parent's new one.
 */
export default function BulkSummaries({ story, chapters }: Props) {
  const settings = useSettings();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; current: string } | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setRunning(true);
    setError(null);
    setResult(null);
    // Each chapter's story-so-far as it stands now, so children build on the new one.
    const pathSummary = new Map<string, string | null>();
    let done = 0;
    try {
      for (const c of chapters) {
        const previous = c.parent_id ? (pathSummary.get(c.parent_id) ?? null) : null;
        setProgress({ done, current: c.title });
        const s = await summarizeChapter(settings, { story, previous, chapter: c, signal: ctl.signal });
        const res = await fetch(`/api/chapters/${c.id}/summary`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: c.revision, summary: s.summary, path_summary: s.path_summary }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`“${c.title}”: ${data.error ?? `couldn't save (${res.status})`}`);
        pathSummary.set(c.id, s.path_summary);
        setProgress({ done: ++done, current: c.title });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      // Whatever finished is already saved.
      setResult(done);
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div>
      <p>
        This story has <strong>{chapters.length}</strong> chapter{chapters.length === 1 ? "" : "s"}. Every one of them
        will get a new summary.
      </p>
      <p className="meta">
        This makes one request to your summary model for each chapter, with your own AI settings (
        <Link href="/settings">Settings</Link>), so a long story can take a while. If you stop it, the chapters already
        done stay done.
      </p>
      <div className="row">
        <button type="button" onClick={run} disabled={running}>
          {running ? "Working…" : "Redo summaries"}
        </button>
        {running && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
      </div>
      {progress && (
        <p className="meta" aria-live="polite">
          {progress.done} of {chapters.length} done. Now: {progress.current}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {result !== null && !running && (
        <p className="notice" aria-live="polite">
          {result} rewritten.
        </p>
      )}
    </div>
  );
}
