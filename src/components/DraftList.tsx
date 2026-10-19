"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { deleteDraft, listDrafts, type DraftListItem } from "@/lib/drafts";

export default function DraftList() {
  const [drafts, setDrafts] = useState<DraftListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDrafts()
      .then((d) => !cancelled && setDrafts(d))
      .catch((e) => {
        if (cancelled) return;
        setError(`Couldn't load drafts (${e instanceof Error ? e.message : String(e)}).`);
        setDrafts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (drafts === null) return <p className="meta">Loading…</p>;
  if (error) return <p className="error">{error}</p>;
  if (drafts.length === 0) return <p>No drafts. Start a chapter and it will be saved here automatically.</p>;

  return (
    <>
      {drafts.map((d) => (
        <div key={d.key} className="card row" style={{ justifyContent: "space-between" }}>
          <Link href={d.href} style={{ flex: 1 }}>
            <strong>{d.title || d.storyTitle || "Untitled draft"}</strong>
            <span className="meta" style={{ display: "block", margin: 0 }}>
              {d.label} · edited {new Date(d.updatedAt).toLocaleString()}
            </span>
          </Link>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (!window.confirm("Delete this draft? This can't be undone.")) return;
              deleteDraft(d.key)
                .then(() => setDrafts((cur) => cur?.filter((x) => x.key !== d.key) ?? null))
                .catch((e) => window.alert(`Couldn't delete the draft: ${e instanceof Error ? e.message : String(e)}`));
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </>
  );
}
