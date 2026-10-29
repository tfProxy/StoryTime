"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  addChange,
  addFactChange,
  DRAFT_ANCHOR,
  draftFactOps,
  draftOps,
  foldCodex,
  isDraftEntry,
  retiredEntries,
  usedAspectsOf,
  type CodexChange,
  type CodexOp,
  type EntryType,
  type FactChange,
  type FactOp,
} from "@/lib/codex";
import type { PathChapter, StoryInfo } from "@/lib/ai/codexAi";
import CodexCheck from "./CodexCheck";
import CodexEntryCards from "./CodexEntryCards";
import CodexEntryEditor, { EntryDetailsForm, type EntryChange } from "./CodexEntryEditor";
import type { HeldFact } from "./CodexFacts";

type Props = {
  story?: StoryInfo;
  /** The story's id: entries link to their pages with it, and show their pictures. */
  storyId?: string;
  /** Open the codex check section initially (used right after posting a chapter). */
  openAiHelper?: boolean;
  /** Shown inside the writing page's drawer: entries open in the drawer, with no chapter timeline or AI scan. */
  embedded?: boolean;
  /** Shown on the story's details page: the codex at the first chapter, which every branch shares. */
  storyWide?: boolean;
  /** Open with this entry showing ("new" for the new-entry form); only in the drawer. */
  startEditing?: string | null;
  /** The chapter whose codex is being viewed; changes made here are anchored at it. */
  chapterId: string;
  path: PathChapter[];
  /** Every op on the path from the story root to this chapter. */
  ops: CodexOp[];
  /** Every fact op on the same path as `ops`. */
  facts?: FactOp[];
  /**
   * Changes held in the draft of the chapter being written or edited. When given, changes (entries and
   * facts) are kept there by default and saved with the chapter; only changes anchored at an earlier
   * chapter are saved straight away. `editing`: the last chapter of `path` is the one being edited.
   */
  draft?: {
    changes: CodexChange[];
    onChange: (next: CodexChange[]) => void;
    facts: FactChange[];
    onFactsChange: (next: FactChange[]) => void;
    editing?: boolean;
  };
  /** The codex page's chapter path (with the chapters after this one), and the chapter's collapsed summary below it. */
  nav?: ReactNode;
  summary?: ReactNode;
};

const localId = () => `draft-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * The codex as a compact list of entries (see `CodexEntryCards`), with "+ New entry". Each card opens the entry's
 * page; in the writing page's drawer it opens the entry in the drawer instead, so the draft is kept.
 */
export default function CodexPanel({ storyId, openAiHelper, embedded, storyWide, startEditing, chapterId, path, ops, facts, draft, nav, summary }: Props) {
  const router = useRouter();
  // Each entry's picture as of this chapter (by entry id), for the thumbnails.
  const [pictures, setPictures] = useState<Record<string, { id: string }>>({});
  useEffect(() => {
    if (!storyId) return;
    let live = true;
    fetch(`/api/stories/${storyId}/codex-pictures?chapter=${encodeURIComponent(chapterId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pictures: Record<string, { id: string }> } | null) => live && d && setPictures(d.pictures))
      .catch(() => {
        // no thumbnails this time
      });
    return () => {
      live = false;
    };
  }, [storyId, chapterId]);
  // The chapters already written after this one (the drawer's "Remove from this chapter only" keeps the entry in them).
  const [after, setAfter] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (!embedded) return;
    let live = true;
    fetch(`/api/chapters/${encodeURIComponent(chapterId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { choices: { child_chapter_id: string | null }[] } | null) => {
        if (live && d) setAfter(d.choices.flatMap((c) => (c.child_chapter_id ? [{ id: c.child_chapter_id, title: "" }] : [])));
      })
      .catch(() => {
        // the button just stays disabled
      });
    return () => {
      live = false;
    };
  }, [embedded, chapterId]);
  const titleOf = (id: string) => path.find((p) => p.id === id)?.title ?? "an earlier chapter";

  const draftDepth = (path.at(-1)?.depth ?? -1) + 1;
  const allOps = draft ? [...ops, ...draftOps(draft.changes, draftDepth)] : ops;
  const allFacts = draft ? [...(facts ?? []), ...draftFactOps(draft.facts, draftDepth)] : (facts ?? []);
  const entries = foldCodex(allOps, allFacts);
  const usedAspects = usedAspectsOf(entries);
  const retired = retiredEntries(allOps);
  const pending = new Map((draft?.changes ?? []).map((c) => [c.entry_id, c]));
  const held = Object.fromEntries([
    ...(draft?.facts ?? []).map((f) => [f.entry_id, "replace"]),
    ...[...pending].map(([id, c]) => [id, c.op]),
  ]);
  /** Drops what the draft holds for an entry: its details change and its fact changes. */
  const discard = (entryId: string) => {
    if (!draft) return;
    draft.onChange(draft.changes.filter((c) => c.entry_id !== entryId));
    draft.onFactsChange(draft.facts.filter((f) => f.entry_id !== entryId));
  };
  // When editing a chapter, the chapter itself is "this chapter" (held); only the ones before it are saved now.
  const anchorPath = draft?.editing ? path.slice(0, -1) : path;
  const holdFact = (entryId: string) => (f: HeldFact) =>
    draft?.onFactsChange(addFactChange(draft.facts, { ...f, entry_id: entryId, fact_id: f.fact_id ?? `draft-fact-${localId().slice(6)}` }));

  const [creating, setCreating] = useState(startEditing === "new");
  // The entry open in the drawer.
  const [openId, setOpenId] = useState<string | null>(startEditing && startEditing !== "new" ? startEditing : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Saves a change: held in the draft by default when there is one, otherwise (or when it is anchored at an earlier chapter) saved now. */
  async function post({ anchor, ...change }: EntryChange): Promise<{ id?: string; error?: string }> {
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
      return { id: entryId };
    }
    // An entry that only exists in the draft becomes a real one when it is saved to an earlier chapter.
    const body = change.entry_id && isDraftEntry(change.entry_id) ? { ...change, op: "create", entry_id: undefined } : change;
    try {
      const res = await fetch("/api/codex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: at, ...body }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? `Request failed (${res.status})` };
      // The saved version now holds what the form showed, so a held change to the same entry would only override it.
      if (change.entry_id && draft) draft.onChange(draft.changes.filter((c) => c.entry_id !== change.entry_id));
      router.refresh();
      return { id: data.entry_id ?? change.entry_id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function create(f: { name: string; type: EntryType; aliases: string[] }) {
    setBusy(true);
    setError(null);
    const r = await post({ op: "create", ...f, content: "", always_include: false });
    setBusy(false);
    if (r.error || !r.id) return setError(r.error ?? "Couldn't add the entry");
    setCreating(false);
    if (embedded) setOpenId(r.id);
    else router.push(`/s/${storyId}/codex/${r.id}?at=${chapterId}`);
  }

  async function bringBack(e: (typeof retired)[number]) {
    setBusy(true);
    setError(null);
    const r = await post({ op: "replace", entry_id: e.entry_id, name: e.name, type: e.type, aliases: e.aliases, content: e.content, always_include: e.always_include });
    setBusy(false);
    if (r.error) setError(r.error);
  }

  // In the drawer an entry opens in place of the list.
  const open = embedded && openId ? entries.find((e) => e.entry_id === openId) : undefined;
  if (open) {
    return (
      <div style={{ display: "grid", gap: "1rem" }}>
        <div>
          <button type="button" className="secondary" onClick={() => setOpenId(null)}>
            ← All entries
          </button>
        </div>
        <CodexEntryEditor
          key={open.entry_id}
          variant="drawer"
          entry={open}
          ops={allOps}
          facts={allFacts}
          path={path}
          anchorPath={anchorPath}
          chapterId={chapterId}
          storyId={storyId}
          usedAspects={usedAspects}
          pictureId={pictures[open.entry_id]?.id}
          save={async (c) => (await post(c)).error ?? null}
          holdFact={draft ? holdFact(open.entry_id) : undefined}
          editingChapter={draft?.editing}
          held={
            pending.get(open.entry_id) ??
            (held[open.entry_id]
              ? { op: "replace", entry_id: open.entry_id, name: open.name, type: open.type, aliases: open.aliases, content: open.content, always_include: open.always_include }
              : undefined)
          }
          onDiscardHeld={() => discard(open.entry_id)}
          onRetired={() => setOpenId(null)}
          after={after}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {!embedded && !storyWide && (
        nav
      )}
      {!embedded && !storyWide && summary}
      {draft ? (
        <p className="notice">
          {draft.editing ? (
            <>
              This is the codex as of <strong>{titleOf(chapterId)}</strong>, the chapter you&apos;re editing. Changes you
              make here (details and facts) belong to it: the AI uses them straight away, and they are saved with the
              chapter when you save it, for it and the chapters after it.
            </>
          ) : (
            <>
              Changes you make here (details and facts) belong to the chapter you&apos;re writing: the AI uses them
              straight away, and they are saved with the chapter when you post it, for it and the chapters after it.
            </>
          )}{" "}
          To record something that happened earlier, pick that chapter under &ldquo;Takes effect from&rdquo;; that is
          saved immediately and reaches every branch below it.
        </p>
      ) : storyWide ? (
        <p className="notice">
          Entries here apply to the whole story, on every branch, from the first chapter on. A later chapter can still
          change or retire one for its own branch; do that from that chapter&apos;s codex.
        </p>
      ) : (
        <p className="notice">
          This is the codex as of <strong>{titleOf(chapterId)}</strong>. Anything you add or change here takes effect from
          this chapter onward on this branch, and other branches never see it. To record a change that happened earlier,
          pick that chapter above first.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {!embedded && !storyWide && storyId && <CodexCheck storyId={storyId} chapterId={chapterId} inboxHref={`/s/${storyId}/review?tab=codex`} defaultOpen={openAiHelper} />}

      {creating ? (
        <div>
          <EntryDetailsForm initial={null} busy={busy} path={path} anchorPath={anchorPath} chapterId={chapterId} inDraft={!!draft} editingChapter={draft?.editing} onCancel={() => setCreating(false)} onSave={(f) => create(f)} />
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setCreating(true)}>
            + New entry
          </button>
        </div>
      )}

      <CodexEntryCards
        entries={entries}
        chapterId={chapterId}
        storyId={storyId}
        pictures={pictures}
        held={held}
        onOpen={embedded ? (e) => setOpenId(e.entry_id) : undefined}
        empty={creating ? undefined : "No entries yet at this point. Add characters, places or facts the story should remember."}
      />

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
                <button type="button" className="secondary" disabled={busy} onClick={() => bringBack(e)}>
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
