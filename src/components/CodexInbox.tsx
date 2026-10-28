"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CodexSuggestion } from "@/lib/codexSuggestions";
import { wordDiff } from "@/lib/wordDiff";

/** Fired on window when a codex check has left new suggestions, so an open inbox reads the list again. */
export const INBOX_CHANGED = "storytime:codex-inbox-changed";

type Props = {
  storyId: string;
  /** Only this chapter's suggestions (the Story Bible's chapter filter). */
  chapterId?: string;
};

type Edits = { aspect?: string; form?: string; text?: string };

const KIND_LABEL: Record<CodexSuggestion["kind"], string> = { set: "Change", form: "Form", retire: "Remove", entry: "New entry", conflict: "Check" };

/** What the card is about: "New aspect" for a fact that has no earlier text. */
const kindLabel = (s: CodexSuggestion) => (s.kind === "set" && !s.before ? "New aspect" : KIND_LABEL[s.kind]);

/** The words of the proposed text as the diff compares them (a form is "name, note"). */
const afterText = (s: CodexSuggestion) => (s.kind === "form" ? [s.form, s.after].filter(Boolean).join(", ") : s.after);

async function post(url: string, body?: unknown): Promise<{ entry_id?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** The open and dismissed suggestions, for the whole story or one chapter. */
async function fetchInbox(storyId: string, chapterId?: string): Promise<CodexSuggestion[]> {
  const q = (status: string) => `/api/stories/${storyId}/codex-suggestions?status=${status}${chapterId ? `&chapter=${encodeURIComponent(chapterId)}` : ""}`;
  const [open, dismissed] = await Promise.all([fetch(q("open")), fetch(q("dismissed"))]);
  if (!open.ok || !dismissed.ok) throw new Error("Couldn't read the codex inbox.");
  const a = (await open.json()) as { suggestions: CodexSuggestion[] };
  const b = (await dismissed.json()) as { suggestions: CodexSuggestion[] };
  return [...a.suggestions, ...b.suggestions];
}

export default function CodexInbox({ storyId, chapterId }: Props) {
  const [items, setItems] = useState<CodexSuggestion[] | null>(null);
  const [loadError, setLoadError] = useState("");
  // Suggestions decided on this page stay where they were, collapsed to one line, until the page is left.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  // State is set only in the promise's callbacks, never while the effect that calls this runs.
  const load = useCallback(
    () =>
      fetchInbox(storyId, chapterId).then(
        (list) => {
          setItems(list);
          setLoadError("");
        },
        (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
      ),
    [storyId, chapterId],
  );

  useEffect(() => {
    void load();
    const again = () => {
      setTouched(new Set());
      void load();
    };
    window.addEventListener(INBOX_CHANGED, again);
    return () => window.removeEventListener(INBOX_CHANGED, again);
  }, [load]);

  const setStatus = (id: string, status: CodexSuggestion["status"]) => setItems((list) => list && list.map((s) => (s.id === id ? { ...s, status } : s)));
  const setError = (id: string, message: string) => setErrors((e) => ({ ...e, [id]: message }));
  const working = (id: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const touch = (id: string) => setTouched((t) => new Set(t).add(id));

  async function run(id: string, action: () => Promise<void>): Promise<boolean> {
    working(id, true);
    setError(id, "");
    try {
      await action();
      return true;
    } catch (e) {
      setError(id, e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      working(id, false);
    }
  }

  const accept = (s: CodexSuggestion, edits?: Edits) =>
    run(s.id, async () => {
      await post(`/api/codex-suggestions/${s.id}/accept`, edits);
      touch(s.id);
      setStatus(s.id, "accepted");
      setEditing(null);
    });
  const dismiss = (s: CodexSuggestion) =>
    run(s.id, async () => {
      await post(`/api/codex-suggestions/${s.id}/dismiss`);
      touch(s.id);
      setStatus(s.id, "dismissed");
    });
  const reopen = (s: CodexSuggestion) =>
    run(s.id, async () => {
      await post(`/api/codex-suggestions/${s.id}/reopen`);
      touch(s.id);
      setStatus(s.id, "open");
    });

  const shown = useMemo(() => (items ?? []).filter((s) => s.status === "open" || touched.has(s.id)), [items, touched]);
  const dismissedList = useMemo(() => (items ?? []).filter((s) => s.status === "dismissed" && !touched.has(s.id)), [items, touched]);

  // Chapter, then entry; the server already ordered the suggestions by chapter depth and time.
  const chapters = useMemo(() => {
    const out: { id: string; title: string; entries: { key: string; name: string; list: CodexSuggestion[] }[] }[] = [];
    for (const s of shown) {
      let ch = out.find((c) => c.id === s.chapter_id);
      if (!ch) out.push((ch = { id: s.chapter_id, title: s.chapter_title, entries: [] }));
      const key = s.kind === "entry" ? `new:${s.entry_name.toLowerCase()}` : (s.entry_id ?? s.entry_name);
      let en = ch.entries.find((e) => e.key === key);
      if (!en) ch.entries.push((en = { key, name: s.entry_name, list: [] }));
      en.list.push(s);
    }
    return out;
  }, [shown]);

  async function acceptAll(list: CodexSuggestion[]) {
    for (const s of list) {
      if (!(await accept(s))) break;
    }
  }

  if (items === null) return <p className="meta">{loadError || "Reading the codex inbox…"}</p>;

  return (
    <div className="codex-inbox">
      {chapterId && (
        <p className="meta">
          Suggestions from this chapter only · <Link href={`/s/${storyId}/review?tab=codex`}>Show all chapters</Link>
        </p>
      )}
      {loadError && <p className="error">{loadError}</p>}
      {shown.length === 0 && <p className="meta">No codex suggestions waiting.</p>}

      {chapters.map((ch) => (
        <section key={ch.id}>
          <h3 className="inbox-chapter">
            <Link href={`/c/${ch.id}/codex`}>{ch.title}</Link>
          </h3>
          {ch.entries.map((en) => {
            const eligible = en.list.filter((s) => s.status === "open" && s.kind !== "conflict" && s.kind !== "entry");
            return (
              <div key={en.key}>
                <div className="inbox-entry">
                  <h4>{en.name || "An entry"}</h4>
                  {eligible.length > 1 && (
                    <button type="button" className="secondary" disabled={eligible.some((s) => busy.has(s.id))} onClick={() => void acceptAll(eligible)}>
                      Accept all for {en.name || "this entry"}
                    </button>
                  )}
                </div>
                {en.list.map((s) => (
                  <Card
                    key={s.id}
                    s={s}
                    busy={busy.has(s.id)}
                    error={errors[s.id]}
                    editing={editing === s.id}
                    onEdit={(on) => setEditing(on ? s.id : null)}
                    onAccept={(edits) => void accept(s, edits)}
                    onDismiss={() => void dismiss(s)}
                    onReopen={() => void reopen(s)}
                  />
                ))}
              </div>
            );
          })}
        </section>
      ))}

      {dismissedList.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="linkish" aria-expanded={showDismissed} onClick={() => setShowDismissed((v) => !v)}>
            Dismissed ({dismissedList.length})
          </button>
          {showDismissed && (
            <ul className="plain" style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0", display: "grid", gap: "0.5rem" }}>
              {dismissedList.map((s) => (
                <li key={s.id} className="inbox-done">
                  <span>
                    <strong>{s.entry_name || "An entry"}</strong>
                    {s.aspect && <> · {s.aspect}</>} — {s.kind === "retire" ? "remove" : `“${afterText(s)}”`} <span className="meta">from “{s.chapter_title}”</span>
                  </span>
                  <button type="button" className="linkish" disabled={busy.has(s.id)} onClick={() => void reopen(s)}>
                    Reopen
                  </button>
                  {errors[s.id] && <span className="error">{errors[s.id]}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

type CardProps = {
  s: CodexSuggestion;
  busy: boolean;
  error?: string;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onAccept: (edits?: Edits) => void;
  onDismiss: () => void;
  onReopen: () => void;
};

function Card({ s, busy, error, editing, onEdit, onAccept, onDismiss, onReopen }: CardProps) {
  const [aspect, setAspect] = useState(s.kind === "form" ? s.form : s.aspect);
  const [text, setText] = useState(s.after);

  if (s.status === "accepted") {
    return (
      <p className="inbox-done">
        <span>
          Saved to <strong>{s.entry_name || "the entry"}</strong> at <Link href={`/c/${s.chapter_id}/codex`}>“{s.chapter_title}”</Link>
        </span>
      </p>
    );
  }
  if (s.status === "dismissed") {
    return (
      <div className="inbox-done">
        <span>
          Dismissed <span className="meta">({s.entry_name || "an entry"}{s.aspect ? `, ${s.aspect}` : ""})</span>
        </span>
        <button type="button" className="linkish" disabled={busy} onClick={onReopen}>
          Undo
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    );
  }

  const segments = s.kind === "entry" ? [] : wordDiff(s.before, s.kind === "retire" ? "" : afterText(s));
  const moved = s.kind !== "entry" && s.current !== s.before;
  const conflict = s.kind === "conflict";
  return (
    <article className="card inbox-card">
      <div className="inbox-head">
        <span className="tag">{kindLabel(s)}</span>
        <strong>{s.entry_name || "An entry"}</strong>
        {s.kind !== "entry" && s.kind !== "form" && <span className="meta">{s.aspect || "general"}</span>}
        {s.kind !== "form" && s.form && <span className="tag">{s.form}</span>}
      </div>

      {s.kind === "entry" && s.entry ? (
        <div>
          <p style={{ margin: 0 }}>
            <span className="tag">{s.entry.type}</span>
            {s.entry.aliases.length > 0 && <span className="meta"> also called {s.entry.aliases.join(", ")}</span>}
          </p>
          {s.entry.notes && <p style={{ margin: "0.25rem 0" }}>{s.entry.notes}</p>}
          {s.entry.facts.length > 0 && (
            <ul className="inbox-facts">
              {s.entry.facts.map((f, i) => (
                <li key={i}>
                  {f.aspect && <strong>{f.aspect}</strong>}
                  {f.form && <span className="tag">{f.form}</span>}
                  {(f.aspect || f.form) && ": "}
                  {f.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : editing ? (
        <div className="inbox-edit">
          <label>
            <span className="meta">{s.kind === "form" ? "Form" : "Aspect"}</span>
            <input value={aspect} maxLength={100} onChange={(e) => setAspect(e.target.value)} />
          </label>
          <label>
            <span className="meta">{s.kind === "form" ? "Note" : "Fact"}</span>
            <textarea value={text} rows={3} maxLength={2000} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "inherit" }} />
          </label>
        </div>
      ) : (
        <p className="inbox-diff" aria-label="What changes">
          {segments.map((seg, i) =>
            seg.type === "add" ? <ins key={i}>{seg.text}</ins> : seg.type === "del" ? <del key={i}>{seg.text}</del> : <span key={i}>{seg.text}</span>,
          )}
        </p>
      )}

      {s.quote && <p className="inbox-quote">“{s.quote}”</p>}
      {moved && (
        <p className="meta" style={{ margin: 0 }}>
          The codex has changed since: now {s.current ? `“${s.current}”` : "empty"}
        </p>
      )}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

      <div className="inbox-actions">
        {editing ? (
          <>
            <button type="button" disabled={busy || !text.trim()} onClick={() => onAccept(s.kind === "form" ? { form: aspect, text } : { aspect, text })}>
              Save
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => onEdit(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => onAccept()}>
              {conflict ? "Update codex" : "Accept"}
            </button>
            {(s.kind === "set" || s.kind === "form") && (
              <button type="button" className="secondary" disabled={busy} onClick={() => onEdit(true)}>
                Edit
              </button>
            )}
            <button type="button" className="secondary" disabled={busy} onClick={onDismiss}>
              {conflict ? "Keep the codex" : "Dismiss"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
