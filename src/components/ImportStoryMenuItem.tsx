"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Header-menu entry: pick a StoryTime JSON export and create a copy of that story.
export default function ImportStoryMenuItem() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      const res = await fetch("/api/stories/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `Import failed (${res.status})`);
      router.push(`/c/${out.chapter_id}`);
    } catch (err) {
      window.alert(`Couldn't import the story: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <button type="button" className="menu-item" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Importing…" : "Import a story (JSON)"}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Story JSON file"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </>
  );
}
