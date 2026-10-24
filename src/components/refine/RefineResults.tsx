"use client";

import { imageUrl } from "@/lib/comfy/client";
import type { RefineResult } from "@/lib/refine/session";

/** A job being made for this session: a place kept for each picture, with Stop on the first. */
export type PendingResult = { key: string; count: number; stop: () => void };

/**
 * The Results panel: the pictures this session's jobs made (newest first) as small tiles, after the places kept for
 * the jobs being made. Clicking a tile does nothing yet; `data-result-index` is the picture's place in the session's
 * list (oldest = 0).
 */
export default function RefineResults({ results, pending, comfyUrl }: { results: RefineResult[]; pending: PendingResult[]; comfyUrl: string }) {
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
          {pending.flatMap((job) =>
            Array.from({ length: job.count }, (_, i) => (
              <li key={`${job.key}-${i}`} className="refine-result refine-result-pending" data-pending="true" role={i === 0 ? "status" : undefined} aria-label={i === 0 ? "Making pictures" : undefined}>
                <span className="picture-queue-spinner" aria-hidden="true" />
                {i === 0 && (
                  <button type="button" className="secondary" onClick={job.stop} aria-label="Stop making these pictures" title="Stop this job">
                    Stop
                  </button>
                )}
              </li>
            )),
          )}
          {results
            .map((r, index) => ({ r, index }))
            .reverse()
            .map(({ r, index }) => (
              <li key={`${r.image.subfolder}/${r.image.filename}`} className="refine-result" data-result-index={index} aria-label={`Result ${index + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- ComfyUI's /view is another origin */}
                <img src={imageUrl(comfyUrl, r.image)} alt="" loading="lazy" />
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
