"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AiRun, SummaryTask } from "@/lib/aiRuns/types";
import AiRunProgress from "./AiRunProgress";
import { useWorkQueue } from "./WorkQueue";

/**
 * The AI check of whether summaries match their chapters: a review run that reads each chapter with its summary (the
 * cheaper model). `check()` starts it for the chapter, or for the whole story when there is none; `view` is the
 * message and the run's progress, to draw where it should show. Used by the Summaries section's ▾ menus.
 */
export function useSummaryCheck(storyId: string, chapterId: string | null, unfinishedRunId: string | null = null) {
  const router = useRouter();
  const { startRun } = useWorkQueue();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(unfinishedRunId);
  const [going, setGoing] = useState(unfinishedRunId !== null);

  const finishedRun = useCallback(
    (run: AiRun) => {
      const tasks = run.tasks.filter((t): t is SummaryTask => t.kind === "summary");
      const failed = tasks.filter((t) => t.status === "failed").length;
      const found = tasks.filter((t) => (t.found ?? 0) > 0).length;
      setGoing(false);
      if (failed > 0) setMessage({ ok: false, text: `${failed} check${failed === 1 ? "" : "s"} could not be done. Try again from the run's list.` });
      else if (tasks.length === 0) setMessage({ ok: true, text: "Every summary in this scope has already been checked." });
      else setMessage({ ok: true, text: found === 0 ? "Every summary matches its chapter." : `Found ${found} summar${found === 1 ? "y" : "ies"} that ${found === 1 ? "doesn't" : "don't"} match.` });
      router.refresh();
    },
    [router],
  );

  async function check() {
    setMessage(null);
    setStarting(true);
    try {
      const res = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story_id: storyId,
          start_chapter_id: chapterId,
          mode: "review",
          options: { tagScope: chapterId ? "chapter" : "story", checks: ["summaries"] },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't start the run (${res.status})`);
      setRunId(data.id);
      setGoing(true);
      await startRun(data.id);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }

  const view: ReactNode = (
    <>
      {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
      {runId && <AiRunProgress key={runId} runId={runId} onFinished={finishedRun} />}
    </>
  );
  return { check, busy: starting || going, view };
}
