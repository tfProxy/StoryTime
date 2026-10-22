"use client";

import { useState } from "react";
import type { ComfyImage } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import type { PictureSlot, PictureTarget } from "@/lib/pictureTarget";
import PictureTile from "./PictureTile";
import OtherChapterPictures from "./OtherChapterPictures";
import PictureViewer from "./PictureViewer";
import PictureInfo from "./PictureInfo";
import { usePictureSaver } from "./usePictureSaver";
import { saveSettings, useSettings } from "@/lib/settings";
import { inView, pictureCaption, progressText, timeline, type PendingJob, type Picture, type PictureView, type PromptToLoad, type StartMode } from "./pictures";

const SHOWN_PROMPT = 80;

/** A picture's source as a starting picture records it (see fromComfyImage). */
const comfySource = (image: ComfyImage) => `comfy:${image.subfolder ? `${image.subfolder}/` : ""}${image.filename}`;

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

type View = PictureView | "other";

type Status = { ok: boolean; text: string };

type Props = {
  /** Whose pictures these are: a chapter's, or the story's cover's. */
  target: PictureTarget;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  comfyUrl: string;
  /** All of the chapter's pictures, newest first. */
  pictures: Picture[];
  /** Changes one picture (by key) in the page's list. */
  onChange: (key: string, patch: Partial<Picture>) => void;
  /** Stops showing this visit's unpinned pictures with the pinned ones. */
  onClear: () => void;
  /** The jobs being made, newest first; they show at the top, a place kept for each of their pictures. */
  pending?: PendingJob[];
  /** Called to make new pictures starting from one of these: redrawn from the prompt, or edited by instruction. */
  onStart: (image: ComfyImage, mode: StartMode) => void;
  /** Why pictures can't be edited by instruction now (no edit model installed), or null. */
  editBlocked?: string | null;
  /** Called to bring back the prompt and settings a picture was made with. */
  onLoadPrompt: (p: PromptToLoad) => void;
  /** Which picture is the chapter's header and footer (or the story's cover) now, when known. */
  used?: Partial<Record<PictureSlot, { jobId: string; index: number } | null>>;
  /** The starting picture's source (`comfy:…`, see StartPicture), when new pictures are being made from one. */
  starting?: string | null;
};

/**
 * The chapter's pictures, newest first, in runs made one after another with the same prompt and settings,
 * under the jobs still being made. "Pinned & new" (the default) shows the pinned ones, the chapter's header
 * and footer (as if pinned) and those made on this visit, so coming back shows only the pinned ones; "All" every one but the trashed; and "Trashed"
 * those, to restore one (they are stored with the mark "rejected"). "Other chapters" lists what was made for the rest of the story.
 */
export default function ChapterPictures({ target, titles, comfyUrl, pictures, onChange, onClear, pending = [], onStart, editBlocked = null, onLoadPrompt, used, starting = null }: Props) {
  /** The picture being edited or redrawn. */
  const isStarting = (p: Picture) => starting !== null && starting === comfySource(p.image);
  /** The pictures the first view always shows, as if pinned: the chapter's header and footer, and the starting picture. */
  const kept = (p: Picture) => inUse(p).length > 0 || isStarting(p);
  const [view, setView] = useState<View>("shortlist");
  const [status, setStatus] = useState<Status | null>(null);
  // The picture shown full size, if any.
  const [viewing, setViewing] = useState<string | null>(null);
  // The picture whose Info popup is open, if any.
  const [info, setInfo] = useState<Picture | null>(null);
  // The server pins a picture saved as the header or footer; the page's copy of its mark follows.
  const saver = usePictureSaver(target, comfyUrl, setStatus, (jobId, index) => {
    const p = pictures.find((q) => q.jobId === jobId && q.index === index);
    if (p && p.mark !== "pinned") onChange(p.key, { mark: "pinned" });
  });
  /** The slots a picture is saved in now. */
  const inUse = (p: Picture): PictureSlot[] =>
    saver.slots.filter((slot) => {
      const u = used?.[slot];
      return u && u.jobId === p.jobId && u.index === p.index;
    });

  const settings = useSettings();
  // The order is the person's choice, kept in Settings so it is the same on every device. Other chapters is always newest first.
  const oldestFirst = settings.comfy.picturesOldestFirst && view !== "other";

  const count = (v: PictureView) => pictures.filter((p) => inView(p, v, kept(p))).length;
  const shown = view === "other" ? [] : pictures.filter((p) => inView(p, view, kept(p)));
  // New pictures arrive in Pinned & new and All, so there the jobs being made join the run they continue;
  // elsewhere they show on their own at the top.
  const joined = view === "shortlist" || view === "all";
  const newestFirst = joined ? timeline(pending, shown) : [...timeline(pending, []), ...timeline([], shown)];
  // Oldest first is the same list turned over: the runs, and in each the pictures and the jobs being made (the
  // one running now comes first among those, next to the newest pictures, which come just before).
  const groups = oldestFirst
    ? newestFirst.map((g) => ({ ...g, pending: [...g.pending].reverse(), pictures: [...g.pictures].reverse() })).reverse()
    : newestFirst;
  // The viewer goes through the pictures in the order they are shown.
  const ordered = groups.flatMap((g) => g.pictures);
  const viewed = ordered.find((p) => p.key === viewing) ?? null;
  /** Shows a picture full size; a new one is no longer marked new. */
  function show(key: string | null) {
    setViewing(key);
    if (key && pictures.some((p) => p.key === key && p.isNew)) onChange(key, { isNew: false });
  }

  /** A mark changed in the viewer: when it takes the picture out of this view, the viewer moves on to the next one. */
  function markInViewer(p: Picture, next: PictureMark | null) {
    if (view !== "other" && !inView({ ...p, mark: next }, view, kept(p))) {
      const at = ordered.findIndex((q) => q.key === p.key);
      const after = ordered[at + 1] ?? ordered[at - 1] ?? null;
      setViewing(after?.key ?? null);
    }
    void mark(p, next);
  }
  // The header, footer and starting picture stay in this view, so clearing doesn't hide them.
  const clearable = pictures.some((p) => p.fresh && p.mark === null && !kept(p));
  const VIEWS: { view: View; label: string }[] = [
    { view: "shortlist", label: `Pinned & new (${count("shortlist")})` },
    { view: "all", label: `All (${count("all")})` },
    { view: "rejected", label: `Trashed (${count("rejected")})` },
    { view: "other", label: target.chapterId === null ? "Chapters" : "Other chapters" },
  ];

  // A mark shows on the picture itself, so only a failure is reported.
  async function mark(p: Picture, next: PictureMark | null) {
    const before = p.mark;
    onChange(p.key, { mark: next });
    setStatus(null);
    try {
      const res = await fetch(`/api/picture-jobs/${encodeURIComponent(p.jobId!)}/mark`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: p.index, mark: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `the server answered ${res.status}`);
    } catch (e) {
      onChange(p.key, { mark: before });
      setStatus({ ok: false, text: `Couldn't change the mark: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  function loadFrom(p: Picture) {
    onLoadPrompt({
      prompt: p.prompt,
      negative: p.negative,
      seed: p.seed,
      // An edit's strength is not the Redraw strength, so it isn't offered back.
      settings: { checkpoint: p.checkpoint, width: p.width, height: p.height, denoise: p.editModel ? null : p.denoise },
      moment: p.moment,
    });
  }

  function empty(): string {
    if (view === "rejected") return "No trashed pictures.";
    if (view === "all") return "No pictures yet.";
    if (pictures.length === 0) {
      return "Pictures you make appear here, grouped by prompt. Pin the ones worth keeping (the thumbtack): when you come back, only pinned pictures show, and the rest are under All.";
    }
    return `No pinned pictures. The ones made earlier are under All (${count("all")}).`;
  }

  return (
    <section className="ai-panel chapter-pictures" aria-labelledby="chapter-pictures-title">
      <div className="chapter-pictures-bar">
        <div className="chapter-pictures-top">
          <h2 id="chapter-pictures-title">Pictures</h2>
          <div className="row chapter-pictures-actions">
            {view !== "other" && (
              <button
                type="button"
                className="secondary picture-order"
                aria-label={oldestFirst ? "Order: oldest first. Switch to newest first" : "Order: newest first. Switch to oldest first"}
                title={oldestFirst ? "Oldest first: the newest pictures are at the bottom. Click for newest first." : "Newest first: the newest pictures are at the top. Click for oldest first."}
                onClick={() => void saveSettings({ ...settings, comfy: { ...settings.comfy, picturesOldestFirst: !oldestFirst } })}
              >
                {oldestFirst ? "↑ Oldest first" : "↓ Newest first"}
              </button>
            )}
            {view === "shortlist" && clearable && (
              <button type="button" className="secondary" onClick={() => { onClear(); setStatus(null); }} title="Hides the new pictures you haven't pinned. They stay under All.">
                Clear unpinned
              </button>
            )}
          </div>
        </div>
        <div className="row picture-views" role="group" aria-label="Show">
          {VIEWS.map((v) => (
            <button key={v.view} type="button" className={view === v.view ? undefined : "secondary"} aria-pressed={view === v.view} onClick={() => setView(v.view)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {status && (
        <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>
          {status.text}
        </p>
      )}
      {groups.map((group) => {
        // No heading: a line between runs says the settings changed, and Info on a picture says what they were.
        const first = group.pending[0] ?? group.pictures[0];
        const making = group.pending.map((job) => <PendingTiles key={job.key} job={job} />);
        return (
          <div key={group.key} className="picture-group">
            <ul className="candidates" aria-label={`Pictures from “${first.instruction ? `Edit: ${short(first.instruction, SHOWN_PROMPT)}` : short(first.prompt, SHOWN_PROMPT)}”`}>
              {!oldestFirst && making}
              {group.pictures.map((p) => (
                <PictureTile
                  key={p.key}
                  comfyUrl={comfyUrl}
                  image={p.image}
                  tileKey={p.key}
                  jobId={p.jobId}
                  index={p.index}
                  inUse={inUse(p)}
                  editing={isStarting(p)}
                  saver={saver}
                  caption={pictureCaption(p)}
                  onStart={onStart}
                  editBlocked={editBlocked}
                  mark={p.mark}
                  onMark={(next) => void mark(p, next)}
                  onOpen={() => {
                    setStatus(null);
                    show(p.key);
                  }}
                  isNew={p.isNew}
                  onTouched={p.isNew ? () => onChange(p.key, { isNew: false }) : undefined}
                  onLoadPrompt={() => loadFrom(p)}
                  onInfo={() => setInfo(p)}
                />
              ))}
              {oldestFirst && making}
            </ul>
          </div>
        );
      })}
      {view === "other" ? (
        <OtherChapterPictures
          target={target}
          titles={titles}
          comfyUrl={comfyUrl}
          saver={saver}
          onLoadPrompt={loadFrom}
          onStart={onStart}
          editBlocked={editBlocked}
          onInfo={setInfo}
        />
      ) : (
        shown.length === 0 && !(joined && pending.length > 0) && <p className="meta" style={{ margin: 0 }}>{empty()}</p>
      )}
      {viewed && (
        <PictureViewer
          comfyUrl={comfyUrl}
          list={ordered}
          current={viewed}
          inUse={inUse(viewed)}
          onShow={show}
          onClose={() => setViewing(null)}
          onMark={markInViewer}
          onLoadPrompt={(p) => {
            setViewing(null);
            loadFrom(p);
          }}
          onInfo={setInfo}
          onStart={(p, mode) => {
            setViewing(null);
            onStart(p.image, mode);
          }}
          editBlocked={editBlocked}
          saver={saver}
          status={status}
        />
      )}
      {/* After the viewer, so it opens over it. */}
      {info && (
        <PictureInfo
          key={info.key}
          picture={info}
          titles={titles}
          onClose={() => setInfo(null)}
          onLoadPrompt={() => {
            setInfo(null);
            setViewing(null);
            loadFrom(info);
          }}
          onStart={(mode) => {
            setInfo(null);
            setViewing(null);
            onStart(info.image, mode);
          }}
          editBlocked={editBlocked}
        />
      )}
    </section>
  );
}

/**
 * A place kept for each picture of a job being made, at the pictures' size, in the picture grid. The
 * pictures of a job are made together, so each place shows the job's progress; only the first is read
 * out, and has the job's Stop.
 */
function PendingTiles({ job }: { job: PendingJob }) {
  return Array.from({ length: job.count }, (_, i) => (
    <li key={i} className="comfy-pending-tile" data-job={job.key} style={{ aspectRatio: `${job.width} / ${job.height}` }}>
      <div className="comfy-pending-progress" aria-hidden={i > 0 || undefined}>
        <span role={i === 0 ? "status" : undefined}>{progressText(job.progress)}</span>
        {job.progress.stage === "running" && <progress value={job.progress.value} max={job.progress.max} aria-label={i === 0 ? "Progress" : undefined} />}
        {i === 0 && (
          <button type="button" className="secondary" onClick={job.stop} title="Stop making these pictures">
            Stop
          </button>
        )}
      </div>
    </li>
  ));
}
