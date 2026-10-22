"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type SuggestionItem = {
  id: string;
  chapter_id: string;
  chapter_title: string;
  tag_name: string;
  value: string | null;
  quote: string;
  reason: string;
  stale: boolean;
};

export default function TagSuggestions({ items }: { items: SuggestionItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, body: { status: "approved" | "rejected"; add_example?: boolean }) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/chapter-tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {error && <p className="error">{error}</p>}
      {items.map((s) => (
        <article key={s.id} className="card" data-chapter-tag={s.id}>
          <p style={{ margin: 0 }}>
            <Link href={`/c/${s.chapter_id}`}>{s.chapter_title}</Link> · <strong>{s.tag_name}</strong>
            {s.value ? `: ${s.value}` : ""}
          </p>
          {s.quote && <blockquote style={{ margin: "0.5rem 0", paddingLeft: "0.75rem", borderLeft: "3px solid var(--line)", fontStyle: "italic" }}>{s.quote}</blockquote>}
          {s.reason && <p className="meta" style={{ margin: "0.25rem 0" }}>{s.reason}</p>}
          {s.stale && <p className="meta">The chapter has been edited since the AI read it.</p>}
          <div className="row">
            <button type="button" disabled={busy === s.id} onClick={() => decide(s.id, { status: "approved" })}>
              Approve
            </button>
            <button type="button" className="secondary" disabled={busy === s.id} onClick={() => decide(s.id, { status: "rejected" })}>
              Reject
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy === s.id || !s.quote}
              onClick={() => decide(s.id, { status: "rejected", add_example: true })}
            >
              Reject and add as example
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
