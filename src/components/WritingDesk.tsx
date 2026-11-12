"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { compareEntry, DRAFT_ANCHOR, foldCodex, TYPE_LABELS, usedAspectsOf, type CodexEntry, type CodexOp, type EntryChange as Change, type EntryType, type FactOp } from "@/lib/codex";
import type { PathChapter } from "@/lib/ai/codexAi";
import { mentions } from "@/lib/ai/prompts";
import { codexIconUrl, type IconChoice } from "@/lib/codexIconUrl";
import ChapterEditEntry, { type ChapterEditEntryProps } from "./ChapterEditEntry";
import ChapterTreePicker, { type PickerChapter } from "./ChapterTreePicker";
import { AiText, EntryTabs, FactsTable, type Chapter, type LaterForm } from "./CodexEntryPage";
import { EntryDetailsForm, EntryHistoryList, useEntryActions } from "./CodexEntryEditor";
import CodexIconPicker from "./CodexIconPicker";
import { ChangeList, comparisonTitle, type Relation } from "./CodexComparison";
import { useCodexInbox } from "./CodexInbox";
import DeskIllustrate from "./DeskIllustrate";
import type { IllustrateProps } from "./IllustrateWorkspace";
import DeskSuggestions from "./DeskSuggestions";
import LinkedEntryDetails from "./LinkedEntryDetails";
import MoreMenu from "./MoreMenu";

/** The codex as of the chapter on the desk, and what its entries' tabs need. */
export type DeskCodex = {
  storyId: string;
  /** The chapter on the desk: codex changes made here are saved at once, anchored at it. */
  chapterId: string;
  /** The chapters from the story's first to `chapterId`. */
  path: PathChapter[];
  ops: CodexOp[];
  facts: FactOp[];
  /** Each entry's icon version, by entry id. */
  icons: Record<string, number>;
  /** The story's pictures an icon can be picked from. */
  iconChoices: IconChoice[];
  /** The chapters written right after this one ("Remove from this chapter only" keeps the entry in them). */
  after: Chapter[];
  /** Each entry's next form change on a branch from here, by entry id. */
  laterForms: Record<string, LaterForm>;
  /** The chapters a form change can start at. */
  formChapters: Chapter[];
  /** Every chapter of the story, for "Compare with a chapter…". */
  chapters: PickerChapter[];
};

type Tab = "facts" | "preview" | "suggestions" | "history";

/** The codex list's groups, in order: each entry type goes under one. */
const GROUPS: { title: string; types: EntryType[] }[] = [
  { title: "Characters", types: ["character"] },
  { title: "Places", types: ["place"] },
  { title: "Things", types: ["item", "faction", "lore", "note"] },
];

/** Where the entry starts on this path: its last "create" (an entry removed and added again starts at the new one). */
function entryStart(ops: CodexOp[], path: Chapter[], entryId: string): Chapter {
  const own = ops.filter((o) => o.entry_id === entryId);
  const op = own.filter((o) => o.op === "create").at(-1) ?? own[0];
  const c = path.find((p) => p.id === op?.anchor_chapter_id) ?? path[path.length - 1];
  return { id: c.id, title: c.title };
}

/** What the desk's side column shows: the codex, or the controls for illustrating the chapter. */
export type DeskMode = "codex" | "illustrate";

/**
 * The writing desk: the codex (a side column that folds to a rail), the open codex entry, and the chapter's editor.
 * Codex changes made here are saved at once, at the chapter (it is posted).
 * In Illustrate mode the side column holds the picture controls and the story column the chapter's pictures (see
 * `DeskIllustrate`); the entry column closes and the editor is hidden, kept as it was for when Codex is chosen again.
 * `illustrate` is null for a chapter that isn't posted: Illustrate is greyed out. The mode is kept in the address
 * (`?side=illustrate`), so a refresh comes back to it.
 */
export default function WritingDesk({
  editor,
  codex,
  illustrate = null,
  mode: initialMode = "codex",
}: {
  editor: Omit<ChapterEditEntryProps, "desk">;
  codex: DeskCodex;
  illustrate?: IllustrateProps | null;
  mode?: DeskMode;
}) {
  const [mode, setMode] = useState<DeskMode>(illustrate ? initialMode : "codex");
  const illus = mode === "illustrate" && illustrate !== null;
  const choose = (next: DeskMode) => {
    setMode(next);
    const url = new URL(window.location.href);
    if (next === "illustrate") url.searchParams.set("side", "illustrate");
    else url.searchParams.delete("side");
    window.history.replaceState(window.history.state, "", url);
  };
  const modes = (
    <div className="desk-modes" role="group" aria-label="Side column">
      <button type="button" className={illus ? undefined : "on"} aria-pressed={!illus} onClick={() => choose("codex")}>
        Codex
      </button>
      <button
        type="button"
        className={illus ? "on" : undefined}
        aria-pressed={illus}
        disabled={!illustrate}
        title={illustrate ? undefined : "Post the chapter first"}
        onClick={() => choose("illustrate")}
      >
        Illustrate
      </button>
    </div>
  );
  const router = useRouter();
  const refresh = () => router.refresh();
  const { storyId, chapterId, path, ops, facts, icons } = codex;
  // The draft's title, prompt and text, as the editor has them: "In this chapter" lists the entries they name.
  const [text, setText] = useState("");
  const [folded, setFolded] = useState(false);
  const [query, setQuery] = useState("");
  // The entry open in the entry column, or "new" for the new-entry form.
  const [openId, setOpenId] = useState<string | null>(null);

  const entries = useMemo(() => foldCodex(ops, facts), [ops, facts]);
  const inbox = useCodexInbox({ storyId, onPath: { chapterIds: path.map((c) => c.id), onChanged: refresh } });
  const waiting = useMemo(() => {
    const n: Record<string, number> = {};
    for (const s of inbox.items ?? []) if (s.status === "open" && s.entry_id) n[s.entry_id] = (n[s.entry_id] ?? 0) + 1;
    return n;
  }, [inbox.items]);

  const q = query.trim().toLowerCase();
  const shown = q ? entries.filter((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase().includes(q))) : entries;
  const inChapter = shown.filter((e) => mentions(e, text));
  const open = openId && openId !== "new" ? entries.find((e) => e.entry_id === openId) : undefined;
  const here = path[path.length - 1];

  const row = (e: CodexEntry) => {
    const n = waiting[e.entry_id] ?? 0;
    const icon = icons[e.entry_id];
    return (
      <li key={e.entry_id}>
        <button type="button" className={e.entry_id === openId ? "desk-row on" : "desk-row"} aria-current={e.entry_id === openId ? "true" : undefined} onClick={() => setOpenId(e.entry_id)}>
          {icon != null ? (
            // eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size
            <img className="codex-icon desk-row-icon" src={codexIconUrl(storyId, e.entry_id, icon)} alt="" />
          ) : (
            <span className="codex-icon codex-icon-empty desk-row-icon" aria-hidden="true">
              {e.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="desk-row-text">
            <span className="desk-row-name">{e.name}</span>
            <small>{e.aliases[0] ?? TYPE_LABELS[e.type]}</small>
          </span>
          {n > 0 && (
            <span className="desk-badge" title={`${n} suggestion${n === 1 ? "" : "s"} waiting`}>
              {n}
              <span className="visually-hidden"> suggestion{n === 1 ? "" : "s"} waiting</span>
            </span>
          )}
        </button>
      </li>
    );
  };
  const group = (title: string, list: CodexEntry[]) =>
    list.length > 0 && (
      <details key={title} className="desk-group" open>
        <summary>
          {title} <span className="desk-group-count">{list.length}</span>
        </summary>
        <ul className="desk-rows">{list.map(row)}</ul>
      </details>
    );

  const classes = (illus ? ["desk", "desk-illus"] : ["desk", folded ? "desk-folded" : "", openId ? "desk-has-entry" : ""]).filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {illus ? (
        <DeskIllustrate p={illustrate} modes={modes} />
      ) : folded ? (
        <aside className="desk-side desk-rail" aria-label="Codex">
          <button type="button" className="desk-rail-button" aria-expanded={false} title="Show the codex" onClick={() => setFolded(false)}>
            Codex · {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </button>
        </aside>
      ) : (
        <aside className="desk-side" aria-label="Codex">
          {modes}
          <div className="desk-side-head">
            <input type="search" aria-label="Search entries" placeholder="Search entries…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className="secondary" aria-label="New entry" title="New entry" onClick={() => setOpenId("new")}>
              +
            </button>
            <button type="button" className="secondary" aria-label="Fold the codex" aria-expanded={true} title="Fold the codex" onClick={() => setFolded(true)}>
              «
            </button>
          </div>
          {entries.length === 0 ? (
            <p className="meta">No entries yet at this chapter. + adds one.</p>
          ) : shown.length === 0 ? (
            <p className="meta">No entry matches “{query.trim()}”.</p>
          ) : (
            <>
              {group("In this chapter", inChapter)}
              {GROUPS.map((g) => group(g.title, shown.filter((e) => g.types.includes(e.type))))}
            </>
          )}
        </aside>
      )}

      {!illus && openId === "new" && (
        <section className="desk-entry" aria-label="New entry">
          <NewEntry chapterId={chapterId} path={path} onClose={() => setOpenId(null)} onMade={(id) => setOpenId(id)} />
        </section>
      )}
      {!illus && open && (
        <section className="desk-entry" aria-label={`Codex entry: ${open.name}`}>
          <DeskEntry key={open.entry_id} entry={open} entries={entries} codex={codex} waiting={waiting[open.entry_id] ?? 0} inbox={inbox} onClose={() => setOpenId(null)} />
        </section>
      )}

      {/* Hidden, not removed, in Illustrate mode: an unsaved edit is still there when Codex is chosen again. */}
      <div className="desk-story" hidden={illus}>
        <h1 className="desk-title">Edit “{here.title}”</h1>
        <ChapterEditEntry {...editor} desk={{ onText: setText }} />
      </div>
    </div>
  );
}

/** "+": a new entry's name, type and keywords, saved at once at the chapter; it opens when it is made. */
function NewEntry({ chapterId, path, onClose, onMade }: { chapterId: string; path: PathChapter[]; onClose: () => void; onMade: (id: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="desk-entry-inner">
      <div className="desk-entry-bar">
        <h2 className="desk-entry-name-text">New entry</h2>
        <button type="button" className="secondary desk-close" aria-label="Close" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <EntryDetailsForm
        initial={null}
        busy={busy}
        path={path}
        chapterId={chapterId}
        inDraft={false}
        onCancel={onClose}
        onSave={async (f) => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/codex", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ anchor_chapter_id: chapterId, op: "create", ...f, content: "", always_include: false }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
            router.refresh();
            onMade(data.entry_id);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/**
 * The open entry: its icon and name "as of" the chapter, the ⋯ menu and a close button, then the tabs: Facts (the
 * default), Preview, Suggestions (first when some are waiting) and History.
 */
function DeskEntry({
  entry,
  entries,
  codex,
  waiting,
  inbox,
  onClose,
}: {
  entry: CodexEntry;
  entries: CodexEntry[];
  codex: DeskCodex;
  waiting: number;
  inbox: ReturnType<typeof useCodexInbox>;
  onClose: () => void;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const { storyId, chapterId, path, ops, facts } = codex;
  const here = path[path.length - 1];
  const shared = entry.shared_entry_id;
  const { busy, error, setError, replace, share, removeHere, retire } = useEntryActions({
    entry,
    chapterId,
    storyId,
    onRetired: () => {
      onClose();
      router.refresh();
    },
  });
  const [tab, setTab] = useState<Tab>(waiting > 0 ? "suggestions" : "facts");
  const [panel, setPanel] = useState<"details" | "icon" | "compare" | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const icon = codex.icons[entry.entry_id] ?? null;
  const start = entryStart(ops, path, entry.entry_id);
  const titleOf = (id: string) => (id === DRAFT_ANCHOR ? "this chapter (not posted yet)" : (path.find((p) => p.id === id)?.title ?? "an earlier chapter"));
  const toggle = (p: NonNullable<typeof panel>) => setPanel(panel === p ? null : p);

  return (
    <div className="desk-entry-inner">
      <div className="desk-entry-bar">
        <span className="meta">
          {TYPE_LABELS[entry.type]} · as of “{here.title}”
        </span>
        <MoreMenu label="More entry actions">
          <button type="button" onClick={() => setPanel("details")}>
            Edit details
          </button>
          <button type="button" onClick={() => setPanel("compare")}>
            Compare with a chapter…
          </button>
          {!shared && (
            <button type="button" disabled={busy} title={`Make this a shared entry, as it reads at “${here.title}”, so other stories can add it too.`} onClick={() => void share(here.title)}>
              Share to other stories…
            </button>
          )}
          <Link href={`/s/${storyId}/codex/${entry.entry_id}?at=${chapterId}`}>Open on its own page</Link>
          <button
            type="button"
            className="danger"
            disabled={busy || codex.after.length === 0}
            title={
              codex.after.length > 0
                ? `${entry.name} stays in the ${codex.after.length === 1 ? "chapter" : `${codex.after.length} chapters`} after “${here.title}”.`
                : "No chapter has been written after this one, so there is nothing to keep it in. Use Retire."
            }
            onClick={() => void removeHere(here.title, codex.after)}
          >
            Remove from this chapter only…
          </button>
          <button type="button" className="danger" disabled={busy} title={`Gone from “${here.title}” and every chapter after it. Earlier chapters keep it.`} onClick={() => void retire()}>
            Retire…
          </button>
        </MoreMenu>
        <button type="button" className="secondary desk-close" aria-label="Close entry" title="Close entry" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="desk-entry-name">
        <button
          type="button"
          className="codex-icon-button"
          aria-expanded={panel === "icon"}
          aria-label={icon !== null ? `Change the icon of ${entry.name}` : `Add an icon for ${entry.name}`}
          title={icon !== null ? "Change the icon" : "Add an icon"}
          onClick={() => toggle("icon")}
        >
          {icon !== null ? (
            // eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size
            <img className="codex-icon small" src={codexIconUrl(storyId, entry.entry_id, icon)} alt={`Icon of ${entry.name}`} />
          ) : (
            <span className="codex-icon small codex-icon-empty" aria-hidden="true">
              +
            </span>
          )}
        </button>
        <h2 className="desk-entry-name-text">{entry.name}</h2>
      </div>
      {error && <p className="error">{error}</p>}

      {panel === "icon" && (
        <section className="entry-section" aria-label="Icon">
          <CodexIconPicker storyId={storyId} entryId={entry.entry_id} entryName={entry.name} version={icon} saved={codex.iconChoices} onChanged={refresh} />
          <div>
            <button type="button" className="secondary" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
        </section>
      )}
      {panel === "details" && (
        <section className="entry-section" aria-label={shared ? "Details" : "Name, type and keywords"}>
          <h3>{shared ? "Details" : "Name, type and keywords"}</h3>
          {shared ? (
            <LinkedEntryDetails entry={entry} chapterId={chapterId} chapterTitle={here.title} />
          ) : (
            <EntryDetailsForm
              key={[entry.op.id, entry.name, entry.type, entry.aliases.join("\n"), entry.always_include].join("|")}
              initial={entry}
              busy={busy}
              path={path}
              chapterId={chapterId}
              inDraft={false}
              keywordSources={entry.keywordSources}
              saved={savedNote}
              onSave={async (f, anchor) => {
                if (await replace(f, anchor)) {
                  setSavedNote(true);
                  setTimeout(() => setSavedNote(false), 4000);
                }
              }}
            />
          )}
          <div>
            <button type="button" className="secondary" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
        </section>
      )}
      {panel === "compare" && <DeskCompare entry={entry} chapterId={chapterId} path={path} chapters={codex.chapters} onClose={() => setPanel(null)} />}

      <EntryTabs
        tab={tab}
        setTab={setTab}
        tabs={[
          { id: "facts", label: "Facts" },
          { id: "preview", label: "Preview" },
          { id: "suggestions", label: waiting > 0 ? `Suggestions (${waiting})` : "Suggestions" },
          { id: "history", label: "History" },
        ]}
      >
        {tab === "facts" && (
          <FactsTable
            desk
            entry={entry}
            factOps={facts}
            path={path}
            chapterId={chapterId}
            storyId={storyId}
            usedAspects={usedAspectsOf(entries)}
            start={start}
            laterForm={codex.laterForms[entry.entry_id] ?? null}
            formChapters={codex.formChapters}
            suggestions={[]}
            onSaved={refresh}
            onError={setError}
          />
        )}
        {tab === "preview" && (
          <>
            <AiText entry={entry} />
            <p className="meta">
              This is the text sent with the prompt at “{here.title}”, when {entry.name} is named or a keyword appears nearby{entry.always_include ? " (always, here)" : ""}.
            </p>
          </>
        )}
        {tab === "suggestions" && <DeskSuggestions entry={entry} storyId={storyId} chapterId={chapterId} path={path} start={start} inbox={inbox} />}
        {tab === "history" && <EntryHistoryList entry={entry} ops={ops} titleOf={titleOf} busy={busy} replace={replace} />}
      </EntryTabs>
    </div>
  );
}

/** "Compare with a chapter…": what changed in the entry between that chapter and this one (read from the server). */
function DeskCompare({ entry, chapterId, path, chapters, onClose }: { entry: CodexEntry; chapterId: string; path: Chapter[]; chapters: PickerChapter[]; onClose: () => void }) {
  const [other, setOther] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; relation: Relation; missing: boolean; changes: Change[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string | null) {
    setOther(id);
    setResult(null);
    setError(null);
    if (!id || id === chapterId) return;
    try {
      const res = await fetch(`/api/chapters/${id}/codex`);
      if (!res.ok) throw new Error(`Couldn't read that chapter's codex (${res.status})`);
      const data = (await res.json()) as { entries: CodexEntry[] };
      const there = data.entries.find((e) => e.entry_id === entry.entry_id) ?? null;
      // Is `chapterId` on the way to the other chapter (it is later), or the other on the way here (earlier)?
      const parent = new Map(chapters.map((c) => [c.id, c.parent_id]));
      let later = false;
      for (let c: string | null | undefined = parent.get(id); c; c = parent.get(c)) if (c === chapterId) later = true;
      const relation: Relation = path.some((c) => c.id === id) ? "earlier" : later ? "later" : "branch";
      const [from, to] = relation === "later" ? [entry, there] : [there, entry];
      setResult({ title: chapters.find((c) => c.id === id)?.title ?? "that chapter", relation, missing: there === null, changes: from && to ? compareEntry(from, to) : [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="entry-section entry-compare" aria-label="Comparison">
      <div className="row compare-form">
        <span id="desk-compare-label">Compare with</span>
        <ChapterTreePicker id="desk-compare" labelledBy="desk-compare-label" chapters={chapters} value={other} onChange={(id) => void pick(id)} linkLabel={other ? undefined : "Choose a chapter…"} />
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <h3>{comparisonTitle(result.relation, result.title)}</h3>
          {result.missing ? (
            <p className="meta">
              {entry.name} isn&apos;t in the codex at “{result.title}”.
            </p>
          ) : result.changes.length === 0 ? (
            <p className="meta">No changes: {entry.name} is the same at both.</p>
          ) : (
            <ChangeList changes={result.changes} />
          )}
        </>
      )}
      <div>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}
