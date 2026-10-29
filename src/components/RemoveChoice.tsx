"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The "x" at the right of an unwritten choice on the reading page: removes the choice.
export default function RemoveChoice({ chapterId, choiceId, label }: { chapterId: string; choiceId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/choices/${choiceId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="choice-remove" onClick={remove} disabled={busy} aria-label={`Remove choice “${label}”`} title="Remove this choice">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
