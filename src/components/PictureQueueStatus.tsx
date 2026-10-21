"use client";

// The picture queue in the header: a button that shows how many jobs are being made and how many have
// finished since their chapter's Illustrate page was last open, and a list of them, each with a link to
// its chapter's Illustrate page. Hidden when there are none. It also puts the number of jobs being made
// in the tab's title ("StoryTime (2)").
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/lib/settings";
import { imageUrl } from "@/lib/comfy/client";
import { progressText } from "./pictures";
import { usePictureQueue, type QueueJob } from "./PictureQueue";

type Labels = Record<string, { title: string; story_title: string }>;

const MOMENTS = { start: "Chapter start", end: "Chapter end" } as const;
const pictures = (n: number) => `${n} ${n === 1 ? "picture" : "pictures"}`;

/** The titles of the chapters the jobs are for, fetched as new chapters turn up. */
function useLabels(chapterIds: string[]): Labels {
  const [labels, setLabels] = useState<Labels>({});
  const asked = useRef(new Set<string>());
  const key = [...new Set(chapterIds)].sort().join(",");
  useEffect(() => {
    const ids = key.split(",").filter((id) => id && !asked.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) asked.current.add(id);
    fetch(`/api/chapters/labels?ids=${encodeURIComponent(ids.join(","))}`)
      .then((r) => (r.ok ? r.json() : { labels: {} }))
      .then((d: { labels: Labels }) => setLabels((prev) => ({ ...prev, ...d.labels })))
      .catch(() => {
        // asked again when the list next changes
        for (const id of ids) asked.current.delete(id);
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

export default function PictureQueueStatus() {
  const { jobs, stop, dismiss } = usePictureQueue();
  const comfyUrl = useSettings().comfy.url;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const labels = useLabels(jobs.map((j) => j.chapterId));
  const making = jobs.filter((j) => j.state === "making");
  const done = jobs.filter((j) => j.state === "done");
  const failed = jobs.filter((j) => j.state === "failed");
  const newest = useMemo(() => [...jobs].reverse(), [jobs]);
  useTitleCount(making.length);

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
  if (jobs.length === 0) return null;

  const said = [
    making.length > 0 && `${making.length} being made`,
    done.length > 0 && `${done.length} ready`,
    failed.length > 0 && `${failed.length} failed`,
  ].filter(Boolean);
  const label = `Pictures: ${said.join(", ")}`;

  return (
    <div className="picture-queue" ref={ref}>
      <button type="button" className="picture-queue-button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {making.length > 0 && (
          <span className="picture-queue-part">
            <span className="picture-queue-spinner" aria-hidden="true" />
            {making.length}
          </span>
        )}
        {done.length > 0 && (
          <span className="picture-queue-part">
            <span className="picture-queue-dot" aria-hidden="true" />
            {done.length} ready
          </span>
        )}
        {failed.length > 0 && <span className="picture-queue-part error">⚠ {failed.length}</span>}
      </button>
      {open && (
        <div className="picture-queue-panel" role="region" aria-label="Picture jobs">
          <ul className="picture-queue-list">
            {newest.map((j) => (
              <JobRow key={j.key} job={j} label={labels[j.chapterId]} comfyUrl={comfyUrl} onStop={() => stop(j.key)} onDismiss={() => dismiss(j.key)} />
            ))}
          </ul>
          {done.length + failed.length > 1 && (
            <button type="button" className="picture-queue-text-button picture-queue-clear" onClick={() => [...done, ...failed].forEach((j) => dismiss(j.key))}>
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function JobRow({ job, label, comfyUrl, onStop, onDismiss }: { job: QueueJob; label?: { title: string; story_title: string }; comfyUrl: string; onStop: () => void; onDismiss: () => void }) {
  const href = `/c/${job.chapterId}/illustrate`;
  const title = label?.title ?? "A chapter";
  return (
    <li className={`picture-queue-job picture-queue-${job.state}`} aria-label={`${title}: ${job.state === "making" ? "being made" : job.state === "done" ? "ready" : "failed"}`}>
      <div className="picture-queue-head">
        <Link href={href}>{title}</Link>
        <span className="meta">
          {label?.story_title ? `${label.story_title} · ` : ""}
          {job.moment ? MOMENTS[job.moment] : ""}
        </span>
      </div>
      {job.state === "making" && (
        <>
          <div className="picture-queue-line">
            <span className="meta">
              {pictures(job.count)} · {progressText(job.progress)}
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
    </li>
  );
}
