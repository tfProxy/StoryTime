"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type SwitchTag = { id: string; name: string; applies: string };

const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? "";

// Which of the tag library's tags are on for one story. Every tag is on unless the author switches it off.
export default function StoryTagSwitches({
  storyId,
  tags,
  enabled,
  heading = true,
}: {
  storyId: string;
  tags: SwitchTag[];
  enabled: string[];
  /** Show the "Tags in this story" heading (off where a summary already says it). */
  heading?: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState<string[]>(enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(tagId: string, next: boolean) {
    setError(null);
    setBusy(tagId);
    const before = on;
    setOn(next ? [...on.filter((t) => t !== tagId), tagId] : on.filter((t) => t !== tagId));
    try {
      const res = await fetch(`/api/stories/${storyId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tagId, on: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (Array.isArray(data.enabled)) setOn(data.enabled);
      router.refresh();
    } catch (e) {
      setOn(before);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const body = (
    <>
      {heading && <h2>Tags in this story</h2>}
      {tags.length === 0 ? (
        <p>
          No tags yet. <Link href="/settings#tags">Settings › Tags</Link> has the library.
        </p>
      ) : (
        <>
          <p className="meta">All tags are on for a new story. Untick the ones that don&apos;t fit; the AI won&apos;t look for them.</p>
          {error && <p className="error">{error}</p>}
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {tags.map((t) => {
              const hint = firstLine(t.applies);
              return (
                <label key={t.id} className="inline-label" style={{ alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={on.includes(t.id)}
                    disabled={busy === t.id}
                    onChange={(e) => void toggle(t.id, e.target.checked)}
                    style={{ marginTop: "0.2rem", padding: 0 }}
                  />
                  <span>
                    {t.name}
                    {hint && <span className="meta" style={{ display: "block", margin: 0 }}>{hint}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  return heading ? <section className="ai-panel" data-tag-switches>{body}</section> : <div data-tag-switches>{body}</div>;
}
