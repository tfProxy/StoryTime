"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shown at the top of an AI-written chapter nobody has marked reviewed. Reading or editing does not count as reviewing.
// `pathUnreviewed` is how many chapters above this one on the path are unreviewed too.
export default function AiReviewNotice({ chapterId, pathUnreviewed }: { chapterId: string; pathUnreviewed: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark(path: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/chapters/${chapterId}/reviewed${path ? "?path=1" : ""}`, { method: "POST" });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${r.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark it reviewed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notice ai-review-notice" role="status">
      <span>Written by AI, not reviewed yet.</span>
      <span className="ai-review-actions">
        <button type="button" disabled={busy} onClick={() => mark(false)}>
          Mark reviewed
        </button>
        {pathUnreviewed > 0 && (
          <button type="button" className="secondary" disabled={busy} onClick={() => mark(true)}>
            Mark this path reviewed
          </button>
        )}
      </span>
      {error && <span className="error"> {error}</span>}
    </div>
  );
}
