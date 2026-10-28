"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  changedFields,
  DRAFT_ANCHOR,
  ENTRY_TYPES,
  entryHistory,
  isDraftEntry,
  TYPE_LABELS,
  type CodexChange,
  type CodexEntry,
  type CodexOp,
  type EntryType,
  type FactOp,
} from "@/lib/codex";
import type { AiRun, NotesTask } from "@/lib/aiRuns/types";
import type { PathChapter } from "@/lib/ai/codexAi";
import AiRunProgress from "./AiRunProgress";
import { INBOX_CHANGED } from "./CodexInbox";
import CodexFacts from "./CodexFacts";

export type EntryFields = { name: string; type: EntryType; aliases: string[]; content: string; always_include: boolean };
/** A change to an entry. `anchor` is the chapter it takes effect from; without it, the editor's own default applies. */
export type EntryChange = { op: CodexOp["op"]; entry_id?: string; anchor?: string } & Partial<EntryFields>;
/** Saves an entry change; resolves to an error message, or null when it was saved. */
export type EntrySave = (change: EntryChange) => Promise<string | null>;

// The same limits as the server's (`CODEX_LIMITS` in codexDb, which the browser can't import).
const CODEX_LIMITS = { name: 100, content: 8000 };
const when = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const keywordsOf = (text: string) => text.split(",").map((a) => a.trim()).filter(Boolean);

type Props = {
  entry: CodexEntry;
  /** Every entry op on the path to `chapterId` (a draft's held changes included), for the history. */
  ops: CodexOp[];
  facts: FactOp[];
  /** The chapters from the story's first to `chapterId`. */
  path: PathChapter[];
  /** The chapter the entry is viewed and edited at. */
  chapterId: string;
  storyId?: string;
  usedAspects: string[];
  /** The entry's picture at this chapter, and the page that makes pictures (absent where leaving the page would lose work). */
  pictureId?: string | null;
  picturesHref?: string | null;
  /** "page" for the entry's own page, "drawer" inside the writing page's drawer (changes are held in the draft). */
  variant?: "page" | "drawer";
  /** How entry-detail and notes changes are saved; the default posts them at `chapterId` and refreshes the page. */
  save?: EntrySave;
  /** The change this entry has waiting in the draft, and a way to drop it. */
  held?: CodexChange;
  onDiscardHeld?: () => void;
  /** Called after the entry is retired; the default goes to the chapter's codex. */
  onRetired?: () => void;
  /** Called after a fact is saved; the default refreshes the page. */
  onFactsSaved?: () => void;
  /** How many open suggestions in the inbox are about this entry. */
  waiting?: number;
};

/** The one place to read and change a codex entry: its details, keywords, form, facts, notes and history. */
export default function CodexEntryEditor({
  entry,
  ops,
  facts,
  path,
  chapterId,
  storyId,
  usedAspects,
  pictureId,
  picturesHref,
  variant = "page",
  save,
  held,
  onDiscardHeld,
  onRetired,
  onFactsSaved,
  waiting = 0,
}: Props) {
  const router = useRouter();
  const inDraft = variant === "drawer";
  const draftOnly = isDraftEntry(entry.entry_id);
  const [details, setDetails] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [notesMessage, setNotesMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [starting, setStarting] = useState(false);

  const titleOf = (id: string) => (id === DRAFT_ANCHOR ? "this chapter (not posted yet)" : (path.find((p) => p.id === id)?.title ?? "an earlier chapter"));
  const hist = entryHistory(ops, entry.entry_id);
  const refreshed = onFactsSaved ?? (() => router.refresh());
  const H = variant === "page" ? "h1" : "h2";

  async function defaultSave({ anchor, ...change }: EntryChange): Promise<string | null> {
    try {
      const res = await fetch("/api/codex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: anchor ?? chapterId, ...change }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error ?? `Request failed (${res.status})`;
      router.refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  async function change(c: EntryChange): Promise<boolean> {
    setBusy(true);
    setError(null);
    const problem = await (save ?? defaultSave)(c);
    setBusy(false);
    if (problem) setError(problem);
    return !problem;
  }

  const fields = (): EntryFields => ({ name: entry.name, type: entry.type, aliases: entry.aliases, content: entry.content, always_include: entry.always_include });
  const replace = (patch: Partial<EntryFields>, anchor?: string) => change({ op: "replace", entry_id: entry.entry_id, anchor, ...fields(), ...patch });

  async function turnNotesIntoFacts() {
    if (!storyId) return;
    setNotesMessage(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/stories/${storyId}/notes-to-facts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter_id: chapterId, entry_ids: [entry.entry_id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't start (${res.status})`);
      if (typeof data.run_id !== "string") setNotesMessage({ ok: false, text: "There are no notes to read." });
      else setRunId(data.run_id);
    } catch (e) {
      setNotesMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }

  function notesRunFinished(run: AiRun) {
    const tasks = run.tasks.filter((t): t is NotesTask => t.kind === "notes");
    const failed = tasks.filter((t) => t.status === "failed").length;
    const found = tasks.reduce((sum, t) => sum + (t.found ?? 0), 0);
    if (failed > 0) setNotesMessage({ ok: false, text: "The notes could not be read. Try again." });
    else setNotesMessage({ ok: true, text: found === 0 ? "Nothing to suggest: the facts already cover the notes." : `Left ${found} suggestion${found === 1 ? "" : "s"} in the codex inbox.` });
    window.dispatchEvent(new Event(INBOX_CHANGED));
    router.refresh();
  }

  const inboxHref = storyId ? `/s/${storyId}/review?tab=codex&chapter=${entry.op.anchor_chapter_id}` : null;

  return (
    <div className="entry-editor">
      <div className="entry-head">
        {pictureId && storyId && picturesHref && (
          <Link href={picturesHref} title={`The picture of ${entry.name} as of this chapter`} className="codex-thumb-link">
            {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
            <img className="codex-thumb" src={`/api/stories/${storyId}/codex-pictures/${pictureId}`} alt={`Picture of ${entry.name}`} />
          </Link>
        )}
        {pictureId && storyId && !picturesHref && (
          // eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size
          <img className="codex-thumb" src={`/api/stories/${storyId}/codex-pictures/${pictureId}`} alt={`Picture of ${entry.name}`} />
        )}
        <div className="entry-head-text">
          <H style={{ margin: 0 }}>{entry.name}</H>
          <div className="meta" style={{ margin: 0 }}>
            {TYPE_LABELS[entry.type]}
            {entry.always_include && <span className="tag"> · always included</span>}
            {held && <span className="tag"> · {held.op === "create" ? "new" : "changed"} in this chapter, saved when you post</span>}
          </div>
        </div>
        <div className="row entry-head-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => setDetails(!details)}>
            Edit details
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Retire “${entry.name}” from this chapter onward? Earlier chapters keep it.`)) return;
              if (await change({ op: "retire", entry_id: entry.entry_id })) (onRetired ?? (() => router.push(`/c/${chapterId}/codex`)))();
            }}
          >
            Retire
          </button>
          {picturesHref && (
            <Link className="button secondary" href={picturesHref}>
              Pictures
            </Link>
          )}
          {held && onDiscardHeld && (
            <button type="button" className="secondary" disabled={busy} onClick={onDiscardHeld}>
              {held.op === "create" ? "Delete" : "Undo change"}
            </button>
          )}
        </div>
      </div>
      <p className="entry-keywords">
        <strong>Keywords:</strong> {entry.aliases.length > 0 ? entry.aliases.join(", ") : "none yet"}
        <span className="meta"> Words in the story that bring this entry into the AI&apos;s prompt.</span>
      </p>
      {error && <p className="error">{error}</p>}

      {details && (
        <EntryDetailsForm
          initial={entry}
          busy={busy}
          path={path}
          chapterId={chapterId}
          inDraft={inDraft}
          onCancel={() => setDetails(false)}
          onSave={async (f, anchor) => {
            if (await replace(f, anchor)) setDetails(false);
          }}
        />
      )}

      {draftOnly ? (
        <section className="entry-section">
          <h2>Facts</h2>
          <p className="meta">Post the chapter to add facts.</p>
        </section>
      ) : (
        <CodexFacts entry={entry} factOps={facts} path={path} chapterId={chapterId} usedAspects={usedAspects} onSaved={refreshed} />
      )}

      <section className="entry-section">
        <h2>What the AI reads</h2>
        <div className="fact-ai">{entry.description || <em>Nothing yet — add facts. Notes are not sent to the AI.</em>}</div>
      </section>

      <section className="entry-section">
        <h2>Your notes (not sent to the AI)</h2>
        {notes === null ? (
          <>
            {entry.content ? <p className="entry-notes">{entry.content}</p> : <p className="meta">No notes.</p>}
            <div className="row">
              <button type="button" className="secondary" disabled={busy} onClick={() => setNotes(entry.content)}>
                Edit
              </button>
              {entry.content && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Clear the notes of “${entry.name}”?`)) void replace({ content: "" });
                  }}
                >
                  Clear
                </button>
              )}
              {entry.content && storyId && !inDraft && !draftOnly && (
                <button type="button" disabled={busy || starting || runId !== null} onClick={turnNotesIntoFacts}>
                  {starting ? "Starting…" : "Turn notes into facts"}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="fact-form">
            <label>
              Notes
              <textarea
                aria-label="Notes"
                rows={6}
                value={notes}
                maxLength={CODEX_LIMITS.content}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <div className="row">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await replace({ content: notes.trim() })) setNotes(null);
                }}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setNotes(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {notesMessage && <p className={notesMessage.ok ? "ok" : "error"}>{notesMessage.text}</p>}
        {runId && <AiRunProgress key={runId} runId={runId} onFinished={notesRunFinished} />}
        {runId && inboxHref && (
          <p className="meta">
            <Link href={inboxHref}>Open the codex inbox</Link>
          </p>
        )}
      </section>

      {waiting > 0 && storyId && (
        <p className="notice">
          {waiting} suggestion{waiting === 1 ? "" : "s"} waiting for {entry.name} · <Link href={`/s/${storyId}/review?tab=codex`}>Review</Link>
        </p>
      )}

      <details className="entry-history">
        <summary>History ({hist.length})</summary>
        <ol className="history">
          {[...hist].reverse().map((v, idx, arr) => {
            const prev = arr[idx + 1];
            const isCurrent = v.id === entry.op.id;
            return (
              <li key={v.id}>
                <div className="meta" style={{ margin: 0 }}>
                  <strong>{v.op === "retire" ? "Retired" : prev ? "Changed" : "Created"}</strong> in “{titleOf(v.anchor_chapter_id)}” ·{" "}
                  {v.anchor_chapter_id === DRAFT_ANCHOR ? "saved when you post" : when(v.posted_at)}
                  {prev && v.op !== "retire" && ` · ${changedFields(prev, v).join(", ") || "no changes"}`}
                  {isCurrent && " · current"}
                </div>
                {v.op !== "retire" && (
                  <>
                    <div className="version">
                      <strong>{v.name}</strong> [{v.type}]
                      {v.aliases.length > 0 && <div className="meta">Keywords: {v.aliases.join(", ")}</div>}
                      {v.content && <div style={{ whiteSpace: "pre-wrap" }}>{v.content}</div>}
                    </div>
                    {!isCurrent && (
                      <button type="button" className="secondary" disabled={busy} onClick={() => replace({ name: v.name, type: v.type, aliases: v.aliases, content: v.content, always_include: v.always_include })}>
                        Restore this version
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}

/**
 * The form for an entry's name, type and keywords. For a new entry (`initial` null) that is all it asks;
 * for an existing one it adds "Always include" and the chapter the change takes effect from.
 */
export function EntryDetailsForm({
  initial,
  busy,
  path,
  chapterId,
  inDraft,
  onSave,
  onCancel,
}: {
  initial: CodexEntry | null;
  busy: boolean;
  path: PathChapter[];
  chapterId: string;
  inDraft: boolean;
  onSave: (f: { name: string; type: EntryType; aliases: string[]; always_include: boolean }, anchor: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<EntryType>(initial?.type ?? "character");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [always, setAlways] = useState(initial?.always_include ?? false);
  const [anchorId, setAnchorId] = useState(inDraft ? DRAFT_ANCHOR : chapterId);
  return (
    <form
      className="fact-form entry-details-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: name.trim(), type, aliases: keywordsOf(aliases), always_include: always }, anchorId);
      }}
    >
      <label>
        Name
        <input required value={name} maxLength={CODEX_LIMITS.name} onChange={(e) => setName(e.target.value)} />
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
      <label>
        Keywords <small>(comma-separated: words in the story that bring the entry into the AI&apos;s prompt)</small>
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </label>
      {initial && (
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} style={{ width: "auto" }} />
          Always include in AI prompts <small>(otherwise only when a keyword or the name appears nearby)</small>
        </label>
      )}
      {initial && (inDraft || path.length > 1) && (
        <label>
          Takes effect from{" "}
          <small>
            {inDraft
              ? "(the chapter you're writing, or an earlier one if it changed before; an earlier chapter is saved now and reaches every branch below it)"
              : "(that chapter and everything after it on this branch)"}
          </small>
          <select value={anchorId} onChange={(e) => setAnchorId(e.target.value)}>
            {inDraft && <option value={DRAFT_ANCHOR}>This chapter (saved when you post it)</option>}
            {path.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {inDraft ? " (saved now)" : c.id === chapterId ? " (this chapter)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add entry"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
