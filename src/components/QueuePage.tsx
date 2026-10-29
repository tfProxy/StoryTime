"use client";

// The queue page (/queue): what the work queue is doing, in the order it will do it. Built from the queue's own
// state, so it shows this tab's work; History is read from the server's job log.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import { imageUrl } from "@/lib/comfy/client";
import type { PictureJob } from "@/lib/pictureJobs";
import { targetHref, targetKey, targetOfIds } from "@/lib/pictureTarget";
import { useWorkQueue, usePictureQueue, type GenerateItem, type QueueJob, type RunItem } from "./WorkQueue";
import { GenerateRow, JobRow, MOMENTS, RunRow, pictures, useLabels, type Labels } from "./WorkQueueStatus";

const HISTORY_PAGE = 20;

const titleOf = (job: { kind: QueueJob["kind"] }, label?: Labels[string]) =>
  job.kind === "cover" ? "Cover" : (label?.title ?? (job.kind === "codex" ? "A codex entry" : "A chapter"));

export default function QueuePage() {
  const { jobs, stop, dismiss } = usePictureQueue();
  const { waiting, paused, setPaused, move, items, stopRun, resumeRun, stopGenerate, machine } = useWorkQueue();
  const comfyUrl = useSettings().comfy.url;

  const [history, setHistory] = useState<PictureJob[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  /** One page of the log, newest first; `before` is the cursor of the page already shown. */
  const fetchHistory = useCallback(
    (before: number | null) =>
      fetch(`/api/picture-jobs?recent=1&limit=${HISTORY_PAGE}${before ? `&before=${before}` : ""}`, { cache: "no-store" }).then(async (res) => {
        if (!res.ok) throw new Error(`The history couldn't be loaded (${res.status})`);
        return (await res.json()) as { jobs: PictureJob[]; next: number | null };
      }),
    [],
  );
  const showPage = useCallback((page: { jobs: PictureJob[]; next: number | null }, more: boolean) => {
    setHistory((prev) => (more ? [...prev, ...page.jobs] : page.jobs));
    setNext(page.next);
    setHistoryError(null);
    setLoaded(true);
  }, []);
  const failedHistory = useCallback((e: unknown) => {
    setHistoryError(e instanceof Error ? e.message : String(e));
    setLoaded(true);
  }, []);
  useEffect(() => {
    let live = true;
    fetchHistory(null).then((page) => live && showPage(page, false), (e) => live && failedHistory(e));
    return () => {
      live = false;
    };
  }, [fetchHistory, showPage, failedHistory]);

  const historyTargets = history.map((j) => targetOfIds(j.story_id, j.chapter_id, j.entry_id));
  const labels = useLabels([...jobs, ...historyTargets]);

  const byKey = new Map(jobs.map((j) => [j.key, j]));
  const waitingJobs = waiting.map((k) => byKey.get(k)).filter((j): j is QueueJob => !!j && j.state === "making");
  const waitingKeys = new Set(waitingJobs.map((j) => j.key));
  // Still gathering quick clicks: not sent yet either, but they can't be moved until the clicks stop.
  const gathering = jobs.filter((j) => j.state === "making" && !waitingKeys.has(j.key) && j.progress.stage === "gathering");
  const gatheringKeys = new Set(gathering.map((j) => j.key));
  const working = jobs.filter((j) => j.state === "making" && !waitingKeys.has(j.key) && !gatheringKeys.has(j.key));
  const done = jobs.filter((j) => j.state === "done");
  const failed = jobs.filter((j) => j.state === "failed");

  const runs = items.filter((i): i is RunItem => i.type === "run").sort((a, b) => b.addedAt - a.addedAt);
  const runsWorking = runs.filter((r) => r.state === "working");
  const runsWaiting = runs.filter((r) => r.state === "waiting");
  const runsPaused = runs.filter((r) => r.state === "paused");
  const runsDone = runs.filter((r) => r.state === "done");
  const runsFailed = runs.filter((r) => r.state === "failed");
  const gens = items.filter((i): i is GenerateItem => i.type === "generate").sort((a, b) => b.addedAt - a.addedAt);
  const genRow = (g: GenerateItem) => <GenerateRow key={g.key} item={g} onStop={() => stopGenerate(g.draftKey)} onDismiss={() => dismiss(g.key)} />;
  const gensWorking = gens.filter((g) => g.state === "working");
  const gensWaiting = gens.filter((g) => g.state === "waiting");
  const gensDone = gens.filter((g) => g.state === "done");
  const gensFailed = gens.filter((g) => g.state === "failed");
  const runRow = (r: RunItem) => <RunRow key={r.key} run={r} onStop={() => stopRun(r.runId)} onResume={() => void resumeRun(r.runId)} onDismiss={() => dismiss(r.key)} />;

  const row = (j: QueueJob, extra?: React.ReactNode, note?: string) => (
    <JobRow key={j.key} job={j} label={labels[targetKey(j)]} comfyUrl={comfyUrl} onStop={() => stop(j.key)} onDismiss={() => dismiss(j.key)} note={note} extra={extra} />
  );

  return (
    <>
      <h1>Queue</h1>
      <p className="meta">
        {machine.holder?.kind === "writing" ? "Writing has the machine." : "Pictures have the machine."} What is being made and what waits, in the order it will go.
      </p>

      <div className="row" style={{ alignItems: "center" }}>
        <button type="button" className={paused ? "" : "secondary"} onClick={() => setPaused(!paused)}>
          {paused ? "Resume queue" : "Pause queue"}
        </button>
        <span className="meta">
          {paused ? "Paused: nothing new is sent, and what is running finishes." : "Pausing holds new jobs here; what is running finishes."} Kept in this
          browser, so a reload stays paused.
        </span>
      </div>

      <section aria-label="Working">
        <h2>Working</h2>
        {working.length + runsWorking.length + gensWorking.length === 0 ? (
          <p className="meta">Nothing is being made.</p>
        ) : (
          <>
            {working.length > 0 && <p className="meta">ComfyUI has these jobs, so they can&apos;t be moved.</p>}
            <ul className="queue-page-list">
              {gensWorking.map(genRow)}
              {runsWorking.map(runRow)}
              {working.map((j) => row(j))}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Waiting">
        <h2>Waiting</h2>
        {waitingJobs.length + gathering.length + runsWaiting.length + gensWaiting.length === 0 ? (
          <p className="meta">Nothing is waiting.</p>
        ) : (
          <ul className="queue-page-list">
            {gensWaiting.map(genRow)}
            {runsWaiting.map(runRow)}
            {waitingJobs.map((j, i) =>
              row(
                j,
                <div className="row" style={{ gap: "0.75rem" }}>
                  <button type="button" className="picture-queue-text-button" disabled={i === 0} onClick={() => move(j.key, "up")}>
                    Move up
                  </button>
                  <button type="button" className="picture-queue-text-button" disabled={i === waitingJobs.length - 1} onClick={() => move(j.key, "down")}>
                    Move down
                  </button>
                  <button type="button" className="picture-queue-text-button" disabled={i === 0} onClick={() => move(j.key, "next")}>
                    Do next
                  </button>
                </div>,
                paused ? "Held while the queue is paused" : "Waiting to be sent",
              ),
            )}
            {gathering.map((j) => row(j, undefined, "Still gathering clicks, then it can be moved"))}
          </ul>
        )}
      </section>

      <section aria-label="Finished">
        <h2>Finished</h2>
        {done.length + runsDone.length + gensDone.length === 0 ? (
          <p className="meta">Nothing has finished lately.</p>
        ) : (
          <ul className="queue-page-list">
            {gensDone.map(genRow)}
            {runsDone.map(runRow)}
            {done.map((j) => row(j))}
          </ul>
        )}
        {done.length + failed.length + runsDone.length + runsFailed.length + gensDone.length + gensFailed.length > 1 && (
          <button type="button" className="secondary" onClick={() => [...done, ...failed, ...runsDone, ...runsFailed, ...gensDone, ...gensFailed].forEach((j) => dismiss(j.key))}>
            Clear finished
          </button>
        )}
      </section>

      {runsPaused.length > 0 && (
        <section aria-label="Paused">
          <h2>Paused</h2>
          <p className="meta">Runs that stopped, or are going in another tab or browser. Nothing starts by itself: Resume puts one back in line.</p>
          <ul className="queue-page-list">{runsPaused.map(runRow)}</ul>
        </section>
      )}

      <section aria-label="Failed">
        <h2>Failed</h2>
        {failed.length + runsFailed.length + gensFailed.length === 0 ? (
          <p className="meta">Nothing has failed.</p>
        ) : (
          <ul className="queue-page-list">
            {gensFailed.map(genRow)}
            {runsFailed.map(runRow)}
            {failed.map((j) => row(j))}
          </ul>
        )}
      </section>

      <section aria-label="History">
        <h2>History</h2>
        <p className="meta">Pictures made earlier, kept on the server, newest first.</p>
        {historyError && <p className="error">{historyError}</p>}
        {loaded && history.length === 0 && !historyError && <p className="meta">No pictures have been made yet.</p>}
        <ul className="queue-page-list">
          {history.map((j) => {
            const target = targetOfIds(j.story_id, j.chapter_id, j.entry_id);
            const label = labels[targetKey(target)];
            const title = titleOf(target, label);
            const first = j.images[0];
            return (
              <li key={j.id} className="picture-queue-job" aria-label={`${title}: made ${new Date(j.created_at).toLocaleString()}`}>
                <div className="picture-queue-head">
                  <Link href={targetHref(target)}>{title}</Link>
                  <span className="meta">
                    {label?.story_title ? `${label.story_title} · ` : ""}
                    {j.moment === "start" || j.moment === "middle" || j.moment === "end" ? `${MOMENTS[j.moment]} · ` : ""}
                    {pictures(j.images.length)} · {new Date(j.created_at).toLocaleString()}
                  </span>
                </div>
                {first && (
                  <Link href={targetHref(target)} className="picture-queue-thumbs" aria-label={`Open “${title}”`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI */}
                    <img src={imageUrl(comfyUrl, first)} alt="" loading="lazy" style={{ aspectRatio: `${j.width} / ${j.height}` }} />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        {next !== null && (
          <button type="button" className="secondary" onClick={() => fetchHistory(next).then((page) => showPage(page, true), failedHistory)}>
            Show more
          </button>
        )}
      </section>
    </>
  );
}
