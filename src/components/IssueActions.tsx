"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "open" is labelled "Back to the list"; "undo" also sets the status to open but reads "Undo".
// "intentional" (continuity issues only) asks for a note first.
type Action = "later" | "dismissed" | "open" | "undo" | "intentional";

const LABELS: Record<Action, string> = {
  later: "Later",
  dismissed: "Dismiss",
  open: "Back to the list",
  undo: "Undo",
  intentional: "Intentional",
};

const NOTE_MAX = 200;

/** Buttons that record the author's decision on one Review issue. */
export default function IssueActions({
  chapterId,
  kind,
  fingerprint,
  actions,
  entity,
  codexEntry,
}: {
  chapterId: string;
  kind: string;
  fingerprint: string;
  actions: Action[];
  /** For Intentional: the name the issue is about, and whether a codex entry of that name is live at the chapter (its name, or null). */
  entity?: string;
  codexEntry?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  async function decide(action: Action, noteText?: string) {
    const status = action === "undo" ? "open" : action;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, fingerprint, status, ...(noteText !== undefined ? { note: noteText } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setAsking(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          className="secondary"
          disabled={busy}
          style={{ padding: "0.1rem 0.5rem", marginLeft: "0.4rem" }}
          onClick={() => (a === "intentional" ? setAsking(true) : decide(a))}
        >
          {LABELS[a]}
        </button>
      ))}
      {asking && (
        <form
          style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.4rem", alignItems: "center" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) decide("intentional", note.trim());
          }}
        >
          <input
            type="text"
            aria-label="Why it is on purpose"
            placeholder="Why it's on purpose, e.g. a disguise"
            maxLength={NOTE_MAX}
            value={note}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: "1 1 14rem" }}
          />
          <button type="submit" disabled={busy || note.trim() === ""} style={{ padding: "0.1rem 0.5rem" }}>
            Save
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            style={{ padding: "0.1rem 0.5rem" }}
            onClick={() => {
              setAsking(false);
              setNote("");
            }}
          >
            Cancel
          </button>
          {entity && (
            <span className="meta" style={{ flexBasis: "100%" }}>
              {codexEntry ? `The note is also added to the codex entry “${codexEntry}”.` : `No codex entry named ${entity}; the note is kept here only.`}
            </span>
          )}
        </form>
      )}
      {error && <span className="error"> {error}</span>}
    </>
  );
}
