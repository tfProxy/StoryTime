"use client";

import { useEffect, useState } from "react";
import type { PictureJob } from "@/lib/pictureJobs";
import type { PictureTarget } from "@/lib/pictureTarget";
import type { ComfyImage } from "@/lib/comfy/client";
import PictureTile from "./PictureTile";
import type { PictureSaver } from "./usePictureSaver";
import { pictureCaption, picturesOf, type Picture, type StartRequest } from "./pictures";

const PAGE = 12;
const SHOWN_PROMPT = 80;
const short = (text: string) => (text.length > SHOWN_PROMPT ? `${text.slice(0, SHOWN_PROMPT).trimEnd()}…` : text);

type Page = { jobs: PictureJob[]; next: number | null };

async function fetchJobs(query: string, before: number | null): Promise<Page> {
  const res = await fetch(`/api/picture-jobs?${query}&limit=${PAGE}${before ? `&before=${before}` : ""}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Couldn't list the pictures (${res.status})`);
  return data as Page;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Props = {
  /** The chapter (left out of the list) or the story's cover (all of the story's chapters are listed). */
  target: PictureTarget;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  comfyUrl: string;
  saver: PictureSaver;
  /** Called to bring back the prompt and settings a picture was made with. */
  onLoadPrompt: (picture: Picture) => void;
  /** Called to make new pictures starting from one of these: redrawn from the prompt, or edited by instruction. */
  onStart: (image: ComfyImage, mode: StartRequest) => void;
  /** Why they can't be edited by instruction now, or null. */
  editBlocked: string | null;
  /** Shows everything a picture was made with. */
  onInfo: (picture: Picture) => void;
};

/**
 * Pictures made for the story's other chapters (for the cover, all of them), grouped by chapter and then by
 * job, newest first, a page at a time. Any of them can be used here, started from, or have its prompt brought back.
 */
export default function OtherChapterPictures({ target, titles, comfyUrl, saver, onLoadPrompt, onStart, editBlocked, onInfo }: Props) {
  const { storyId, chapterId } = target;
  const query = `story=${encodeURIComponent(storyId)}&${chapterId === null ? "chapters=1" : `not_chapter=${encodeURIComponent(chapterId)}`}`;
  const [jobs, setJobs] = useState<PictureJob[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchJobs(query, null).then(
      (page) => {
        if (!live) return;
        setJobs(page.jobs);
        setNext(page.next);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setError(message(e));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [query]);

  async function more() {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchJobs(query, next);
      setJobs((prev) => [...prev, ...page.jobs]);
      setNext(page.next);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  // Pictures grouped by the chapter they were made for, the most recently used chapter first.
  const groups = new Map<string | null, PictureJob[]>();
  for (const job of jobs) groups.set(job.chapter_id, [...(groups.get(job.chapter_id) ?? []), job]);

  return (
    <div className="other-pictures" id="other-pictures">
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {jobs.length === 0 && !loading && !error && <p className="meta" style={{ margin: 0 }}>No pictures have been made for the story&apos;s {chapterId === null ? "" : "other "}chapters yet.</p>}
      {[...groups].map(([group, list]) => (
        <div key={group ?? "cover"} className="past-group">
          <h3>{group === null ? "Cover" : (titles[group] ?? "A chapter that has been removed")}</h3>
          {/* No text per job: a line between jobs, and Info on a picture says how it was made. */}
          {list.map((job) => (
            <div key={job.id} className="past-job">
              <ul className="past-tiles" aria-label={`Pictures from “${job.instruction ? `Edit: ${short(job.instruction)}` : short(job.prompt)}”`}>
                {picturesOf([job]).map((p) => (
                  <PictureTile
                    key={p.key}
                    comfyUrl={comfyUrl}
                    image={p.image}
                    tileKey={p.key}
                    jobId={p.jobId}
                    index={p.index}
                    saver={saver}
                    caption={pictureCaption(p)}
                    onStart={onStart}
                    editBlocked={editBlocked}
                    onLoadPrompt={() => onLoadPrompt(p)}
                    onInfo={() => onInfo(p)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
      {loading && <p className="meta" style={{ margin: 0 }} role="status">Loading…</p>}
      {next !== null && !loading && (
        <div>
          <button type="button" className="secondary" onClick={() => void more()}>
            Show more
          </button>
        </div>
      )}
    </div>
  );
}
