"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ENTRY_TYPES, TYPE_HEADINGS, TYPE_LABELS, type EntryType } from "@/lib/codex";
import type { SharedEntry } from "@/lib/sharedCodex";

/** The shared codex: every entry that stories can link to, grouped by type, with "+ New shared entry". */
export default function SharedCodexList({ entries }: { entries: SharedEntry[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<EntryType>("character");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shared", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? `Request failed (${res.status})`);
      router.push(`/shared/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {error && <p className="error">{error}</p>}
      {creating ? (
        <form
          className="fact-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label>
            Name
            <input required autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as EntryType)}>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Adding…" : "Add entry"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setCreating(true)}>
            + New shared entry
          </button>
        </div>
      )}
      {entries.length === 0 && !creating && <p className="meta">No shared entries yet. Add a character, place or thing you want to use in more than one story.</p>}
      {ENTRY_TYPES.map((t) => {
        const group = entries.filter((e) => e.type === t);
        if (group.length === 0) return null;
        return (
          <section key={t}>
            <h2>{TYPE_HEADINGS[t]}</h2>
            <ul className="entry-cards">
              {group.map((e) => (
                <li key={e.id}>
                  <Link href={`/shared/${e.id}`} className="entry-card">
                    <span className="entry-card-text">
                      <span>
                        <strong>{e.name}</strong> <span className="meta">{TYPE_LABELS[e.type]}</span>
                        {e.always_include && <span className="tag"> · always included</span>}
                      </span>
                      <span className="meta entry-card-line">
                        Keywords: {e.aliases.length > 0 ? e.aliases.join(", ") : "none"} · {e.facts.length} fact{e.facts.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
