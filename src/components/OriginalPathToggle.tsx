"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Show the original path": the story's switch for the Original marks of an imported story (reading page, outline). */
export default function OriginalPathToggle({ storyId, show }: { storyId: string; show: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(show);
  const [busy, setBusy] = useState(false);

  async function change(next: boolean) {
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/stories/${storyId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show_original: next }) });
      if (!res.ok) setOn(!next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="inline-label original-toggle">
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void change(e.target.checked)} /> Show the original path
    </label>
  );
}
