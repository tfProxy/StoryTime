"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type TaggedChapter = {
  id: string;
  title: string;
  tags: { id: string; name: string; value: string | null }[];
};

export type TagChoice = { id: string; name: string; choices: string[] };

export default function TaggedChapters({ chapters, enabled }: { chapters: TaggedChapter[]; enabled: TagChoice[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, { tag: string; value: string }>>({});

  async function call(url: string, init: RequestInit) {
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const remove = (id: string, label: string) => {
    if (!window.confirm(`Remove the tag “${label}” from this chapter?`)) return;
    void call(`/api/chapter-tags/${id}`, { method: "DELETE" });
  };

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {error && <p className="error">{error}</p>}
      {chapters.map((c) => {
        const sel = pick[c.id] ?? { tag: enabled[0]?.id ?? "", value: "" };
        const tag = enabled.find((t) => t.id === sel.tag);
        return (
          <article key={c.id} className="card" data-tagged-chapter={c.id}>
            <p style={{ margin: 0 }}>
              <Link href={`/c/${c.id}`}>{c.title}</Link>
            </p>
            {c.tags.length > 0 && (
              <p style={{ margin: "0.5rem 0" }}>
                {c.tags.map((t) => {
                  const label = t.value ? `${t.name}: ${t.value}` : t.name;
                  return (
                    <span key={t.id} className="tag" style={{ marginRight: "0.4rem" }}>
                      {label}{" "}
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Remove ${label} from ${c.title}`}
                        style={{ padding: "0 0.35rem" }}
                        onClick={() => remove(t.id, label)}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </p>
            )}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <select
                aria-label={`Tag to add to ${c.title}`}
                style={{ width: "auto" }}
                value={sel.tag}
                onChange={(e) => setPick({ ...pick, [c.id]: { tag: e.target.value, value: "" } })}
              >
                {enabled.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {tag && tag.choices.length > 0 && (
                <select
                  aria-label={`Value of the tag to add to ${c.title}`}
                  style={{ width: "auto" }}
                  value={sel.value}
                  onChange={(e) => setPick({ ...pick, [c.id]: { ...sel, value: e.target.value } })}
                >
                  <option value="">(no value)</option>
                  {tag.choices.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="secondary"
                style={{ whiteSpace: "nowrap" }}
                disabled={!sel.tag}
                onClick={() =>
                  call(`/api/chapters/${c.id}/tags`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tag_id: sel.tag, value: sel.value || null }),
                  })
                }
              >
                Add a tag
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
