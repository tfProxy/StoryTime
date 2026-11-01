"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PathChapter } from "@/lib/ai/codexAi";
import { DRAFT_ANCHOR, type CodexEntry } from "@/lib/codex";
import type { SharedEntry } from "@/lib/sharedCodex";

/**
 * "+ Shared entry": adds an entry from the shared codex to the story, from a chapter on this branch (the one being
 * viewed unless another is picked). It is saved at once. Entries already in the codex here are not offered again.
 */
export default function SharedEntryLink({
  chapterId,
  path,
  entries,
  onHold,
  editing = false,
}: {
  chapterId: string;
  /** The saved chapters it can be added from. */
  path: PathChapter[];
  entries: CodexEntry[];
  /** In the writing page's drawer: holds the entry in the draft (for the chapter being written, the default) instead of saving it at once. */
  onHold?: (entry: SharedEntry) => void;
  /** The draft edits an existing chapter. */
  editing?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState<SharedEntry[] | null>(null);
  const [sharedId, setSharedId] = useState("");
  const [anchor, setAnchor] = useState(onHold ? DRAFT_ANCHOR : chapterId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || shared) return;
    let live = true;
    fetch("/api/shared")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { entries: SharedEntry[] } | null) => live && setShared(d?.entries ?? []))
      .catch(() => live && setShared([]));
    return () => {
      live = false;
    };
  }, [open, shared]);

  const here = new Set(entries.flatMap((e) => (e.shared_entry_id ? [e.shared_entry_id] : [])));
  const offered = (shared ?? []).filter((s) => !here.has(s.id));
  const chosen = sharedId && offered.some((s) => s.id === sharedId) ? sharedId : (offered[0]?.id ?? "");

  async function add() {
    if (onHold && anchor === DRAFT_ANCHOR) {
      const base = offered.find((s) => s.id === chosen);
      if (base) onHold(base);
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: anchor, shared_entry_id: chosen }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? `Request failed (${res.status})`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        + Shared entry
      </button>
    );
  }
  return (
    <form
      className="fact-form"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      {shared === null ? (
        <p className="meta">Loading…</p>
      ) : offered.length === 0 ? (
        <p className="meta">
          {shared.length === 0 ? "The shared codex is empty." : "Every shared entry is already in this codex."} Make entries in the{" "}
          <Link href="/shared">Shared codex</Link>.
        </p>
      ) : (
        <>
          <label>
            Shared entry
            <select value={chosen} onChange={(e) => setSharedId(e.target.value)}>
              {offered.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
          </label>
          {(onHold || path.length > 1) && (
            <label>
              Appears from
              <select value={anchor} onChange={(e) => setAnchor(e.target.value)}>
                {onHold && <option value={DRAFT_ANCHOR}>This chapter (saved when you {editing ? "save" : "post"} it)</option>}
                {path.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {!onHold && c.id === chapterId ? " (this chapter)" : ""}
                  </option>
                ))}
              </select>
              <small>it is in the codex from this chapter on, on this branch{onHold ? "; an earlier chapter is saved at once" : ""}</small>
            </label>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        {offered.length > 0 && (
          <button type="submit" disabled={busy || !chosen}>
            {busy ? "Adding…" : "Add to the codex"}
          </button>
        )}
        <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
