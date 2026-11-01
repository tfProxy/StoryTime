"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ENTRY_TYPES, type CodexEntry, type EntryType, type OverrideField } from "@/lib/codex";

const keywordsOf = (text: string) => text.split(",").map((a) => a.trim()).filter(Boolean);

const LABELS: Record<OverrideField, string> = { type: "type", content: "notes", always_include: "“always include”", aliases: "keywords" };

/**
 * The details of an entry linked to a shared entry: the name comes from the shared entry; the type, keywords, notes
 * and "always include" can be changed for this story only (from this chapter on), and each change can be taken back.
 * Changing the shared entry itself, in every story, is done on its own page.
 */
export default function LinkedEntryDetails({ entry, chapterId, chapterTitle }: { entry: CodexEntry; chapterId: string; chapterTitle: string }) {
  const router = useRouter();
  const [type, setType] = useState<EntryType>(entry.type);
  const [aliases, setAliases] = useState(entry.aliases.join(", "));
  const [always, setAlways] = useState(entry.always_include);
  const [content, setContent] = useState(entry.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    type !== entry.type || always !== entry.always_include || content.trim() !== entry.content || keywordsOf(aliases).join("\n") !== entry.aliases.join("\n");

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: chapterId, entry_id: entry.entry_id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const body: Record<string, unknown> = {};
    if (type !== entry.type) body.type = type;
    if (always !== entry.always_include) body.always_include = always;
    if (content.trim() !== entry.content) body.content = content.trim();
    if (keywordsOf(aliases).join("\n") !== entry.aliases.join("\n")) body.aliases = keywordsOf(aliases);
    if (await send(body)) {
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    }
  }

  const changed = (f: OverrideField) => entry.overridden.includes(f);
  const reset = (f: OverrideField) => (
    <button type="button" className="linkish" disabled={busy} onClick={() => void send({ reset: [f] })}>
      Reset to the shared {LABELS[f]}
    </button>
  );

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <p className="notice">
        This entry is shared. Its name comes from the <Link href={`/shared/${entry.shared_entry_id}`}>shared entry</Link>, and so does anything
        you haven&apos;t changed here: edit the shared entry to change it in <strong>every story</strong>. What you change below is for this story
        only, from “{chapterTitle}” on, and the facts can be changed for this story too.
      </p>
      {error && <p className="error">{error}</p>}
      <form
        className="fact-form entry-details-form flat"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>{entry.name}</strong>
        </p>
        <label>
          Type {changed("type") && <span className="tag">changed in this story</span>}
          <select value={type} onChange={(e) => setType(e.target.value as EntryType)}>
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {changed("type") && !dirty && reset("type")}
        <label>
          Keywords {changed("aliases") && <span className="tag">changed in this story</span>}
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
          <small>comma-separated; words in the story that bring this entry into the AI&apos;s prompt</small>
        </label>
        {changed("aliases") && !dirty && reset("aliases")}
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} style={{ width: "auto" }} />
          <span>
            Always include in AI prompts {changed("always_include") && <span className="tag">changed in this story</span>}
          </span>
        </label>
        {changed("always_include") && !dirty && reset("always_include")}
        <label>
          Your notes (not sent to the AI) {changed("content") && <span className="tag">changed in this story</span>}
          <textarea rows={4} value={content} maxLength={8000} onChange={(e) => setContent(e.target.value)} />
        </label>
        {changed("content") && !dirty && reset("content")}
        <div className="row">
          <button type="submit" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save for this story"}
          </button>
          <Link className="button secondary" href={`/shared/${entry.shared_entry_id}`}>
            Edit the shared entry (all stories)
          </Link>
          {saved && !dirty && (
            <span className="ok" role="status">
              Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
