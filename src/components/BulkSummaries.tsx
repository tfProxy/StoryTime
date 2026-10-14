"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSettings } from "@/lib/settings";
import { getEditKey } from "@/lib/keys";
import { summarizeChapter } from "@/lib/ai/summaries";
import type { StoryChapter } from "@/lib/tree";

type Props = {
  story: { title: string; premise: string };
  /** Parents before children. */
  chapters: StoryChapter[];
};

const subscribeNever = () => () => {};

/**
 * Redoes the summaries of a whole story, one chapter at a time from the first chapter down so each
 * chapter's story-so-far builds on its parent's new one. Chapters this browser posted are replaced;
 * for anyone else's chapters the server only accepts a summary where one is missing, so they are
 * filled in if empty and otherwise left as they are.
 */
export default function BulkSummaries({ story, chapters }: Props) {
  const settings = useSettings();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; current: string } | null>(null);
  const [result, setResult] = useState<{ replaced: number; filled: number; kept: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The edit keys live only in this browser, so these are 0 on the server and counted on the client.
  const mine = (id: string) => getEditKey(id) !== null;
  const ownedCount = useSyncExternalStore(subscribeNever, () => chapters.filter((c) => mine(c.id)).length, () => 0);
  const missingOthers = useSyncExternalStore(
    subscribeNever,
    () => chapters.filter((c) => !mine(c.id) && (!c.summary || !c.path_summary)).length,
    () => 0,
  );

  async function run() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setRunning(true);
    setError(null);
    setResult(null);
    const counts = { replaced: 0, filled: 0, kept: 0 };
    // Each chapter's story-so-far as it stands now, so children build on the new one.
    const pathSummary = new Map<string, string | null>();
    let done = 0;
    try {
      for (const c of chapters) {
        const previous = c.parent_id ? (pathSummary.get(c.parent_id) ?? null) : null;
        const key = getEditKey(c.id);
        const complete = !!c.summary && !!c.path_summary;
        if (!key && complete) {
          pathSummary.set(c.id, c.path_summary);
          counts.kept++;
          setProgress({ done: ++done, current: c.title });
          continue;
        }
        setProgress({ done, current: c.title });
        const s = await summarizeChapter(settings, { story, previous, chapter: c, signal: ctl.signal });
        const res = await fetch(`/api/chapters/${c.id}/summary`, {
          method: key ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(key ? { edit_key: key } : {}), revision: c.revision, summary: s.summary, path_summary: s.path_summary }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`“${c.title}”: ${data.error ?? `couldn't save (${res.status})`}`);
        // A fill only sets what was empty; whatever is stored now is what children should build on.
        pathSummary.set(c.id, key || !c.path_summary ? s.path_summary : c.path_summary);
        if (key) counts.replaced++;
        else counts.filled++;
        setProgress({ done: ++done, current: c.title });
      }
      setResult(counts);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
      // Whatever finished is already saved.
      setResult(counts);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div>
      <p>
        This story has <strong>{chapters.length}</strong> chapter{chapters.length === 1 ? "" : "s"}.{" "}
        {ownedCount > 0 ? (
          <>
            This browser posted <strong>{ownedCount}</strong> of them, and those will be rewritten.
          </>
        ) : (
          "This browser didn't post any of them, so nothing can be rewritten."
        )}{" "}
        {chapters.length - ownedCount > 0 && (
          <>
            For the other {chapters.length - ownedCount}, only a missing summary can be filled in
            {missingOthers > 0 ? ` (${missingOthers} ${missingOthers === 1 ? "is" : "are"} missing one)` : " (none are missing one)"}; existing
            ones stay as they are.
          </>
        )}
      </p>
      <p className="meta">
        This makes one request to your summary model for each chapter it changes, with your own AI settings
        (<Link href="/settings">Settings</Link>), so a long story can take a while. If you stop it, the chapters already
        done stay done.
      </p>
      <div className="row">
        <button type="button" onClick={run} disabled={running || (ownedCount === 0 && missingOthers === 0)}>
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
      {result && !running && (
        <p className="notice" aria-live="polite">
          {result.replaced} rewritten, {result.filled} filled in, {result.kept} left as they were.
        </p>
      )}
    </div>
  );
}
