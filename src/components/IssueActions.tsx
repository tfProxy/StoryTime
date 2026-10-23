"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "open" is labelled "Back to the list"; "undo" also sets the status to open but reads "Undo".
type Action = "later" | "dismissed" | "open" | "undo";

const LABELS: Record<Action, string> = {
  later: "Later",
  dismissed: "Dismiss",
  open: "Back to the list",
  undo: "Undo",
};

/** Buttons that record the author's decision on one Review issue. */
export default function IssueActions({
  chapterId,
  kind,
  fingerprint,
  actions,
}: {
  chapterId: string;
  kind: string;
  fingerprint: string;
  actions: Action[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: Action) {
    const status = action === "undo" ? "open" : action;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, fingerprint, status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
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
          onClick={() => decide(a)}
        >
          {LABELS[a]}
        </button>
      ))}
      {error && <span className="error"> {error}</span>}
    </>
  );
}
