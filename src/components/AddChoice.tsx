"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import { useSettings } from "@/lib/settings";

// Adds an unwritten choice to the chapter without starting to write it.
export default function AddChoice({ chapterId }: { chapterId: string }) {
  const router = useRouter();
  const settings = useSettings();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const label = text.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/choices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, author_name: settings.authorName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div className="row">
        <input
          value={text}
          placeholder="Add a new suggestion"
          aria-label="Add a new suggestion"
          maxLength={LIMITS.label}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <button type="button" className="secondary" onClick={add} disabled={busy || !text.trim()} aria-label="Add choice">
          +
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
