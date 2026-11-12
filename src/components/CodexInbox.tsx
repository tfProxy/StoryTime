"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodexSuggestion } from "@/lib/codexSuggestions";
import { cleanForm, quoteSupports } from "@/lib/codex";
import { wordDiff } from "@/lib/wordDiff";

/** Fired on window when a codex check has left new suggestions, so an open inbox reads the list again. */
export const INBOX_CHANGED = "storytime:codex-inbox-changed";

type Props = {
  storyId: string;
  /** Only this chapter's suggestions. */
  chapterId?: string;
  /**
   * The suggestions that apply at a chapter: those made at it and at the ones before it on its branch. `onChanged` is
   * called after one is accepted, dismissed or reopened.
   */
  onPath?: {
    chapterIds: string[];
    onChanged?: () => void;
    /** Only the suggestions for this entry (an entry's own page). */
    entryId?: string;
  };
};

type Edits = { aspect?: string; form?: string; text?: string };

const KIND_LABEL: Record<CodexSuggestion["kind"], string> = { set: "Change", form: "Form", retire: "Remove", entry: "New entry", conflict: "Check" };

/** What the card is about: "New aspect" for a fact that has no earlier text. */
const kindLabel = (s: CodexSuggestion) => (s.kind === "set" && !s.before ? "New aspect" : KIND_LABEL[s.kind]);

/** The words of the proposed text as the diff compares them (a form is "name, note"). */
const afterText = (s: CodexSuggestion) => (s.kind === "form" ? [s.form, s.after].filter(Boolean).join(", ") : s.after);

export type SourceTone = "text" | "story" | "invented" | "unsure" | "conflict";

type Sourced = Pick<CodexSuggestion, "kind" | "source" | "quote"> & Partial<Pick<CodexSuggestion, "aspect" | "form" | "after" | "entry_name">>;

/**
 * Where a suggestion's claim comes from, as the card labels it. Every quote was checked against its source when the
 * suggestion was saved (a chapter reading's against the chapter, a Flesh out's
 * against the chapters so far), but that only proves the words are there: a quote that shares no word with the claim
 * is labelled "Quote doesn't show this" for the owner to read. A Flesh out without a quote is the AI's own idea.
 */
export function suggestionSource(s: Sourced): { tone: SourceTone; label: string } {
  if (s.kind === "conflict") return { tone: "conflict", label: "Contradicts the codex" };
  if (s.source === "expand" && !s.quote) return { tone: "invented", label: "AI idea · not in the text" };
  const claim = [s.aspect, cleanForm(s.form ?? ""), s.after].filter(Boolean).join(" ");
  if (s.kind !== "entry" && s.kind !== "retire" && claim && s.quote && !quoteSupports(s.quote, claim, s.entry_name ? [s.entry_name] : []))
    return { tone: "unsure", label: "Quote doesn't show this" };
  if (s.source === "expand") return { tone: "story", label: "From the story" };
  return { tone: "text", label: "From the text" };
}

/** What "Accept all" takes: open fact changes backed by the text, never the AI's own ideas or a conflict. */
export const acceptableInBulk = (s: CodexSuggestion) =>
  s.status === "open" && s.kind !== "conflict" && s.kind !== "entry" && !s.new_category && !["invented", "unsure"].includes(suggestionSource(s).tone);

/** The chapter's reading page, scrolled to the quote where the browser supports text fragments. */
export const quoteHref = (chapterId: string, quote: string) => `/c/${chapterId}#:~:text=${encodeURIComponent(quote.slice(0, 120))}`;

export function SourceBadge({ s }: { s: Sourced & { new_category?: boolean } }) {
  const { tone, label } = suggestionSource(s);
  return (
    <>
      <span className={`source-badge source-${tone}`}>{label}</span>
      {s.new_category && (
        <span className="source-badge source-new-category" title="This category isn't on your list in Settings → Codex. Accepting adds it to this entry.">
          New category: {s.aspect}
        </span>
      )}
    </>
  );
}

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

/**
 * The suggestions of a story (or one chapter, or those that apply on a path, or one entry) and what can be done with them:
 * accept (optionally edited), dismiss, reopen. Both the inbox list and the Story Bible's entry cards use it.
 */
export function useCodexInbox({ storyId, chapterId, onPath, onChanged: onAnyChange }: Pick<Props, "storyId" | "chapterId" | "onPath"> & { onChanged?: () => void }) {
  const pathKey = onPath?.chapterIds.join(",") ?? null;
  const onChanged = onPath?.onChanged ?? onAnyChange;
  const onEntry = onPath?.entryId ?? null;
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
          const ids = pathKey === null ? null : new Set(pathKey.split(","));
          setItems(ids ? list.filter((s) => ids.has(s.chapter_id) && (onEntry === null || s.entry_id === onEntry)) : list);
          setLoadError("");
        },
        (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
      ),
    [storyId, chapterId, pathKey, onEntry],
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
      onChanged?.();
    });
  const dismiss = (s: CodexSuggestion) =>
    run(s.id, async () => {
      await post(`/api/codex-suggestions/${s.id}/dismiss`);
      touch(s.id);
      setStatus(s.id, "dismissed");
      onChanged?.();
    });
  const reopen = (s: CodexSuggestion) =>
    run(s.id, async () => {
      await post(`/api/codex-suggestions/${s.id}/reopen`);
      touch(s.id);
      setStatus(s.id, "open");
      onChanged?.();
    });

  const shown = useMemo(() => (items ?? []).filter((s) => s.status === "open" || touched.has(s.id)), [items, touched]);
  const dismissedList = useMemo(() => (items ?? []).filter((s) => s.status === "dismissed" && !touched.has(s.id)), [items, touched]);

  async function acceptAll(list: CodexSuggestion[]) {
    for (const s of list) {
      if (!(await accept(s))) break;
    }
  }

  return { items, loadError, shown, dismissedList, errors, busy, editing, setEditing, showDismissed, setShowDismissed, accept, dismiss, reopen, acceptAll };
}

/** The dismissed suggestions of a list, behind a "Show dismissed" button, each with Reopen. */
export function DismissedList({
  list,
  busy,
  errors,
  open,
  onToggle,
  onReopen,
  showEntry = true,
}: {
  list: CodexSuggestion[];
  busy: Set<string>;
  errors: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onReopen: (s: CodexSuggestion) => void;
  showEntry?: boolean;
}) {
  if (list.length === 0) return null;
  return (
    <>
      <button type="button" className="secondary" aria-expanded={open} onClick={onToggle}>
        {open ? "Hide dismissed" : `Show dismissed (${list.length})`}
      </button>
      {open && (
        <ul className="inbox-dismissed">
          {list.map((s) => (
            <li key={s.id} className="inbox-done">
              <span>
                {showEntry && <strong>{s.entry_name || "An entry"} </strong>}
                {s.aspect && <>{s.aspect}: </>}
                {s.kind === "retire" ? "remove" : `“${afterText(s)}”`}
              </span>
              <button type="button" className="secondary" disabled={busy.has(s.id)} onClick={() => onReopen(s)}>
                Reopen
              </button>
              {errors[s.id] && <span className="error">{errors[s.id]}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export type CardProps = {
  s: CodexSuggestion;
  busy: boolean;
  error?: string;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onAccept: (edits?: Edits) => void;
  onDismiss: () => void;
  onReopen: () => void;
  /** Shown inside the entry's own card, which already names it. */
  inEntry?: boolean;
};

export function Card({ s, busy, error, editing, onEdit, onAccept, onDismiss, onReopen, inEntry }: CardProps) {
  const [aspect, setAspect] = useState(s.kind === "form" ? s.form : s.aspect);
  const [text, setText] = useState(s.after);

  const what = [s.entry_name || "the entry", s.kind === "form" ? "form" : s.aspect].filter(Boolean).join(", ");
  if (s.status === "accepted") {
    return (
      <p className="inbox-done">
        <span>
          Saved: <strong>{what}</strong> <span className="meta">at “{s.chapter_title}”</span>
        </span>
      </p>
    );
  }
  if (s.status === "dismissed") {
    return (
      <div className="inbox-done">
        <span>
          Dismissed <span className="meta">({what})</span>
        </span>
        <button type="button" className="secondary" disabled={busy} onClick={onReopen}>
          Undo
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    );
  }

  const segments = s.kind === "entry" ? [] : wordDiff(s.before, s.kind === "retire" ? "" : afterText(s));
  const moved = s.kind !== "entry" && s.current !== s.before;
  const conflict = s.kind === "conflict";
  const tone = suggestionSource(s).tone;
  return (
    <article className={`card inbox-card inbox-tone-${tone}`}>
      <div className="inbox-head">
        {!inEntry && <strong>{s.entry_name || "An entry"}</strong>}
        {s.kind !== "entry" && s.kind !== "form" && <strong className="inbox-aspect">{s.aspect || "General"}</strong>}
        <span className="meta">
          {[kindLabel(s).toLowerCase(), s.kind === "form" ? "" : cleanForm(s.form) ? `${cleanForm(s.form)} form` : ""].filter(Boolean).join(" · ")}
        </span>
        <SourceBadge s={s} />
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

      {s.quote ? (
        <blockquote className="inbox-evidence">
          {tone === "unsure" && <span className="inbox-unsure">The AI quoted this, but it doesn&apos;t mention what the fact says. Read it before accepting.</span>}
          “{s.quote}”
          {s.source === "chapter" && (
            <span className="inbox-evidence-where">
              <a href={quoteHref(s.chapter_id, s.quote)} target="_blank" rel="noreferrer">
                Show in “{s.chapter_title}”
              </a>
            </span>
          )}
          {s.source === "expand" && <span className="inbox-evidence-where">From the chapters so far</span>}
        </blockquote>
      ) : (
        tone === "invented" && <p className="inbox-invented">The AI made this up when you used Flesh out; nothing in the story says it. “Accept the … from the text” leaves it out.</p>
      )}
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
