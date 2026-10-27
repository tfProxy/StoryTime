"use client";

// The picture queue in the header: a button that shows how many jobs are being made and how many have
// finished since their page was last open, and a list of them, each with a link to its chapter's
// Illustrate page (or the story's cover page). Hidden when there are none. It also puts the number of jobs being made
// in the tab's title ("StoryTime (2)").
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/lib/settings";
import { imageUrl } from "@/lib/comfy/client";
import { chapterTarget, codexTarget, coverTarget, targetHref, targetKey, type PictureTarget } from "@/lib/pictureTarget";
import { progressText } from "./pictures";
import { machineNote } from "@/lib/workQueue/schedule";
import { copyText } from "@/lib/copyText";
import { usePictureQueue, useWorkQueue, type GenerateItem, type QueueJob, type RunItem } from "./WorkQueue";

/** The kinds of AI run, in words. */
export const MODE_WORDS = { fill: "Fill open choices", tree: "Grow the tree", arc: "Reach a goal", pictures: "Fill missing pictures", review: "Find tags" } as const;

/** Where a run's page is (the page that shows its tasks, review and results). */
export const runHref = (run: Pick<RunItem, "runId" | "storyId" | "startChapterId" | "mode" | "automatic">) =>
  run.mode === "pictures"
    ? `/s/${run.storyId}/pictures?picrun=${run.runId}`
    : run.mode === "review"
      ? run.automatic
        ? `/s/${run.storyId}/review`
        : `/s/${run.storyId}/review?tab=tags${run.startChapterId ? `&chapter=${run.startChapterId}` : ""}`
      : !run.startChapterId
      ? `/s/${run.storyId}/details?run=${run.runId}`
      : `/c/${run.startChapterId}/write-ahead?run=${run.runId}`;

export type Labels = Record<string, { title: string; story_title: string }>;

export const MOMENTS = { start: "Chapter start", end: "Chapter end" } as const;
export const pictures = (n: number) => `${n} ${n === 1 ? "picture" : "pictures"}`;

/** The titles of the chapters (and the stories, for covers) the jobs are for, by `targetKey`, fetched as new ones turn up. */
export function useLabels(targets: PictureTarget[]): Labels {
  const [labels, setLabels] = useState<Labels>({});
  const asked = useRef(new Set<string>());
  const key = [...new Set(targets.map(targetKey))].sort().join(" ");
  useEffect(() => {
    const keys = key.split(" ").filter((k) => k && !asked.current.has(k));
    if (keys.length === 0) return;
    for (const k of keys) asked.current.add(k);
    const of = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    const chapters = of("chapter:");
    const stories = of("cover:");
    const entries = of("codex:");
    fetch(`/api/chapters/labels?ids=${encodeURIComponent(chapters.join(","))}&stories=${encodeURIComponent(stories.join(","))}&entries=${encodeURIComponent(entries.join(","))}`)
      .then((r) => (r.ok ? r.json() : { labels: {}, stories: {} }))
      .then((d: { labels: Labels; stories?: Record<string, string>; entries?: Record<string, { name: string; story_title: string }> }) =>
        setLabels((prev) => ({
          ...prev,
          ...Object.fromEntries(Object.entries(d.labels).map(([id, l]) => [targetKey(chapterTarget("", id)), l])),
          ...Object.fromEntries(Object.entries(d.stories ?? {}).map(([id, title]) => [targetKey(coverTarget(id)), { title: "Cover", story_title: title }])),
          ...Object.fromEntries(Object.entries(d.entries ?? {}).map(([id, e]) => [targetKey(codexTarget("", id)), { title: `${e.name} (codex)`, story_title: e.story_title }])),
        })),
      )
      .catch(() => {
        // asked again when the list next changes
        for (const k of keys) asked.current.delete(k);
      });
  }, [key]);
  return labels;
}

/** The tab's title with the number of jobs being made after it, kept so when a page change resets the title. */
function useTitleCount(count: number) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/ \(\d+\)$/, "");
      const next = count > 0 ? `${base} (${count})` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      document.title = document.title.replace(/ \(\d+\)$/, "");
    };
  }, [count]);
}

export default function WorkQueueStatus() {
  const { jobs, stop, dismiss } = usePictureQueue();
  const { paused, items, stopRun, resumeRun, stopGenerate, machine } = useWorkQueue();
  const settings = useSettings();
  const comfyUrl = settings.comfy.url;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const labels = useLabels(jobs);
  const runs = useMemo(() => items.filter((i): i is RunItem => i.type === "run").sort((a, b) => b.addedAt - a.addedAt), [items]);
  const gens = useMemo(() => items.filter((i): i is GenerateItem => i.type === "generate").sort((a, b) => b.addedAt - a.addedAt), [items]);
  const gensGoing = gens.filter((g) => g.state === "working" || g.state === "waiting");
  const gensDone = gens.filter((g) => g.state === "done");
  const gensFailed = gens.filter((g) => g.state === "failed");
  const runsGoing = runs.filter((r) => r.state === "working" || r.state === "waiting");
  const runsPaused = runs.filter((r) => r.state === "paused");
  const runsDone = runs.filter((r) => r.state === "done");
  const runsFailed = runs.filter((r) => r.state === "failed");
  const making = jobs.filter((j) => j.state === "making");
  const done = jobs.filter((j) => j.state === "done");
  const failed = jobs.filter((j) => j.state === "failed");
  const newest = useMemo(() => [...jobs].reverse(), [jobs]);
  const going = making.length + runsGoing.length + gensGoing.length;
  const ready = done.length + runsDone.length + gensDone.length;
  const bad = failed.length + runsFailed.length + gensFailed.length;
  useTitleCount(going);
  const note = machineNote({
    ...machine,
    sharing: settings.queue.sharing,
    switchMinutes: settings.queue.switchMinutes,
    switchItems: settings.queue.switchItems,
    timeText: (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });

  // Closes after moving to another page.
  const pathname = usePathname();
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
  }
  // …and when clicking or pressing Escape anywhere else.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  // Every hook is above this.
  if (jobs.length === 0 && runs.length === 0 && gens.length === 0 && !paused) return null;
  const mixed = runs.length + gens.length > 0;

  const said = [
    paused && "paused",
    going > 0 && `${going} ${mixed ? "going" : "being made"}`,
    runsPaused.length > 0 && `${runsPaused.length} paused`,
    ready > 0 && `${ready} ready`,
    bad > 0 && `${bad} failed`,
  ].filter(Boolean);
  const label = `${mixed ? "Queue" : "Pictures"}: ${said.join(", ")}`;

  return (
    <div className="picture-queue" ref={ref}>
      <button type="button" className="picture-queue-button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {paused && <span className="picture-queue-part">Paused</span>}
        {going > 0 && (
          <span className="picture-queue-part">
            <span className="picture-queue-spinner" aria-hidden="true" />
            {going}
          </span>
        )}
        {runsPaused.length > 0 && <span className="picture-queue-part">⏸ {runsPaused.length}</span>}
        {ready > 0 && (
          <span className="picture-queue-part">
            <span className="picture-queue-dot" aria-hidden="true" />
            {ready} ready
          </span>
        )}
        {bad > 0 && <span className="picture-queue-part error">⚠ {bad}</span>}
      </button>
      {open && (
        <div className="picture-queue-panel" role="region" aria-label="Queue">
          {note && <p className="meta picture-queue-note">{note}</p>}
          <ul className="picture-queue-list">
            {gens.map((g) => (
              <GenerateRow key={g.key} item={g} onStop={() => stopGenerate(g.draftKey)} onDismiss={() => dismiss(g.key)} />
            ))}
            {runs.map((r) => (
              <RunRow key={r.key} run={r} onStop={() => stopRun(r.runId)} onResume={() => void resumeRun(r.runId)} onDismiss={() => dismiss(r.key)} />
            ))}
            {newest.map((j) => (
              <JobRow key={j.key} job={j} label={labels[targetKey(j)]} comfyUrl={comfyUrl} onStop={() => stop(j.key)} onDismiss={() => dismiss(j.key)} />
            ))}
          </ul>
          {ready + bad > 1 && (
            <button type="button" className="picture-queue-text-button picture-queue-clear" onClick={() => [...done, ...failed, ...runsDone, ...runsFailed, ...gensDone, ...gensFailed].forEach((j) => dismiss(j.key))}>
              Clear finished
            </button>
          )}
          <Link href="/queue" className="picture-queue-open">
            Open queue
          </Link>
        </div>
      )}
    </div>
  );
}

/** One job of the header list and the queue page. `note` replaces the progress line of a job being made; `extra` is shown at the end. */
export function JobRow({
  job, label, comfyUrl, onStop, onDismiss, note, extra,
}: { job: QueueJob; label?: { title: string; story_title: string }; comfyUrl: string; onStop: () => void; onDismiss: () => void; note?: string; extra?: ReactNode }) {
  const href = targetHref(job);
  const title = job.kind === "cover" ? "Cover" : (label?.title ?? (job.kind === "codex" ? "A codex entry" : "A chapter"));
  return (
    <li className={`picture-queue-job picture-queue-${job.state}`} aria-label={`${title}: ${job.state === "making" ? "being made" : job.state === "done" ? "ready" : "failed"}`}>
      <div className="picture-queue-head">
        <Link href={href}>{title}</Link>
        <span className="meta">
          {label?.story_title ? `${label.story_title} · ` : ""}
          {job.moment === "start" || job.moment === "end" ? MOMENTS[job.moment] : ""}
        </span>
      </div>
      {job.state === "making" && (
        <>
          <div className="picture-queue-line">
            <span className="meta">
              {pictures(job.count)} · {note ?? progressText(job.progress)}
            </span>
            <button type="button" className="picture-queue-text-button" onClick={onStop}>
              Stop
            </button>
          </div>
          {job.progress.stage === "running" && <progress value={job.progress.value} max={job.progress.max} aria-hidden="true" />}
        </>
      )}
      {job.state === "done" && (
        <>
          <Link href={href} className="picture-queue-thumbs" aria-label={`Open ${pictures(job.pictures?.length ?? 0)} for “${title}”`}>
            {(job.pictures ?? []).slice(0, 4).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- served by ComfyUI
              <img key={p.key} src={imageUrl(comfyUrl, p.image)} alt="" loading="lazy" style={{ aspectRatio: `${p.width} / ${p.height}` }} />
            ))}
          </Link>
          <div className="picture-queue-line">
            <span className="meta">{pictures(job.pictures?.length ?? 0)} ready</span>
            <span className="row" style={{ gap: "0.75rem" }}>
              <Link href={href}>Open</Link>
              <button type="button" className="picture-queue-text-button" onClick={onDismiss}>
                Dismiss
              </button>
            </span>
          </div>
          {job.message && <p className="error picture-queue-message">{job.message}</p>}
        </>
      )}
      {job.state === "failed" && (
        <>
          <p className="error picture-queue-message">{job.message}</p>
          <div className="picture-queue-line">
            <Link href={href}>Open</Link>
            <button type="button" className="picture-queue-text-button" onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </>
      )}
      {extra}
    </li>
  );
}

const RUN_STATE = { waiting: "waiting its turn", working: "writing", paused: "paused", done: "finished", failed: "failed" } as const;

/** One AI run in the header list and the queue page. */
export function RunRow({ run, onStop, onResume, onDismiss }: { run: RunItem; onStop: () => void; onResume: () => void; onDismiss: () => void }) {
  const href = runHref(run);
  const title = run.startTitle ? `${run.storyTitle} · ${run.startTitle}` : run.storyTitle;
  const going = run.state === "working" || run.state === "waiting";
  return (
    <li className={`picture-queue-job picture-queue-run picture-queue-${run.state}`} aria-label={`${MODE_WORDS[run.mode]}, ${title}: ${RUN_STATE[run.state]}`}>
      <div className="picture-queue-head">
        <Link href={href}>{MODE_WORDS[run.mode]}</Link>
        <span className="meta">{title}</span>
      </div>
      <div className="picture-queue-line">
        <span className="meta">
          {run.done} of {run.total} · {run.state === "working" && run.current ? `writing “${run.current}”` : RUN_STATE[run.state]}
        </span>
        <span className="row" style={{ gap: "0.75rem" }}>
          {going && (
            <button type="button" className="picture-queue-text-button" onClick={onStop}>
              Stop
            </button>
          )}
          {(run.state === "paused" || run.state === "failed") && (
            <button type="button" className="picture-queue-text-button" onClick={onResume}>
              Resume
            </button>
          )}
        </span>
      </div>
      {run.note && <p className="meta picture-queue-message">{run.note}</p>}
      {run.error && <p className="error picture-queue-message">{run.error}</p>}
      <div className="picture-queue-line">
        <Link href={href}>Open</Link>
        {!going && (
          <button type="button" className="picture-queue-text-button" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}

/** A Generate from the writing page, in the header list and the queue page. */
export function GenerateRow({ item, onStop, onDismiss }: { item: GenerateItem; onStop: () => void; onDismiss: () => void }) {
  const going = item.state === "working" || item.state === "waiting";
  const words = { waiting: "waiting its turn", working: "writing", done: "ready", failed: "failed" } as const;
  return (
    <li className={`picture-queue-job picture-queue-run picture-queue-${item.state}`} aria-label={`Writing ${item.label}: ${words[item.state]}`}>
      <div className="picture-queue-head">
        <Link href={item.href}>{item.state === "working" ? `Writing “${item.label}”…` : item.label}</Link>
        <span className="meta">Chapter from the writing page</span>
      </div>
      <div className="picture-queue-line">
        <span className="meta">
          {item.state === "waiting" ? (item.note ?? "Waiting its turn") : item.state === "working" ? "Writing…" : item.state === "done" ? "Ready" : "Failed"}
        </span>
        {going && (
          <button type="button" className="picture-queue-text-button" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      {item.error && <p className="error picture-queue-message">{item.error}</p>}
      <div className="picture-queue-line">
        <span className="row" style={{ gap: "0.75rem" }}>
          <Link href={item.href}>Open</Link>
          {item.text && (
            <button type="button" className="picture-queue-text-button" onClick={() => void copyText(item.text!)}>
              Copy text
            </button>
          )}
        </span>
        {!going && (
          <button type="button" className="picture-queue-text-button" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}
