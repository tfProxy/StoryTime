"use client";

import { useEffect, useState } from "react";
import type { PictureJob } from "@/lib/pictureJobs";
import type { ComfyImage } from "@/lib/comfy/client";
import PictureTile from "./PictureTile";
import type { PictureSaver } from "./usePictureSaver";
import type { PromptToLoad } from "./pictures";

const PAGE = 12;
const SHOWN_PROMPT = 160;

type Page = { jobs: PictureJob[]; next: number | null };

async function fetchJobs(query: string, before: number | null): Promise<Page> {
  const res = await fetch(`/api/picture-jobs?${query}&limit=${PAGE}${before ? `&before=${before}` : ""}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Couldn't list the pictures (${res.status})`);
  return data as Page;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Props = {
  chapterId: string;
  storyId: string;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  comfyUrl: string;
  saver: PictureSaver;
  onLoadPrompt: (p: PromptToLoad) => void;
  /** Called to make new pictures starting from one of these. */
  onStart: (image: ComfyImage) => void;
};

/**
 * Pictures made for the story's other chapters, grouped by chapter and then by job, newest first, a page
 * at a time. Any of them can be used for this chapter, started from, or have its prompt brought back.
 */
export default function OtherChapterPictures({ chapterId, storyId, titles, comfyUrl, saver, onLoadPrompt, onStart }: Props) {
  const query = `story=${encodeURIComponent(storyId)}&not_chapter=${encodeURIComponent(chapterId)}`;
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
  const groups = new Map<string, PictureJob[]>();
  for (const job of jobs) groups.set(job.chapter_id, [...(groups.get(job.chapter_id) ?? []), job]);

  return (
    <div className="other-pictures" id="other-pictures">
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {jobs.length === 0 && !loading && !error && <p className="meta" style={{ margin: 0 }}>No pictures have been made for the story&apos;s other chapters yet.</p>}
      {[...groups].map(([group, list]) => (
        <div key={group} className="past-group">
          <h3>{titles[group] ?? "A chapter that has been removed"}</h3>
          {list.map((job) => (
            <div key={job.id} className="past-job">
              <p className="meta" style={{ margin: 0 }} title={job.prompt}>
                {job.prompt.length > SHOWN_PROMPT ? `${job.prompt.slice(0, SHOWN_PROMPT).trimEnd()}…` : job.prompt}
              </p>
              <p className="meta" style={{ margin: 0 }}>
                {[new Date(job.created_at).toLocaleString(), job.checkpoint, `${job.width} × ${job.height}`, `seed ${job.seed}`, job.denoise !== null && `variation, strength ${job.denoise}`].filter(Boolean).join(" · ")}
              </p>
              <div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    onLoadPrompt({
                      prompt: job.prompt,
                      negative: job.negative,
                      seed: job.seed,
                      settings: { checkpoint: job.checkpoint, width: job.width, height: job.height, denoise: job.denoise },
                      moment: job.moment,
                    })
                  }
                >
                  Load prompt
                </button>
              </div>
              <ul className="past-tiles" aria-label="Pictures from one job">
                {job.images.map((image, i) => (
                  <PictureTile key={`${job.id}-${i}`} comfyUrl={comfyUrl} image={image} tileKey={`${job.id}-${i}`} jobId={job.id} index={i} saver={saver} onStart={onStart} />
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
