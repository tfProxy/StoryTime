"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addChange,
  changedFields,
  DRAFT_ANCHOR,
  draftOps,
  ENTRY_TYPES,
  entryHistory,
  foldCodex,
  isDraftEntry,
  retiredEntries,
  type CodexChange,
  type CodexEntry,
  type CodexOp,
  type EntryType,
} from "@/lib/codex";
import { useSettings } from "@/lib/settings";
import { draftEntry, entryRequest, type PathChapter, type StoryInfo } from "@/lib/ai/codexAi";
import CodexAiScan from "./CodexAiScan";
import PromptButton from "./PromptButton";

type PathItem = PathChapter;

type Props = {
  story: StoryInfo;
  /** Open the AI helper section initially (used right after posting a chapter). */
  openAiHelper?: boolean;
  /** Shown inside the writing page's drawer: no chapter timeline or AI scan, just the entries. */
  embedded?: boolean;
  /** Shown on the story's details page: the codex at the first chapter, which every branch shares. */
  storyWide?: boolean;
  /** Open with this entry's form showing ("new" for a new entry). */
  startEditing?: string | null;
  /** The chapter whose codex is being viewed; changes made here are anchored at it. */
  chapterId: string;
  path: PathItem[];
  /** Every op on the path from the story root to this chapter. */
  ops: CodexOp[];
  /**
   * Changes held in the draft of the next chapter. When given, changes are kept there by default
   * (and posted with the chapter); only changes anchored at an earlier chapter are saved straight away.
   */
  draft?: { changes: CodexChange[]; onChange: (next: CodexChange[]) => void };
};

type Fields = { name: string; type: EntryType; aliases: string[]; content: string; always_include: boolean };
type Change = { op: CodexOp["op"]; entry_id?: string; anchor?: string } & Partial<Fields>;

const when = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const localId = () => `draft-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export default function CodexPanel({ story, openAiHelper, embedded, storyWide, startEditing, chapterId, path, ops, draft }: Props) {
  const router = useRouter();
  const titleOf = (id: string) =>
    id === DRAFT_ANCHOR ? "this chapter (not posted yet)" : (path.find((p) => p.id === id)?.title ?? "an earlier chapter");

  const allOps = draft ? [...ops, ...draftOps(draft.changes, (path.at(-1)?.depth ?? -1) + 1)] : ops;
  const entries = foldCodex(allOps);
  const retired = retiredEntries(allOps);
  const pending = new Map((draft?.changes ?? []).map((c) => [c.entry_id, c]));
  const discard = (entryId: string) => draft?.onChange(draft.changes.filter((c) => c.entry_id !== entryId));

  // null = closed, "new" = creating, otherwise the entry being edited
  const [editing, setEditing] = useState<null | "new" | CodexEntry>(() =>
    startEditing === "new" ? "new" : (entries.find((e) => e.entry_id === startEditing) ?? null),
  );
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post({ anchor, ...change }: Change): Promise<boolean> {
    const at = anchor ?? (draft ? DRAFT_ANCHOR : chapterId);
    if (draft && at === DRAFT_ANCHOR) {
      const entryId = change.op === "create" ? localId() : change.entry_id!;
      const was = [...entries, ...retired].find((e) => e.entry_id === entryId);
      draft.onChange(
        addChange(draft.changes, {
          op: change.op,
          entry_id: entryId,
          name: change.name ?? was?.name ?? "",
          type: change.type ?? was?.type ?? "note",
          aliases: change.aliases ?? was?.aliases ?? [],
          content: change.content ?? was?.content ?? "",
          always_include: change.always_include ?? was?.always_include ?? false,
        }),
      );
      return true;
    }
    // An entry that only exists in the draft becomes a real one when it is saved to an earlier chapter.
    const body = change.entry_id && isDraftEntry(change.entry_id) ? { ...change, op: "create", entry_id: undefined } : change;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: at, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      // The saved version now holds what the form showed, so a held change to the same entry would only override it.
      if (change.entry_id) discard(change.entry_id);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // `f` may be a whole op or entry object, so copy only the content fields (never its own op/id).
  const restore = (f: Fields, entryId: string) =>
    post({
      op: "replace",
      entry_id: entryId,
      name: f.name,
      type: f.type,
      aliases: f.aliases,
      content: f.content,
      always_include: f.always_include,
    });

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {!embedded && !storyWide && (
      <nav className="timeline" aria-label="Chapters on this path">
        {path.map((p, i) => (
          <span key={p.id}>
            {i > 0 && " › "}
            {p.id === chapterId ? <strong>{p.title}</strong> : <Link href={`/c/${p.id}/codex`}>{p.title}</Link>}
          </span>
        ))}
      </nav>
      )}
      {draft ? (
        <p className="notice">
          Changes you make here belong to the chapter you&apos;re writing: the AI uses them straight away, and they are
          saved with the chapter when you post it, for it and the chapters after it. To record something that happened
          earlier, pick that chapter under &ldquo;Takes effect from&rdquo;; that is saved immediately and reaches every
          branch below it.
        </p>
      ) : storyWide ? (
        <p className="notice">
          Entries here apply to the whole story, on every branch, from the first chapter on. A later chapter can still
          change or retire one for its own branch; do that from that chapter&apos;s codex.
        </p>
      ) : (
        <p className="notice">
          This is the codex as of <strong>{titleOf(chapterId)}</strong>. Anything you add or change here takes effect from
          this chapter onward on this branch, and other branches never see it.
          {embedded
            ? " Use “Takes effect from” on an entry to record a change that happened earlier."
            : " To record a change that happened earlier, pick that chapter above first."}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {!embedded && <CodexAiScan story={story} chapterId={chapterId} path={path} ops={ops} defaultOpen={openAiHelper} />}

      {editing === null && (
        <div>
          <button type="button" onClick={() => setEditing("new")}>
            + New entry
          </button>
        </div>
      )}
      {editing !== null && (
        <EntryForm
          key={editing === "new" ? "new" : editing.op.id}
          initial={editing === "new" ? null : editing}
          busy={busy}
          story={story}
          chapterId={chapterId}
          path={path}
          entries={entries}
          inDraft={!!draft}
          onCancel={() => setEditing(null)}
          onSave={async (f, anchorId) => {
            const ok = await post(
              editing === "new"
                ? { op: "create", anchor: anchorId, ...f }
                : { op: "replace", entry_id: editing.entry_id, anchor: anchorId, ...f },
            );
            if (ok) setEditing(null);
          }}
        />
      )}

      {entries.length === 0 && editing === null && (
        <p className="meta">No entries yet at this point. Add characters, places or facts the story should remember.</p>
      )}

      {ENTRY_TYPES.map((type) => {
        const group = entries.filter((e) => e.type === type);
        if (group.length === 0) return null;
        return (
          <section key={type}>
            <h2 style={{ textTransform: "capitalize" }}>{type}s</h2>
            {group.map((e) => {
              const here = e.op.anchor_chapter_id === chapterId;
              const held = pending.get(e.entry_id);
              const hist = entryHistory(allOps, e.entry_id);
              return (
                <article key={e.entry_id} className="card">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <strong>{e.name}</strong>{" "}
                      {e.always_include && <span className="tag">· always included</span>}{" "}
                      {here && !draft && <span className="tag">· changed in this chapter</span>}
                      {held && (
                        <span className="tag">· {held.op === "create" ? "new" : "changed"} in this chapter, saved when you post</span>
                      )}
                      {e.aliases.length > 0 && <div className="meta">Also: {e.aliases.join(", ")}</div>}
                    </div>
                    <div className="row">
                      <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(e)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Retire “${e.name}” from this chapter onward? Earlier chapters keep it.`)) {
                            void post({ op: "retire", entry_id: e.entry_id });
                          }
                        }}
                      >
                        Retire
                      </button>
                      {held && (
                        <button type="button" className="secondary" disabled={busy} onClick={() => discard(e.entry_id)}>
                          {held.op === "create" ? "Delete" : "Undo change"}
                        </button>
                      )}
                    </div>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap", margin: "0.5rem 0" }}>{e.content || <em>(no description)</em>}</p>
                  <div className="meta" style={{ margin: 0 }}>
                    {hist.length > 1 || !here ? `Last changed in “${titleOf(e.op.anchor_chapter_id)}”` : "Created here"} ·{" "}
                    <button type="button" className="linkish" onClick={() => setHistoryOf(historyOf === e.entry_id ? null : e.entry_id)}>
                      {historyOf === e.entry_id ? "Hide history" : `History (${hist.length})`}
                    </button>
                  </div>
                  {historyOf === e.entry_id && (
                    <ol className="history">
                      {[...hist].reverse().map((v, idx, arr) => {
                        const prev = arr[idx + 1];
                        const isCurrent = v.id === e.op.id;
                        return (
                          <li key={v.id}>
                            <div className="meta" style={{ margin: 0 }}>
                              <strong>{v.op === "retire" ? "Retired" : prev ? "Changed" : "Created"}</strong> in “
                              {titleOf(v.anchor_chapter_id)}” ·{" "}
                              {v.anchor_chapter_id === DRAFT_ANCHOR ? "saved when you post" : when(v.posted_at)}
                              {prev && v.op !== "retire" && ` · ${changedFields(prev, v).join(", ") || "no changes"}`}
                              {isCurrent && " · current"}
                            </div>
                            {v.op !== "retire" && (
                              <>
                                <div className="version">
                                  <strong>{v.name}</strong> [{v.type}]
                                  <div style={{ whiteSpace: "pre-wrap" }}>{v.content}</div>
                                </div>
                                {!isCurrent && (
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={busy}
                                    onClick={() => restore(v, e.entry_id)}
                                  >
                                    Restore this version
                                  </button>
                                )}
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}

      {retired.length > 0 && (
        <section>
          <h2>Retired</h2>
          <p className="meta">Entries that no longer apply on this branch.</p>
          {retired.map((e) => (
            <div key={e.entry_id} className="card row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>{e.name}</strong> <span className="meta">[{e.type}]</span>
              </span>
              {pending.get(e.entry_id)?.op === "retire" ? (
                <button type="button" className="secondary" disabled={busy} onClick={() => discard(e.entry_id)}>
                  Undo retire
                </button>
              ) : (
                <button type="button" className="secondary" disabled={busy} onClick={() => restore(e, e.entry_id)}>
                  Bring back
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function EntryForm({
  initial,
  busy,
  story,
  chapterId,
  path,
  entries,
  inDraft,
  onSave,
  onCancel,
}: {
  inDraft: boolean;
  initial: CodexEntry | null;
  busy: boolean;
  story: StoryInfo;
  chapterId: string;
  path: PathItem[];
  entries: CodexEntry[];
  onSave: (f: Fields, anchorId: string) => void;
  onCancel: () => void;
}) {
  const settings = useSettings();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<EntryType>(initial?.type ?? "character");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [content, setContent] = useState(initial?.content ?? "");
  const [always, setAlways] = useState(initial?.always_include ?? false);
  const [anchorId, setAnchorId] = useState(inDraft ? DRAFT_ANCHOR : chapterId);

  // AI help
  const [direction, setDirection] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [beforeAi, setBeforeAi] = useState<Fields | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const current = (): Fields => ({
    name: name.trim(),
    type,
    aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
    content: content.trim(),
    always_include: always,
  });

  function applyFields(f: Fields) {
    setName(f.name);
    setType(f.type);
    setAliases(f.aliases.join(", "));
    setContent(f.content);
    setAlways(f.always_include);
  }

  /** What the AI is asked in each mode, from the form as it stands. */
  function aiOptions(mode: "draft" | "update") {
    // Chapters from where this entry was last changed up to here (that chapter included, since the
    // change may be in its text).
    const since = initial ? path.filter((c) => c.depth >= initial.op.anchor_depth) : [];
    const existing = initial || name.trim() ? current() : null;
    return {
      story,
      path,
      codex: entries.filter((e) => e.entry_id !== initial?.entry_id),
      direction,
      existing: existing && existing.name ? existing : null,
      mode,
      since,
    };
  }

  async function runAi(mode: "draft" | "update") {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setAiBusy(true);
    setAiError(null);
    setAiNote(null);
    try {
      const result = await draftEntry(settings, { ...aiOptions(mode), signal: ctl.signal });
      setBeforeAi(current());
      applyFields(result.fields);
      if (result.changedInChapterId) {
        setAnchorId(result.changedInChapterId);
        const title = path.find((c) => c.id === result.changedInChapterId)?.title;
        setAiNote(`The AI thinks this changed in “${title}”, so it will take effect from there. You can change that below.`);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setAiError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setAiBusy(false);
    }
  }

  const parsedAliases = aliases
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  return (
    <form
      className="ai-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: name.trim(), type, aliases: parsedAliases, content: content.trim(), always_include: always }, anchorId);
      }}
    >
      <h2>{initial ? `Edit “${initial.name}”` : "New entry"}</h2>

      <div className="ai-assist">
        <label>
          AI help{" "}
          <small>
            {initial
              ? "(say what to change, or let it catch the entry up with the story)"
              : "(describe what you want, e.g. “a grizzled ferryman who owes the hero a favour”)"}
          </small>
          <input
            value={direction}
            placeholder={initial ? "e.g. make her more guarded [keep her name]" : "Describe the entry [extra instructions go in brackets]"}
            onChange={(e) => setDirection(e.target.value)}
          />
        </label>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" onClick={() => runAi("draft")} disabled={aiBusy || busy || !direction.trim()}>
            {aiBusy ? "Working…" : initial ? "Rewrite with AI" : "Draft with AI"}
          </button>
          <PromptButton
            label={initial ? "Rewrite with AI" : "Draft with AI"}
            build={() => entryRequest(settings.contextTokens, aiOptions("draft"))}
          />
          {initial && (
            <>
              <button type="button" className="secondary" onClick={() => runAi("update")} disabled={aiBusy || busy}>
                Update from the story
              </button>
              <PromptButton label="Update from the story" build={() => entryRequest(settings.contextTokens, aiOptions("update"))} />
            </>
          )}
          {aiBusy && (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
          {beforeAi && !aiBusy && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                applyFields(beforeAi);
                setBeforeAi(null);
                setAiNote(null);
              }}
            >
              Undo AI change
            </button>
          )}
        </div>
        {aiError && <p className="error">{aiError}</p>}
        {aiNote && <p className="meta">{aiNote}</p>}
      </div>
      <label>
        Name
        <input required value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
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
        Other names <small>(comma-separated; used to spot when the entry is relevant)</small>
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </label>
      <label>
        Description <small>(what the AI should know: appearance, personality, current state…)</small>
        <textarea
          style={{ minHeight: "8rem", fontFamily: "inherit" }}
          value={content}
          maxLength={8000}
          onChange={(e) => setContent(e.target.value)}
        />
      </label>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} style={{ width: "auto" }} />
        Always include in AI prompts <small>(otherwise only when the name or an alias appears nearby)</small>
      </label>
      {(inDraft || path.length > 1) && (
      <label>
        Takes effect from{" "}
        <small>
          {inDraft
            ? "(the chapter you're writing, or an earlier one if it changed before; an earlier chapter is saved now and reaches every branch below it)"
            : "(this chapter and everything after it on this branch)"}
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
        <button type="submit" disabled={busy || aiBusy || !name.trim()}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add entry"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
