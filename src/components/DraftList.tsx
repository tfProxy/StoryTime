"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { deleteDraft, listDrafts, type Draft } from "@/lib/drafts";

export default function DraftList() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDrafts()
      .then((d) => !cancelled && setDrafts(d))
      .catch(() => !cancelled && setDrafts([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (drafts === null) return <p className="meta">Loading…</p>;
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
              deleteDraft(d.key).then(() => setDrafts((cur) => cur?.filter((x) => x.key !== d.key) ?? null));
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </>
  );
}
