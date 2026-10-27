"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiRun, SummaryTask } from "@/lib/aiRuns/types";
import AiRunProgress from "./AiRunProgress";
import { pathTo, subtreeOf } from "./TagScan";
import { useWorkQueue } from "./WorkQueue";

type Scope = "chapter" | "path" | "subtree" | "story";

type Props = {
  storyId: string;
  /** Every chapter, parents first. */
  chapters: { id: string; title: string; parent_id: string | null }[];
  /** The chapter named by ?chapter=, if any. */
  chapterId?: string;
  /** A summary check run for this story that is not finished (found when the page loaded), shown instead of starting a new one. */
  unfinishedRunId?: string | null;
};

/** The Check summaries button with its scope choices: starts a review run that reads each chapter with its summary. */
export default function SummaryCheck({ storyId, chapters, chapterId, unfinishedRunId = null }: Props) {
  const router = useRouter();
  const { startRun } = useWorkQueue();
  const [scope, setScope] = useState<Scope>(chapterId ? "chapter" : "story");
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(unfinishedRunId);
  const [runGoing, setRunGoing] = useState(unfinishedRunId !== null);

  const current = chapters.find((c) => c.id === chapterId);
  const wayHere = current ? pathTo(chapters, current.id) : [];
  const fromHere = current ? subtreeOf(chapters, current.id) : [];
  const counted = (n: number) => `${n} chapter${n === 1 ? "" : "s"}`;

  const finishedRun = useCallback(
    (run: AiRun) => {
      const tasks = run.tasks.filter((t): t is SummaryTask => t.kind === "summary");
      const failed = tasks.filter((t) => t.status === "failed").length;
      const found = tasks.filter((t) => (t.found ?? 0) > 0).length;
      setRunGoing(false);
      if (failed > 0) setMessage({ ok: false, text: `${failed} check${failed === 1 ? "" : "s"} could not be done. Try again from the run's list.` });
      else if (tasks.length === 0) setMessage({ ok: true, text: "Every summary in this scope has already been checked." });
      else setMessage({ ok: true, text: `Found ${found} summar${found === 1 ? "y" : "ies"} that ${found === 1 ? "doesn't" : "don't"} match.` });
      router.refresh();
    },
    [router],
  );

  async function start() {
    setMessage(null);
    setStarting(true);
    try {
      const res = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story_id: storyId,
          start_chapter_id: !current || scope === "story" ? null : current.id,
          mode: "review",
          options: { tagScope: !current ? "story" : scope, checks: ["summaries"] },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't start the run (${res.status})`);
      setRunId(data.id);
      setRunGoing(true);
      await startRun(data.id);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }

  const radio = (value: Scope, text: string) => (
    <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 400 }}>
      <input type="radio" name="summary-scope" checked={scope === value} onChange={() => setScope(value)} style={{ width: "auto" }} />
      {text}
    </label>
  );

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.25rem" }}>
        {current && radio("chapter", `This chapter (“${current.title}”)`)}
        {current && wayHere.length > 1 && radio("path", `The way here (${counted(wayHere.length)}, from the first chapter to this one)`)}
        {current && fromHere.length > 1 && radio("subtree", `From here on (${counted(fromHere.length)}, this one and every chapter after it)`)}
        {radio("story", `The whole story (${counted(chapters.length)})`)}
      </fieldset>
      <div className="row">
        <button type="button" onClick={start} disabled={starting || runGoing}>
          {starting || runGoing ? "Checking…" : "Check summaries"}
        </button>
      </div>
      <p className="meta">Reads each chapter and its summary, and says when they don&apos;t match. Uses your cheaper model.</p>
      {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
      {runId && <AiRunProgress key={runId} runId={runId} onFinished={finishedRun} />}
    </div>
  );
}
