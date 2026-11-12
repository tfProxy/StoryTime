"use client";

import { useState } from "react";
import { LIMITS } from "@/lib/limits";

/**
 * The writing desk's "→ …" line above a chapter: the choice that leads to it. Clicking it renames the choice in place
 * (Enter or Save keeps it, Escape or Cancel leaves it as it was). Without `onSave` it is only the line (a path block).
 */
export default function DeskVia({
  label,
  placeholder = "Choice text",
  note,
  onSave,
}: {
  label: string;
  placeholder?: string;
  /** A line under it (what a rename does here). */
  note?: string | null;
  /** Saves the new text; resolves to an error message, or null. */
  onSave?: (label: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What was saved, shown until the page has the new text (`label` changes).
  const [saved, setSaved] = useState<{ text: string; over: string } | null>(null);
  const shown = saved && saved.over === label ? saved.text : label;

  if (!onSave) {
    return (
      <p className="desk-via">
        <span aria-hidden="true">→ </span>
        {label}
      </p>
    );
  }

  async function save() {
    const next = text.trim();
    if (!next || !onSave) return;
    if (next === shown) return setEditing(false);
    setBusy(true);
    setError(null);
    const problem = await onSave(next);
    setBusy(false);
    if (problem) return setError(problem);
    setSaved({ text: next, over: label });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="desk-via desk-via-edit">
        <div className="row">
          <span aria-hidden="true">→</span>
          <input
            aria-label="Choice text"
            autoFocus
            value={text}
            placeholder={placeholder}
            maxLength={LIMITS.label}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
          />
          <button type="button" disabled={busy || !text.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  return (
    <div className="desk-via">
      <button
        type="button"
        className="desk-via-button"
        title="Rename the choice that leads here"
        aria-label={shown ? `Choice that leads here: ${shown}. Rename it` : "Write the choice that leads here"}
        onClick={() => {
          setText(shown);
          setError(null);
          setEditing(true);
        }}
      >
        <span aria-hidden="true">→ </span>
        {shown || <span className="meta">{placeholder}</span>}
      </button>
      {note && <p className="meta desk-via-note">{note}</p>}
    </div>
  );
}
