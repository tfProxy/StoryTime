"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Marks one AI-written chapter reviewed (the same call as the notice at the top of the chapter), then refreshes the page.
export default function MarkReviewedButton({ chapterId }: { chapterId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/chapters/${chapterId}/reviewed`, { method: "POST" });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${r.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark it reviewed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" disabled={busy} style={{ padding: "0.1rem 0.5rem", marginLeft: "0.4rem" }} onClick={mark}>
        Mark reviewed
      </button>
      {error && <span className="error"> {error}</span>}
    </>
  );
}