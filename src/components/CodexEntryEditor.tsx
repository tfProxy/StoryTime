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
import ChapterPathPicker from "./ChapterPathPicker";

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
  /** The chapters already written after `chapterId`: "Remove from this chapter only" keeps the entry in them. */
  after?: { id: string; title: string }[];
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
  after = [],
}: Props) {
  const router = useRouter();
  const inDraft = variant === "drawer";
  const draftOnly = isDraftEntry(entry.entry_id);
  const [savedNote, setSavedNote] = useState(false);
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

  const here = titleOf(chapterId);

  /** Takes the entry out of this chapter only; it stays, facts and all, in each chapter written after it. */
  async function removeHere(): Promise<{ error?: string; keptIn: string[] }> {
    try {
      const res = await fetch("/api/codex/remove-here", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entry.entry_id, chapter_id: chapterId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error ?? `Request failed (${res.status})`, keptIn: [] };
      router.refresh();
      return { keptIn: Array.isArray(data.kept_in) ? data.kept_in : [] };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), keptIn: [] };
    }
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
      {error && <p className="error">{error}</p>}

      <section className="entry-section">
        <h2>Details</h2>
        <EntryDetailsForm
          key={[entry.op.id, entry.name, entry.type, entry.aliases.join("\n"), entry.always_include].join("|")}
          initial={entry}
          busy={busy}
          path={path}
          chapterId={chapterId}
          inDraft={inDraft}
          keywordSources={entry.keywordSources}
          saved={savedNote}
          onSave={async (f, anchor) => {
            if (await replace(f, anchor)) {
              setSavedNote(true);
              setTimeout(() => setSavedNote(false), 4000);
            }
          }}
        />
      </section>

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
        <section className="entry-section">
          <h2>Suggestions waiting</h2>
          <p style={{ margin: 0 }}>
            {waiting} suggestion{waiting === 1 ? "" : "s"} waiting for {entry.name} · <Link href={`/s/${storyId}/review?tab=codex`}>Review</Link>
          </p>
        </section>
      )}

      <section className="entry-section">
        <h2>History</h2>
      <details className="entry-history">
        <summary>{hist.length} version{hist.length === 1 ? "" : "s"}</summary>
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
      </section>

      <section className="entry-section entry-remove">
        <h2>Remove</h2>
        {/* Not in the writing drawer: the chapter being written isn't saved yet, so it would lose the entry too. */}
        {!draftOnly && !inDraft && (
        <div className="entry-remove-option">
          <button
            type="button"
            className="secondary"
            disabled={busy || after.length === 0}
            onClick={async () => {
              if (!window.confirm(`Remove “${entry.name}” from “${here}” only? It stays in the chapters after it.`)) return;
              setBusy(true);
              setError(null);
              const problem = await removeHere();
              setBusy(false);
              if (problem.error) return setError(problem.error);
              if (onRetired) onRetired();
              else router.push(`/s/${storyId}/codex/${entry.entry_id}?at=${problem.keptIn[0] ?? after[0]?.id}`);
            }}
          >
            Remove from this chapter only
          </button>
          <p className="meta">
            {after.length > 0
              ? `${entry.name} stays in the ${after.length === 1 ? "chapter" : `${after.length} chapters`} after “${here}”.`
              : "No chapter has been written after this one, so there is nothing to keep it in. Use Retire from here on."}
          </p>
        </div>
        )}
        <div className="entry-remove-option">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Retire “${entry.name}” from this chapter onward? Earlier chapters keep it.`)) return;
              if (await change({ op: "retire", entry_id: entry.entry_id })) (onRetired ?? (() => router.push(`/c/${chapterId}/codex`)))();
            }}
          >
            Retire from here on
          </button>
          <p className="meta">Gone from “{here}” and every chapter after it. Earlier chapters keep it.</p>
        </div>
      </section>
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
  keywordSources,
  saved,
  onSave,
  onCancel,
}: {
  initial: CodexEntry | null;
  busy: boolean;
  path: PathChapter[];
  chapterId: string;
  inDraft: boolean;
  /** Where each of the entry's keywords was added, to show the inherited ones. */
  keywordSources?: CodexEntry["keywordSources"];
  /** Shows "Saved" beside the button. */
  saved?: boolean;
  onSave: (f: { name: string; type: EntryType; aliases: string[]; always_include: boolean }, anchor: string) => void;
  /** With it, the form is a pop-up form with Cancel; without it (for an existing entry) it is always on the page and Save waits for a change. */
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<EntryType>(initial?.type ?? "character");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [always, setAlways] = useState(initial?.always_include ?? false);
  const [anchorId, setAnchorId] = useState(inDraft ? DRAFT_ANCHOR : chapterId);
  const flat = Boolean(initial && !onCancel);
  const parsed = keywordsOf(aliases);
  const dirty =
    !initial ||
    name.trim() !== initial.name ||
    type !== initial.type ||
    always !== initial.always_include ||
    parsed.join("\n") !== initial.aliases.join("\n");
  const sourceOf = (alias: string) => {
    const from = keywordSources?.find((k) => k.alias === alias)?.chapter_id;
    return from && from !== chapterId && from !== DRAFT_ANCHOR ? path.find((p) => p.id === from)?.title : undefined;
  };
  // The saved keywords that came from an earlier chapter (the box shows all of them, but not where they came from).
  const inherited = (initial?.aliases ?? []).flatMap((alias) => {
    const from = sourceOf(alias);
    return from ? [{ alias, from }] : [];
  });
  return (
    <form
      className={flat ? "entry-details-form flat fact-form" : "fact-form entry-details-form"}
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
        Keywords
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        <small>comma-separated; words in the story that bring this entry into the AI&apos;s prompt</small>
      </label>
      {inherited.length > 0 && (
        <p className="entry-keywords meta">
          Inherited:{" "}
          {inherited.map(({ alias, from }, i) => (
            <span key={alias}>
              {i > 0 && ", "}
              {alias} <span className="kw-from">(from “{from}”)</span>
            </span>
          ))}
        </p>
      )}
      {initial && (
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} style={{ width: "auto" }} />
          <span>
            Always include in AI prompts <small>(otherwise only when a keyword or the name appears nearby)</small>
          </span>
        </label>
      )}
      {initial && (inDraft || path.length > 1) && (
        <ChapterPathPicker path={path} currentId={chapterId} value={anchorId} onChange={setAnchorId} draft={inDraft} />
      )}
      <div className="row">
        <button type="submit" disabled={busy || !name.trim() || !dirty}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add entry"}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        {saved && !dirty && (
          <span className="ok" role="status">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
