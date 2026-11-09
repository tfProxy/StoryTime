"use client";

import { imageUrl } from "@/lib/comfy/client";
import { resultKey, trayOrder, type RefineResult } from "@/lib/refine/session";
import { progressText, type JobProgress } from "../pictures";

/** A job being made for this session: a place kept for each picture, with how far it has got, and Stop on the first. */
export type PendingResult = { key: string; count: number; progress: JobProgress; stop: () => void };

/** A few words for a small tile (the whole sentence, `progressText`, is its tooltip and what is read out). */
function shortProgress(p: JobProgress): string {
  if (p.stage === "running") return p.max > 0 ? `${Math.round((p.value / p.max) * 100)}%` : "Drawing";
  if (p.stage === "queued") return p.ahead ? `${p.ahead} ahead` : "Starting";
  if (p.stage === "uploading") return "Sending";
  if (p.stage === "loading") return "Loading";
  return "Waiting";
}

/**
 * The Results panel: the pictures this session's jobs made (oldest first) as small tiles, followed by the places kept
 * for the jobs being made. Clicking a tile selects it (the screen then shows it); clicking the selected one again lets go
 * of it. `data-result-index` is the picture's place in the session's list (oldest = 0); the tile whose picture is the
 * working picture has a badge, “In use”.
 */
export default function RefineResults({
  results,
  pending,
  comfyUrl,
  selectedKey,
  onSelect,
  inUseKey,
}: {
  results: RefineResult[];
  pending: PendingResult[];
  comfyUrl: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** The result that is the working picture now, if any. */
  inUseKey: string | null;
}) {
  return (
    <section className="refine-panel" aria-label="Results">
      <h2>
        Results <span className="meta" data-testid="refine-result-count">({results.length})</span>
      </h2>
      {results.length === 0 && pending.length === 0 ? (
        <p className="meta" style={{ margin: 0 }}>
          Pictures made with Go appear here.
        </p>
      ) : (
        <ul className="refine-results">
          {trayOrder(results).map((r, index) => {
              const key = resultKey(r);
              const selected = key === selectedKey;
              const inUse = key === inUseKey;
              return (
                <li
                  key={key}
                  className="refine-result"
                  data-result-index={index}
                  data-selected={selected ? "true" : undefined}
                  data-in-use={inUse ? "true" : undefined}
                  aria-label={`Result ${index + 1}`}
                >
                  <button
                    type="button"
                    className="refine-result-pick"
                    aria-label={`Result ${index + 1}`}
                    aria-pressed={selected}
                    title={selected ? "Click to go back to editing" : "Look at this result"}
                    onClick={() => onSelect(selected ? null : key)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- ComfyUI's /view is another origin */}
                    <img src={imageUrl(comfyUrl, r.image)} alt="" loading="lazy" />
                  </button>
                  {inUse && (
                    <span className="refine-result-badge" role="img" aria-label="In use" title="This is the working picture">
                      In use
                    </span>
                  )}
                </li>
              );
            })}
          {pending.flatMap((job) =>
            Array.from({ length: job.count }, (_, i) => (
              <li
                key={`${job.key}-${i}`}
                className="refine-result refine-result-pending"
                data-pending="true"
                data-stage={job.progress.stage}
                role={i === 0 ? "status" : undefined}
                aria-label={i === 0 ? `Making pictures: ${progressText(job.progress)}` : undefined}
                title={progressText(job.progress)}
              >
                {job.progress.stage === "running" ? (
                  <progress className="refine-result-progress" value={job.progress.value} max={job.progress.max} aria-hidden="true" />
                ) : (
                  <span className="picture-queue-spinner" aria-hidden="true" />
                )}
                <span className="refine-result-stage" aria-hidden="true">
                  {shortProgress(job.progress)}
                </span>
                {i === 0 && (
                  <button type="button" className="secondary" onClick={job.stop} aria-label="Stop making these pictures" title="Stop this job">
                    Stop
                  </button>
                )}
              </li>
            )),
          )}
        </ul>
      )}
    </section>
  );
}
