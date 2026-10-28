"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AiRunProgress from "./AiRunProgress";
import { useWorkQueue } from "./WorkQueue";

type Props = {
  storyId: string;
  /** When the last review run on this story finished (ms), if one has. */
  lastFinished: number | null;
  /** A review run for this story that is not finished (found when the page loaded), shown instead of starting a new one. */
  unfinishedRunId?: string | null;
  /** Whether the story has tags switched on: only then is Find tags part of the check. */
  withTags: boolean;
};

/** The Overview tab's Check the whole story button: one review run with every check (tags, continuity, summaries). */
export default function StoryChecks({ storyId, lastFinished, unfinishedRunId = null, withTags }: Props) {
  const router = useRouter();
  const { startRun } = useWorkQueue();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(unfinishedRunId);
  const [runGoing, setRunGoing] = useState(unfinishedRunId !== null);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story_id: storyId,
          start_chapter_id: null,
          mode: "review",
          options: { tagScope: "story", checks: [...(withTags ? ["tags"] : []), "facts", "continuity", "summaries"] },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't start the run (${res.status})`);
      setRunId(data.id);
      setRunGoing(true);
      await startRun(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {/* The time is shown in the browser's own format, which can differ from the server's. */}
      <p className="meta" style={{ margin: 0 }} suppressHydrationWarning>
        {lastFinished ? `Last check finished ${new Date(lastFinished).toLocaleString()}.` : "No check has been run yet."}
      </p>
      <div className="row">
        <button type="button" className="secondary" onClick={start} disabled={starting || runGoing}>
          {starting || runGoing ? "Checking…" : "Check the whole story"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {runId && (
        <AiRunProgress
          key={runId}
          runId={runId}
          onFinished={() => {
            setRunGoing(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
