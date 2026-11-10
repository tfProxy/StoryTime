"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CodexSuggestion } from "@/lib/codexSuggestions";
import { isFormAspect, type LiveFact } from "@/lib/codex";
import { wordDiff } from "@/lib/wordDiff";
import EntryFold from "./EntryFold";
import MoreMenu from "./MoreMenu";

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

export type SourceTone = "text" | "story" | "notes" | "invented" | "conflict";

/**
 * Where a suggestion's claim comes from, as the card labels it. Every quote was checked against its source when the
 * suggestion was saved: a chapter reading's against the chapter, a notes reading's against the notes, a Flesh out's
 * (when it stayed close to the story) against the chapters so far. A Flesh out without a quote is the AI's own idea.
 */
export function suggestionSource(s: Pick<CodexSuggestion, "kind" | "source" | "quote">): { tone: SourceTone; label: string } {
  if (s.kind === "conflict") return { tone: "conflict", label: "Contradicts the codex" };
  if (s.source === "notes") return { tone: "notes", label: "From your notes" };
  if (s.source === "expand") return s.quote ? { tone: "story", label: "From the story" } : { tone: "invented", label: "AI idea · not in the text" };
  return { tone: "text", label: "From the text" };
}

/** What "Accept all" takes: open fact changes backed by the text or the notes, never the AI's own ideas or a conflict. */
export const acceptableInBulk = (s: CodexSuggestion) =>
  s.status === "open" && s.kind !== "conflict" && s.kind !== "entry" && suggestionSource(s).tone !== "invented";

/** The chapter's reading page, scrolled to the quote where the browser supports text fragments. */
export const quoteHref = (chapterId: string, quote: string) => `/c/${chapterId}#:~:text=${encodeURIComponent(quote.slice(0, 120))}`;

export function SourceBadge({ s }: { s: Pick<CodexSuggestion, "kind" | "source" | "quote"> }) {
  const { tone, label } = suggestionSource(s);
  return <span className={`source-badge source-${tone}`}>{label}</span>;
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

/**
 * An entry's page at a chapter: "Review changes", a fold with the suggestions for the entry made at that chapter, and a
 * link to each earlier chapter on the branch that still has some (the review happens at the chapter it belongs to).
 */
export default function CodexInbox({
  storyId,
  entryId,
  entryName,
  path,
  applied = [],
  onChanged,
}: {
  storyId: string;
  entryId: string;
  entryName: string;
  /** Root to the chapter the page is at (the last one). */
  path: { id: string; title: string }[];
  /** Facts the AI applied on its own at this chapter ("Apply the AI's codex changes automatically"), not yet approved. */
  applied?: LiveFact[];
  onChanged?: () => void;
}) {
  const here = path[path.length - 1];
  const live = useCodexInbox({ storyId, onPath: { chapterIds: path.map((c) => c.id), entryId, onChanged } });
  const { items, loadError, shown, dismissedList, errors, busy, editing, setEditing, showDismissed, setShowDismissed, accept, dismiss, reopen, acceptAll } = live;
  const [appliedBusy, setAppliedBusy] = useState(false);
  const [appliedError, setAppliedError] = useState("");
  // Whether the fold is open: null until the owner toggles it or it first opens by itself, so it doesn't fold away
  // under them when they decide the last suggestion.
  const [foldOpen, setFoldOpen] = useState<boolean | null>(null);

  /** Approve (keep as the owner's) or undo (take back) facts the AI applied, by fact-change id. */
  async function decide(action: "approve" | "undo-ai", ids: string[]) {
    setAppliedBusy(true);
    setAppliedError("");
    try {
      await post(`/api/codex/${action}`, { ids });
      onChanged?.();
      // An undo dismisses the suggestion behind the fact: read the list again so it shows under "Show dismissed".
      if (action === "undo-ai") window.dispatchEvent(new Event(INBOX_CHANGED));
    } catch (e) {
      setAppliedError(e instanceof Error ? e.message : String(e));
    } finally {
      setAppliedBusy(false);
    }
  }

  const atHere = shown.filter((s) => s.chapter_id === here?.id);
  const dismissedHere = dismissedList.filter((s) => s.chapter_id === here?.id);
  // Earlier chapters with suggestions still open, newest first: each is reviewed on this page at that chapter.
  const earlier = useMemo(() => {
    const out: { id: string; title: string; n: number }[] = [];
    for (const s of shown) {
      if (s.chapter_id === here?.id || s.status !== "open") continue;
      const c = out.find((x) => x.id === s.chapter_id);
      if (c) c.n++;
      else out.push({ id: s.chapter_id, title: s.chapter_title, n: 1 });
    }
    return out.reverse();
  }, [shown, here?.id]);

  if (items === null || !here) return null;
  const open = atHere.filter((s) => s.status === "open").length + applied.length;
  if (atHere.length === 0 && dismissedHere.length === 0 && earlier.length === 0 && applied.length === 0 && !loadError) return null;
  const bulk = atHere.filter(acceptableInBulk);
  const autoOpen = open > 0 || earlier.length > 0;
  if (foldOpen === null && autoOpen) setFoldOpen(true);

  return (
    <EntryFold
      title={`Review changes from “${here.title}”`}
      note={open > 0 ? `${open} waiting` : "none waiting"}
      open={foldOpen ?? autoOpen}
      onToggle={setFoldOpen}
      id="entry-review"
      className="codex-review"
    >
      {loadError && <p className="error">{loadError}</p>}
      {atHere.length === 0 && applied.length === 0 && <p className="meta">Nothing to review for {entryName} from this chapter.</p>}

      {applied.length > 0 && (
        <div className="codex-review-applied">
          <h3>Already applied by the AI</h3>
          <p className="meta">
            These are in the codex now. Approve to keep them as yours, or undo to put the fact back as it was. Until you approve them, the AI replaces them when
            it reads the chapter again.
          </p>
          {applied.map((f) => (
            <article key={f.op.id} className="card inbox-card inbox-text">
              <div className="inbox-head">
                <strong className="inbox-aspect">{isFormAspect(f.aspect) ? "Form" : f.aspect || "General"}</strong>
                {!isFormAspect(f.aspect) && f.form && <span className="meta">{f.form} form</span>}
                <SourceBadge s={{ kind: "set", source: "chapter", quote: f.quote }} />
              </div>
              <p className="inbox-diff">{isFormAspect(f.aspect) ? [f.form, f.text].filter(Boolean).join(", ") : f.text}</p>
              {f.quote && (
                <blockquote className="inbox-evidence">
                  “{f.quote}”
                  <span className="inbox-evidence-where">
                    <a href={quoteHref(here.id, f.quote)} target="_blank" rel="noreferrer">
                      Show in “{here.title}”
                    </a>
                  </span>
                </blockquote>
              )}
              <div className="inbox-actions">
                <button type="button" disabled={appliedBusy} onClick={() => void decide("approve", [f.op.id])}>
                  Approve
                </button>
                <button type="button" className="secondary" disabled={appliedBusy} onClick={() => void decide("undo-ai", [f.op.id])}>
                  Undo
                </button>
              </div>
            </article>
          ))}
          {appliedError && <p className="error">{appliedError}</p>}
          {applied.length > 1 && (
            <div className="codex-review-footer">
              <button type="button" className="secondary" disabled={appliedBusy} onClick={() => void decide("approve", applied.map((f) => f.op.id))}>
                Approve all {applied.length}
              </button>
            </div>
          )}
          {atHere.length > 0 && <h3>Waiting for you</h3>}
        </div>
      )}
      {atHere.map((s) => (
        <Card
          key={s.id}
          s={s}
          inEntry
          busy={busy.has(s.id)}
          error={errors[s.id]}
          editing={editing === s.id}
          onEdit={(on) => setEditing(on ? s.id : null)}
          onAccept={(edits) => void accept(s, edits)}
          onDismiss={() => void dismiss(s)}
          onReopen={() => void reopen(s)}
        />
      ))}

      {(bulk.length > 1 || dismissedHere.length > 0 || atHere.length > 0) && (
        <div className="codex-review-footer">
          {bulk.length > 1 && (
            <button type="button" className="secondary" disabled={bulk.some((s) => busy.has(s.id))} onClick={() => void acceptAll(bulk)}>
              Accept the {bulk.length} from the text
            </button>
          )}
          <DismissedList list={dismissedHere} busy={busy} errors={errors} open={showDismissed} onToggle={() => setShowDismissed((v) => !v)} onReopen={(s) => void reopen(s)} showEntry={false} />
          {atHere.length > 0 && (
            <MoreMenu label="More review actions">
              <Link href={`/ai-log?chapter=${encodeURIComponent(here.id)}`}>Show the AI exchange</Link>
            </MoreMenu>
          )}
        </div>
      )}

      {earlier.length > 0 && (
        <p className="meta codex-review-earlier">
          Also waiting for {entryName} from earlier chapters:{" "}
          {earlier.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " · "}
              <Link href={`/s/${storyId}/codex/${entryId}?at=${c.id}#entry-review`}>
                “{c.title}” ({c.n})
              </Link>
            </span>
          ))}
        </p>
      )}
    </EntryFold>
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
          {[kindLabel(s).toLowerCase(), s.kind === "form" ? "" : s.form ? `${s.form} form` : ""].filter(Boolean).join(" · ")}
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
          “{s.quote}”
          {s.source === "chapter" && (
            <span className="inbox-evidence-where">
              <a href={quoteHref(s.chapter_id, s.quote)} target="_blank" rel="noreferrer">
                Show in “{s.chapter_title}”
              </a>
            </span>
          )}
          {s.source === "notes" && <span className="inbox-evidence-where">From the entry&apos;s notes</span>}
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
