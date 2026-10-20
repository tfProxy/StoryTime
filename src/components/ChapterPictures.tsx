"use client";

import { useState } from "react";
import type { ImageMoment } from "@/lib/ai/imagePrompt";
import type { ComfyImage } from "@/lib/comfy/client";
import type { PictureMark } from "@/lib/pictureJobs";
import PictureTile from "./PictureTile";
import OtherChapterPictures from "./OtherChapterPictures";
import PictureViewer from "./PictureViewer";
import { usePictureSaver } from "./usePictureSaver";
import { byPrompt, inView, pictureCaption, type Picture, type PictureView, type PromptToLoad } from "./pictures";

const SHOWN_PROMPT = 160;
const MOMENT_NAMES: Record<ImageMoment, string> = { start: "Chapter start", end: "Chapter end" };

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

type View = PictureView | "other";

/** What a mark change says, by the mark before and after. */
function markText(before: PictureMark | null, after: PictureMark | null): string {
  if (after === "pinned") return "Pinned.";
  if (after === "rejected") return "Rejected: it is under Rejected now.";
  return before === "rejected" ? "Restored." : "Unpinned.";
}

type Status = { ok: boolean; text: string; undo?: () => void };

type Props = {
  chapterId: string;
  storyId: string;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  comfyUrl: string;
  /** All of the chapter's pictures, newest first. */
  pictures: Picture[];
  /** Changes one picture (by key) in the page's list. */
  onChange: (key: string, patch: Partial<Picture>) => void;
  /** Stops showing this visit's unpinned pictures with the pinned ones. */
  onClear: () => void;
  /** Receives the element the jobs being made are listed in, at the top of the panel. */
  queueRef?: (element: HTMLElement | null) => void;
  /** Called to make new pictures starting from one of these. */
  onStart: (image: ComfyImage) => void;
  /** Called to bring back the prompt and settings a picture was made with. */
  onLoadPrompt: (p: PromptToLoad) => void;
};

/**
 * The chapter's pictures, grouped by prompt. "Pinned & new" (the default) shows the pinned ones and those
 * made on this visit, so coming back shows only the pinned ones; "All" every one but the rejected; and
 * "Rejected" those, to restore one. "Other chapters" lists what was made for the rest of the story.
 */
export default function ChapterPictures({ chapterId, storyId, titles, comfyUrl, pictures, onChange, onClear, queueRef, onStart, onLoadPrompt }: Props) {
  const [view, setView] = useState<View>("shortlist");
  const [status, setStatus] = useState<Status | null>(null);
  // The picture shown full size, if any.
  const [viewing, setViewing] = useState<string | null>(null);
  const saver = usePictureSaver(chapterId, comfyUrl, setStatus);

  const count = (v: PictureView) => pictures.filter((p) => inView(p, v)).length;
  const shown = view === "other" ? [] : pictures.filter((p) => inView(p, view));
  const groups = byPrompt(shown);
  // The viewer goes through the pictures in the order they are shown.
  const ordered = groups.flat();
  const viewed = ordered.find((p) => p.key === viewing) ?? null;

  /** A mark changed in the viewer: when it takes the picture out of this view, the viewer moves on to the next one. */
  function markInViewer(p: Picture, next: PictureMark | null) {
    if (view !== "other" && !inView({ ...p, mark: next }, view)) {
      const at = ordered.findIndex((q) => q.key === p.key);
      const after = ordered[at + 1] ?? ordered[at - 1] ?? null;
      setViewing(after?.key ?? null);
    }
    void mark(p, next);
  }
  const clearable = pictures.some((p) => p.fresh && p.mark === null);
  const VIEWS: { view: View; label: string }[] = [
    { view: "shortlist", label: `Pinned & new (${count("shortlist")})` },
    { view: "all", label: `All (${count("all")})` },
    { view: "rejected", label: `Rejected (${count("rejected")})` },
    { view: "other", label: "Other chapters" },
  ];

  async function mark(p: Picture, next: PictureMark | null, undoable = true) {
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
      setStatus(undoable ? { ok: true, text: markText(before, next), undo: () => void mark({ ...p, mark: next }, before, false) } : { ok: true, text: "Undone." });
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
      settings: { checkpoint: p.checkpoint, width: p.width, height: p.height, denoise: p.denoise },
      moment: p.moment,
    });
  }

  function empty(): string {
    if (view === "rejected") return "No rejected pictures.";
    if (view === "all") return "No pictures yet.";
    if (pictures.length === 0) {
      return "Pictures you make appear here, grouped by prompt. Pin (☆) the ones worth keeping: when you come back, only pinned pictures show, and the rest are under All.";
    }
    return `No pinned pictures. The ones made earlier are under All (${count("all")}).`;
  }

  return (
    <section className="ai-panel chapter-pictures" aria-labelledby="chapter-pictures-title">
      <div className="chapter-pictures-bar">
        <div className="chapter-pictures-top">
          <h2 id="chapter-pictures-title">Pictures</h2>
          {view === "shortlist" && clearable && (
            <button type="button" className="secondary" onClick={() => { onClear(); setStatus(null); }} title="Hides the new pictures you haven't pinned. They stay under All.">
              Clear unpinned
            </button>
          )}
        </div>
        <div className="row picture-views" role="group" aria-label="Show">
          {VIEWS.map((v) => (
            <button key={v.view} type="button" className={view === v.view ? undefined : "secondary"} aria-pressed={view === v.view} onClick={() => setView(v.view)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={queueRef} className="picture-queue-slot" />
      {status && (
        <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>
          {status.text}
          {status.undo && (
            <>
              {" "}
              <button type="button" className="secondary undo" onClick={status.undo}>
                Undo
              </button>
            </>
          )}
        </p>
      )}
      {view === "other" ? (
        <OtherChapterPictures chapterId={chapterId} storyId={storyId} titles={titles} comfyUrl={comfyUrl} saver={saver} onLoadPrompt={onLoadPrompt} onStart={onStart} />
      ) : (
        <>
          {shown.length === 0 && <p className="meta" style={{ margin: 0 }}>{empty()}</p>}
          {groups.map((group) => {
            const first = group[0];
            const moments = [...new Set(group.flatMap((p) => (p.moment ? [MOMENT_NAMES[p.moment]] : [])))].join(", ");
            return (
              <div key={first.key} className="picture-group">
                <div className="picture-group-head">
                  <p style={{ margin: 0 }} title={first.prompt}>
                    {short(first.prompt, SHOWN_PROMPT)}
                  </p>
                  <p className="meta" style={{ margin: 0 }}>
                    {[moments, group.length === 1 ? "1 picture" : `${group.length} pictures`, first.negative && `not: ${short(first.negative, 60)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <ul className="candidates" aria-label="Pictures from this prompt">
                  {group.map((p) => (
                    <PictureTile
                      key={p.key}
                      comfyUrl={comfyUrl}
                      image={p.image}
                      tileKey={p.key}
                      jobId={p.jobId}
                      saver={saver}
                      caption={pictureCaption(p)}
                      onStart={onStart}
                      mark={p.mark}
                      onMark={(next) => void mark(p, next)}
                      onOpen={() => {
                        setStatus(null);
                        setViewing(p.key);
                      }}
                      onLoadPrompt={() => loadFrom(p)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
      {viewed && (
        <PictureViewer
          comfyUrl={comfyUrl}
          list={ordered}
          current={viewed}
          onShow={setViewing}
          onClose={() => setViewing(null)}
          onMark={markInViewer}
          onLoadPrompt={(p) => {
            setViewing(null);
            loadFrom(p);
          }}
          saver={saver}
          status={status}
        />
      )}
    </section>
  );
}
