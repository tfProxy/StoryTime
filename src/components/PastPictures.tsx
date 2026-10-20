"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import type { PictureJob } from "@/lib/pictureJobs";
import PictureTile from "./PictureTile";
import { usePictureSaver } from "./usePictureSaver";

const PAGE = 12;
const SHOWN_PROMPT = 160;

/** What "Load prompt" hands back: the text and, where known, the seed of the job that made the pictures. */
export type PromptToLoad = { prompt: string; negative: string; seed: number | null };

type Scope = "chapter" | "story";
const SCOPES: { scope: Scope; label: string }[] = [
  { scope: "chapter", label: "This chapter" },
  { scope: "story", label: "This story" },
];

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
  onLoadPrompt: (p: PromptToLoad) => void;
};

/** Pictures made earlier on ComfyUI, for this chapter or any chapter of the story, ready to use again. */
export default function PastPictures({ chapterId, storyId, titles, onLoadPrompt }: Props) {
  const comfy = useSettings().comfy;
  const [scope, setScope] = useState<Scope>("chapter");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const saver = usePictureSaver(chapterId, comfy.url, setStatus);
  if (!comfy.url) return null;

  return (
    <section className="ai-panel past-pictures" id="past-pictures">
      <h2>Past pictures</h2>
      <p className="meta" style={{ margin: 0 }}>
        Pictures made earlier, as listed when this page opened. They stay in ComfyUI, so one it has since lost can&apos;t be used.
      </p>
      <div className="row" role="group" aria-label="Show pictures made for">
        {SCOPES.map((s) => (
          <button key={s.scope} type="button" className={scope === s.scope ? undefined : "secondary"} aria-pressed={scope === s.scope} onClick={() => setScope(s.scope)}>
            {s.label}
          </button>
        ))}
      </div>
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
      <PastList key={scope} scope={scope} chapterId={chapterId} storyId={storyId} titles={titles} comfyUrl={comfy.url} saver={saver} onLoadPrompt={onLoadPrompt} />
    </section>
  );
}

type ListProps = Props & { scope: Scope; comfyUrl: string; saver: ReturnType<typeof usePictureSaver> };

/** The list for one scope; it starts over (a new key) when the scope changes. */
function PastList({ scope, chapterId, storyId, titles, comfyUrl, saver, onLoadPrompt }: ListProps) {
  const query = scope === "chapter" ? `chapter=${encodeURIComponent(chapterId)}` : `story=${encodeURIComponent(storyId)}`;
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
    <>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {jobs.length === 0 && !loading && !error && (
        <p className="meta" style={{ margin: 0 }}>
          {scope === "chapter" ? "No pictures have been made for this chapter yet." : "No pictures have been made for this story yet."}
        </p>
      )}
      {[...groups].map(([group, list]) => (
        <div key={group} className="past-group">
          {scope === "story" && (
            <h3>
              {titles[group] ?? "A chapter that has been removed"}
              {group === chapterId && <span className="meta"> (this chapter)</span>}
            </h3>
          )}
          {list.map((job) => (
            <div key={job.id} className="past-job">
              <p className="meta" style={{ margin: 0 }} title={job.prompt}>
                {job.prompt.length > SHOWN_PROMPT ? `${job.prompt.slice(0, SHOWN_PROMPT).trimEnd()}…` : job.prompt}
              </p>
              <p className="meta" style={{ margin: 0 }}>
                {[new Date(job.created_at).toLocaleString(), job.checkpoint, `${job.width} × ${job.height}`, `seed ${job.seed}`].filter(Boolean).join(" · ")}
              </p>
              <div>
                <button type="button" className="secondary" onClick={() => onLoadPrompt({ prompt: job.prompt, negative: job.negative, seed: job.seed })}>
                  Load prompt
                </button>
              </div>
              <ul className="past-tiles" aria-label="Pictures from one job">
                {job.images.map((image, i) => (
                  <PictureTile key={`${job.id}-${i}`} comfyUrl={comfyUrl} image={image} tileKey={`${job.id}-${i}`} jobId={job.id} saver={saver} />
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
    </>
  );
}
