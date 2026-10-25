"use client";

// A run in progress (or finished): what it has written, what it is doing now, Stop / Resume, the task list with
// retry and skip, the plan check (D23) and the end summary. It follows the queue's item for the run when this tab
// has it, and the run as saved on the server otherwise (a run going in another tab, or one found after a reload).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getRun } from "@/lib/aiRuns/api";
import { retryTask, skipTask, type RunEvent } from "@/lib/aiRuns/runner";
import type { AiRun, WriteTask } from "@/lib/aiRuns/types";
import { useWorkQueue, type RunItem } from "./WorkQueue";

const plainFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init);
const POLL_MS = 3000;

const STATUS_WORDS: Record<string, string> = { todo: "to do", written: "written, finishing", done: "done", failed: "failed", skipped: "skipped" };

type Edit = { label?: string; direction?: string; remove?: boolean };

export default function AiRunProgress({ runId, chapterId }: { runId: string; chapterId: string }) {
  const { items, stopRun, startRun, listenRun } = useWorkQueue();
  const [run, setRun] = useState<AiRun | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState("");
  const [marked, setMarked] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState(false);
  const [token] = useState(() => `page-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const item = items.find((i): i is RunItem => i.type === "run" && i.runId === runId);
  const others = items.filter((i) => i.type === "run" && i.runId !== runId && (i.state === "working" || i.state === "waiting")).length;

  const reload = useCallback(
    () => getRun(plainFetch, runId).then((r) => { setRun(r); setProblem(null); }, (e) => setProblem(e instanceof Error ? e.message : String(e))),
    [runId],
  );
  // Loaded when the page opens, and again every few seconds unless this tab is the one working (it is told instead).
  useEffect(() => {
    void reload();
  }, [reload]);
  const working = item?.state === "working";
  useEffect(() => {
    if (working) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [working, reload]);

  useEffect(
    () =>
      listenRun(runId, {
        onRun: (r) => setRun(r),
        onEvent: (e: RunEvent) => {
          if (e.type === "task") { setLive(""); setStatus(e.phase === "writing" ? "Writing…" : e.phase === "planning" ? "Planning what happens next…" : "Summarizing and planning choices…"); }
          else if (e.type === "text") setLive(e.text);
          else if (e.type === "status") setStatus(e.text);
          else if (e.type === "taskDone") setStatus("");
          else if (e.type === "error") setStatus(e.message);
        },
      }),
    [runId, listenRun],
  );

  if (!run) return <p className="meta">{problem ?? "Loading the run…"}</p>;

  const writes = run.tasks.filter((t): t is WriteTask => t.kind === "write");
  const done = writes.filter((t) => t.status === "done" || t.status === "written").length;
  const failedPlans = run.tasks.filter((t) => t.kind === "plan" && t.status === "failed");
  const elsewhere = item?.state === "elsewhere" || (!item && run.leased);
  const finished = run.status === "done" || run.status === "stopped";
  const goingHere = item?.state === "working" || item?.state === "waiting";
  const canResume = !finished && !elsewhere && !goingHere && (run.status !== "review");
  const inReview = run.status === "review" && run.review_depth !== null;
  const reviewTasks = inReview ? writes.filter((t) => t.status === "todo" && t.depth === run.review_depth) : [];
  const edited = (t: WriteTask) => ({ label: edits[t.id]?.label ?? t.label, direction: edits[t.id]?.direction ?? t.direction, remove: edits[t.id]?.remove ?? false });

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function continueAfterReview() {
    await act(async () => {
      const changes = reviewTasks
        .map((t) => ({ t, e: edited(t) }))
        .filter(({ t, e }) => e.remove || e.label !== t.label || e.direction !== t.direction)
        .map(({ t, e }) => ({ id: t.id, ...(e.remove ? { remove: true } : { label: e.label.trim() || t.label, direction: e.direction })}));
      const res = await fetch(`/api/ai-runs/${runId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: run!.version, tasks: changes }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't continue (${res.status})`);
      setEdits({});
      await startRun(runId);
    });
  }

  const stateLine = finished
    ? run.status === "stopped" ? "Stopped." : "Finished."
    : elsewhere ? "Running in another tab or browser. Open this page there, or wait for it to finish."
    : item?.state === "waiting" ? `Waiting its turn${others > 0 ? ` (${others} ahead)` : ""}.`
    : item?.state === "working" ? (status || "Working…")
    : inReview ? "Plan ready to check."
    : run.status === "paused" || item?.state === "paused" || item?.state === "failed" ? "Paused." : "Not started.";

  return (
    <section className="ai-run" aria-label="Run progress">
      <h2>
        {done} of {writes.length} written{item?.state === "working" && item.current ? <>. Now: “{item.current}”</> : null}
      </h2>
      <p aria-live="polite">{stateLine}</p>
      {(run.error || item?.error) && !finished && <p className="error">{item?.error ?? run.error}</p>}
      {problem && <p className="error">{problem}</p>}

      <div className="row" style={{ alignItems: "center" }}>
        {goingHere && <button type="button" className="secondary" onClick={() => stopRun(runId)}>Stop</button>}
        {canResume && <button type="button" disabled={busy} onClick={() => void act(() => startRun(runId))}>{run.status === "ready" ? "Start" : "Resume"}</button>}
      </div>

      {item?.state === "working" && (
        <details className="ai-run-live">
          <summary>Watch it write</summary>
          <pre>{live || "Waiting for the model…"}</pre>
        </details>
      )}

      {inReview && (
        <section className="ai-run-review" aria-label="Check the plan">
          <h3>The plan for the next {reviewTasks.length} {reviewTasks.length === 1 ? "chapter" : "chapters"} is ready</h3>
          <p className="meta">Change what you like. The AI writes each chapter from its “what happens”. ✕ leaves a chapter out.</p>
          <ul className="queue-page-list">
            {reviewTasks.map((t) => {
              const e = edited(t);
              return (
                <li key={t.id} className="picture-queue-job" style={e.remove ? { opacity: 0.55 } : undefined}>
                  <label>
                    Choice text
                    <input value={e.label} disabled={e.remove} maxLength={200} onChange={(ev) => setEdits((p) => ({ ...p, [t.id]: { ...p[t.id], label: ev.target.value } }))} />
                  </label>
                  <label>
                    What happens
                    <textarea rows={3} value={e.direction} disabled={e.remove} onChange={(ev) => setEdits((p) => ({ ...p, [t.id]: { ...p[t.id], direction: ev.target.value } }))} />
                  </label>
                  <button type="button" className="picture-queue-text-button" aria-label={`${e.remove ? "Put back" : "Leave out"} “${t.label}”`} onClick={() => setEdits((p) => ({ ...p, [t.id]: { ...p[t.id], remove: !e.remove } }))}>
                    {e.remove ? "Put back" : "✕ Leave out"}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" disabled={busy} onClick={() => void continueAfterReview()}>Continue</button>
        </section>
      )}

      {finished && (
        <div className="ai-run-done">
          <p>
            {run.status === "done" ? `Wrote ${done} ${done === 1 ? "chapter" : "chapters"}, marked not reviewed.` : `Stopped after ${done} of ${writes.length}; what was written is marked not reviewed.`}{" "}
            {marked === null ? (
              <button type="button" className="picture-queue-text-button" disabled={busy || done === 0} onClick={() => void act(async () => {
                const res = await fetch(`/api/ai-runs/${runId}/reviewed`, { method: "POST" });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error ?? `Couldn't mark them (${res.status})`);
                setMarked(data.marked);
              })}>
                Mark all reviewed
              </button>
            ) : (
              <span>Marked {marked} reviewed.</span>
            )}{" "}
            · <Link href={`/s/${run.story_id}/outline`}>Open in outline</Link>
          </p>
          <p className="meta">The codex isn&apos;t updated by a run. Add what changed from the codex panel on each chapter.</p>
        </div>
      )}

      <h3>Chapters</h3>
      <ol className="ai-run-tasks">
        {writes.map((t) => (
          <li key={t.id} className={`ai-run-task ai-run-task-${t.status}`}>
            <div>
              {t.chapterId ? <Link href={`/c/${t.chapterId}`}>{t.label}</Link> : <span>{t.label}</span>} <span className="meta">· {STATUS_WORDS[t.status]}</span>
            </div>
            {t.direction && <div className="meta">{t.direction}</div>}
            {t.status === "failed" && (
              <>
                <p className="error">{t.error}</p>
                <div className="row" style={{ gap: "0.75rem" }}>
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(async () => { await retryTask(runId, t.id, token); await startRun(runId); })}>Try again</button>
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(() => skipTask(runId, t.id, token))}>Skip</button>
                </div>
              </>
            )}
            {t.status === "skipped" && t.error && <div className="meta">{t.error}</div>}
          </li>
        ))}
        {failedPlans.map((t) => (
          <li key={t.id} className="ai-run-task ai-run-task-failed">
            <div>Planning the choices of this chapter <span className="meta">· failed</span></div>
            <p className="error">{t.error}</p>
            <div className="row" style={{ gap: "0.75rem" }}>
              <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(async () => { await retryTask(runId, t.id, token); await startRun(runId); })}>Try again</button>
              <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(() => skipTask(runId, t.id, token))}>Skip</button>
            </div>
          </li>
        ))}
      </ol>
      <p className="meta">
        This runs in this browser tab: you can use other pages of StoryTime meanwhile, but keep the tab open. On a phone, keep the screen on.
      </p>
      <p>
        <Link href={`/c/${chapterId}`}>Back to the chapter</Link>
      </p>
    </section>
  );
}
