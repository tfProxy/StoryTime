"use client";

import { useState } from "react";
import type { AiRun, CodexTask } from "@/lib/aiRuns/types";
import type { CodexEntry } from "@/lib/codex";
import { chaptersSinceChange } from "@/lib/codexHints";
import AiRunProgress from "./AiRunProgress";
import { INBOX_CHANGED } from "./CodexInbox";

/**
 * "Update from the story" on an entry's page: the AI reads the chapters on the way here that name the entry since its last
 * change, for that entry's changes alone, and leaves them as suggested facts below (each dated to the chapter it read).
 * `changes`: the chapters on the path where the entry changed.
 */
export default function UpdateFromStory({
  storyId,
  chapterId,
  entry,
  path,
  changes,
}: {
  storyId: string;
  chapterId: string;
  entry: CodexEntry;
  path: { id: string; title: string; body: string }[];
  changes: Set<string>;
}) {
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const since = chaptersSinceChange(path, { who: entry, changes });

  async function start() {
    setMessage(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/stories/${storyId}/update-entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter_id: chapterId, entry_id: entry.entry_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't start (${res.status})`);
      setRunId(data.run_id);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }

  function finished(run: AiRun) {
    const tasks = run.tasks.filter((t): t is CodexTask => t.kind === "codex");
    const failed = tasks.filter((t) => t.status === "failed").length;
    const found = tasks.reduce((sum, t) => sum + (t.found ?? 0), 0);
    setRunId(null);
    const got = found === 0 ? `The AI found nothing to change in ${entry.name}.` : `The AI suggested ${found} change${found === 1 ? "" : "s"}: see Suggested facts below.`;
    if (failed === tasks.length) setMessage({ ok: false, text: "The AI couldn't read the chapters. Try again." });
    else setMessage({ ok: failed === 0, text: failed ? `${got} ${failed} chapter${failed === 1 ? "" : "s"} couldn't be read.` : got });
    window.dispatchEvent(new Event(INBOX_CHANGED));
  }

  const names = since.map((c) => `“${c.title}”`);
  const listed = names.length > 4 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  return (
    <div className="update-from-story">
      {since.length === 0 ? (
        <p className="meta">No chapter on the way here names {entry.name} since it last changed, so there is nothing to read.</p>
      ) : (
        <p className="meta">
          {since.length === 1 ? "1 chapter names" : `${since.length} chapters name`} {entry.name} since it last changed: {listed}. The AI reads{" "}
          {since.length === 1 ? "it" : "them"} for changes to {entry.name} and suggests facts; nothing changes until you accept them.
        </p>
      )}
      {!runId && since.length > 0 && (
        <button type="button" className="secondary" disabled={starting} onClick={() => void start()} aria-label={`Update ${entry.name} from the story`}>
          {starting ? "Starting…" : "Update from the story"}
        </button>
      )}
      {runId && <AiRunProgress key={runId} runId={runId} onFinished={finished} />}
      {message && (
        <p className={message.ok ? "ok" : "error"} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
