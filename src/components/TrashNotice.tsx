"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Shown at the top of a chapter in the trash. The top of a trashed branch has a Restore button; a chapter below a
// trashed one says which chapter to restore first (`blocker`), since a branch can't come back under a trashed chapter.
export default function TrashNotice({ chapterId, blocker }: { chapterId: string; blocker: { id: string; title: string } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/chapters/${chapterId}/restore`, { method: "POST" });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${r.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notice trash-notice" role="status">
      <span>
        This branch is in the trash.
        {blocker && (
          <>
            {" "}It is below a trashed chapter: restore <Link href={`/c/${blocker.id}`}>{blocker.title}</Link> first.
          </>
        )}
      </span>
      {!blocker && (
        <button type="button" disabled={busy} onClick={restore}>
          Restore
        </button>
      )}
      {error && <span className="error"> {error}</span>}
    </div>
  );
}
