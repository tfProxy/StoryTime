"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changedFields, DRAFT_ANCHOR, ENTRY_TYPES, entryHistory, type CodexEntry, type CodexOp, type EntryType } from "@/lib/codex";
import type { PathChapter } from "@/lib/ai/codexAi";
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

/**
 * Saving an entry's details and the ⋯ menu's actions (share, remove from one chapter, retire), for the entry page and
 * the writing desk. `change` saves through `save` (default: posted at `chapterId`, then the page refreshes).
 */
export function useEntryActions({
  entry,
  chapterId,
  storyId,
  save,
  onRetired,
}: {
  entry: CodexEntry;
  chapterId: string;
  storyId?: string;
  save?: EntrySave;
  onRetired?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  /** Makes the entry a shared one, as it reads at `here`. */
  async function share(here: string) {
    if (!window.confirm(`Add “${entry.name}” to the shared codex, as it reads at “${here}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: chapterId, entry_id: entry.entry_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `Request failed (${res.status})`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Takes the entry out of this chapter only; it stays, facts and all, in each chapter written after it. */
  async function removeHere(here: string, after: { id: string }[]) {
    if (!window.confirm(`Remove “${entry.name}” from “${here}” only? It stays in the chapters after it.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex/remove-here", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entry.entry_id, chapter_id: chapterId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? `Request failed (${res.status})`);
      const keptIn: string[] = Array.isArray(data.kept_in) ? data.kept_in : [];
      if (onRetired) onRetired();
      else router.push(`/s/${storyId}/codex/${entry.entry_id}?at=${keptIn[0] ?? after[0]?.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    if (!window.confirm(`Retire “${entry.name}” from this chapter onward? Earlier chapters keep it.`)) return;
    if (await change({ op: "retire", entry_id: entry.entry_id })) (onRetired ?? (() => router.push(storyId ? `/s/${storyId}/review?tab=codex&chapter=${chapterId}` : `/c/${chapterId}`)))();
  }

  return { busy, error, setError, change, replace, share, removeHere, retire };
}

/** The entry's versions, newest first, each with Restore. */
export function EntryHistoryList({
  entry,
  ops,
  titleOf,
  busy,
  replace,
}: {
  entry: CodexEntry;
  ops: CodexOp[];
  titleOf: (chapterId: string) => string;
  busy: boolean;
  replace: (patch: Partial<EntryFields>) => Promise<boolean>;
}) {
  const hist = entryHistory(ops, entry.entry_id);
  return (
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
            {v.moved_from_chapter_id && <div className="meta" style={{ margin: 0 }}>Moved start from “{v.moved_from_title ?? "a deleted chapter"}” to “{titleOf(v.anchor_chapter_id)}”</div>}
            {v.op !== "retire" && (
              <>
                <div className="version">
                  <strong>{v.name}</strong> [{v.type}]
                  {v.aliases.length > 0 && <div className="meta">Keywords: {v.aliases.join(", ")}</div>}
                </div>
                {!isCurrent && (
                  <button type="button" className="secondary" disabled={busy} onClick={() => replace({ name: v.name, type: v.type, aliases: v.aliases, always_include: v.always_include })}>
                    Restore this version
                  </button>
                )}
              </>
            )}
          </li>
        );
      })}
    </ol>
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
  anchorPath = path,
  chapterId,
  inDraft,
  editingChapter = false,
  keywordSources,
  saved,
  onSave,
  onCancel,
  startName = "",
}: {
  /** The name a new entry starts with. */
  startName?: string;
  initial: CodexEntry | null;
  busy: boolean;
  path: PathChapter[];
  /** The chapters offered under "Takes effect from" (default `path`). */
  anchorPath?: PathChapter[];
  chapterId: string;
  inDraft: boolean;
  /** The draft edits an existing chapter, so held changes are saved when it is saved. */
  editingChapter?: boolean;
  /** Where each of the entry's keywords was added, to show the inherited ones. */
  keywordSources?: CodexEntry["keywordSources"];
  /** Shows "Saved" beside the button. */
  saved?: boolean;
  onSave: (f: { name: string; type: EntryType; aliases: string[]; always_include: boolean }, anchor: string) => void;
  /** With it, the form is a pop-up form with Cancel; without it (for an existing entry) it is always on the page and Save waits for a change. */
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? startName);
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
        <ChapterPathPicker path={anchorPath} currentId={chapterId} value={anchorId} onChange={setAnchorId} draft={inDraft} editing={editingChapter} />
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
