"use client";

// A run in progress (or finished): what it has written, what it is doing now, Stop / Resume, the task list with
// retry and skip, the plan check (D23) and the end summary. It follows the queue's item for the run when this tab
// has it, and the run as saved on the server otherwise (a run going in another tab, or one found after a reload).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRun } from "@/lib/aiRuns/api";
import type { RunEvent } from "@/lib/aiRuns/runner";
import type { AiRun, FactsTask, PictureTask, TagsTask, WriteTask } from "@/lib/aiRuns/types";
import { useWorkQueue, type RunItem } from "./WorkQueue";

const plainFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init);
const POLL_MS = 3000;

const STATUS_WORDS: Record<string, string> = { todo: "to do", written: "written, finishing", done: "done", failed: "failed", skipped: "skipped" };

type Edit = { label?: string; direction?: string; remove?: boolean };

export default function AiRunProgress({
  runId,
  chapterId,
  backHref,
  backLabel,
  onFinished,
}: {
  runId: string;
  chapterId?: string;
  backHref?: string;
  backLabel?: string;
  /** Called once when the run is seen finished (done or stopped for good). */
  onFinished?: (run: AiRun) => void;
}) {
  const { items, stopRun, startRun, listenRun } = useWorkQueue();
  const [run, setRun] = useState<AiRun | null>(null);
  const finishedRef = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState("");
  const [marked, setMarked] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState(false);
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

  const runEnded = run?.status === "done" || run?.status === "stopped";
  useEffect(() => {
    if (!run || !runEnded || finishedRef.current) return;
    finishedRef.current = true;
    onFinished?.(run);
  }, [run, runEnded, onFinished]);

  if (!run) return <p className="meta">{problem ?? "Loading the run…"}</p>;

  const isPictures = run.mode === "pictures";
  const isTags = run.mode === "review";
  // A review run's tasks: the chapters read for tags and for facts.
  const tagTasks = run.tasks.filter((t): t is TagsTask | FactsTask => t.kind === "tags" || t.kind === "facts");
  const hasFacts = tagTasks.some((t) => t.kind === "facts");
  const pics = run.tasks.filter((t): t is PictureTask => t.kind === "picture");
  const writes = run.tasks.filter((t): t is WriteTask => t.kind === "write");
  // Chapters posted (waiting for their summaries counts), or pictures saved.
  const done = isTags
    ? tagTasks.filter((t) => t.status === "done").length
    : isPictures ? pics.filter((t) => t.status === "done").length : writes.filter((t) => t.status === "done" || t.status === "written").length;
  const total = isTags ? tagTasks.length : isPictures ? pics.length : writes.length;
  const failedPlans = run.tasks.filter((t) => t.kind === "plan" && t.status === "failed");
  const finished = run.status === "done" || run.status === "stopped";
  const goingHere = item?.state === "working" || item?.state === "waiting";
  const canResume = !finished && !goingHere && (run.status !== "review");
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

  /** Try again or skip a task: the server does it with its own hold on the run (and waits for a step that is going). */
  async function taskAction(taskId: string, action: "retry" | "skip") {
    const res = await fetch(`/api/ai-runs/${runId}/task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, action }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Couldn't do that (${res.status})`);
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
    : item?.state === "waiting" ? `Waiting its turn${others > 0 ? ` (${others} ahead)` : ""}.`
    : item?.state === "working" ? (status || "Working…")
    : inReview ? "Plan ready to check."
    : run.status === "paused" || item?.state === "paused" || item?.state === "failed" ? "Paused." : "Not started.";

  return (
    <section className="ai-run" aria-label="Run progress">
      <h2>
        {isTags
          ? total === 0 ? "No chapters to read" : hasFacts ? `Did ${done} of ${total} ${total === 1 ? "check" : "checks"}` : `Read ${done} of ${total} ${total === 1 ? "chapter" : "chapters"}`
          : <>{done} of {total} {isPictures ? "pictures made" : "written"}{item?.state === "working" && item.current ? <>. Now: {isPictures ? item.current : <>“{item.current}”</>}</> : null}</>}
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

      {finished && isPictures && (
        <div className="ai-run-done">
          <p>
            {run.status === "done" ? `Made ${done} ${done === 1 ? "picture" : "pictures"}, saved as the chapters' pictures.` : `Stopped after ${done} of ${total}; the pictures made are saved.`} ·{" "}
            <Link href={`/s/${run.story_id}/outline`}>Open in outline</Link>
          </p>
        </div>
      )}
      {finished && !isPictures && !isTags && (
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
            · <Link href={`/s/${run.story_id}/outline`}>Open in outline</Link> · <Link href={`/s/${run.story_id}/pictures?run=${runId}`}>Make pictures for these chapters</Link>
          </p>
          <p className="meta">The codex isn&apos;t updated by a run. Add what changed from the codex panel on each chapter.</p>
        </div>
      )}

      <h3>{isPictures ? "Pictures" : "Chapters"}</h3>
      <ol className="ai-run-tasks">
        {tagTasks.map((t) => (
          <li key={t.id} className={`ai-run-task ai-run-task-${t.status}`}>
            <div>
              <Link href={`/c/${t.chapterId}`}>{t.label ?? "A chapter"}</Link> <span className="meta">· {t.kind === "facts" ? "Facts: " : ""}{STATUS_WORDS[t.status]}{t.status === "done" && t.found ? (t.kind === "facts" ? `, ${t.found} fact${t.found === 1 ? "" : "s"}` : `, ${t.found} new suggestion${t.found === 1 ? "" : "s"}`) : ""}</span>
            </div>
            {t.status === "failed" && (
              <>
                <p className="error">{t.error}</p>
                <div className="row" style={{ gap: "0.75rem" }}>
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(async () => { await taskAction(t.id, "retry"); await startRun(runId); })}>Try again</button>
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(() => taskAction(t.id, "skip"))}>Skip</button>
                </div>
              </>
            )}
            {t.status === "skipped" && t.error && <div className="meta">{t.error}</div>}
          </li>
        ))}
        {pics.map((t) => (
          <li key={t.id} className={`ai-run-task ai-run-task-${t.status}`}>
            <div>
              <Link href={`/c/${t.chapterId}/illustrate`}>{t.label ?? "A chapter"}</Link> <span className="meta">· {t.slot} · {t.status === "written" ? "prompt written, drawing" : STATUS_WORDS[t.status]}</span>
            </div>
            {t.status === "done" && (
              <Link href={`/c/${t.chapterId}/illustrate`} className="picture-queue-thumbs" aria-label={`The ${t.slot} picture of “${t.label ?? "the chapter"}”`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by StoryTime */}
                <img src={`/api/chapters/${t.chapterId}/images/${t.slot}${run.updated_at ? `?v=${run.updated_at}` : ""}`} alt="" loading="lazy" />
              </Link>
            )}
            {t.status === "failed" && (
              <>
                <p className="error">{t.error}</p>
                <div className="row" style={{ gap: "0.75rem" }}>
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(async () => { await taskAction(t.id, "retry"); await startRun(runId); })}>Try again</button>
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(() => taskAction(t.id, "skip"))}>Skip</button>
                </div>
              </>
            )}
            {t.status === "skipped" && t.error && <div className="meta">{t.error}</div>}
          </li>
        ))}
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
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(async () => { await taskAction(t.id, "retry"); await startRun(runId); })}>Try again</button>
                  <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(() => taskAction(t.id, "skip"))}>Skip</button>
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
              <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(async () => { await taskAction(t.id, "retry"); await startRun(runId); })}>Try again</button>
              <button type="button" className="picture-queue-text-button" disabled={busy || goingHere} onClick={() => void act(() => taskAction(t.id, "skip"))}>Skip</button>
            </div>
          </li>
        ))}
      </ol>
      <p className="meta">This runs on the StoryTime server: you can close this page and come back later.</p>
      {!isTags && (
        <p>
          <Link href={backHref ?? `/c/${chapterId}`}>{backLabel ?? "Back to the chapter"}</Link>
        </p>
      )}
    </section>
  );
}
