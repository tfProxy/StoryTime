"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addChange,
  addFactChange,
  applyDraft,
  compareEntry,
  DRAFT_ANCHOR,
  FACT_LIMITS,
  foldCodex,
  isDraftEntry,
  retiredEntries,
  TYPE_LABELS,
  usedAspectsOf,
  type CodexEntry,
  type CodexOp,
  type EntryChange as Change,
  type EntryType,
  type FactOp,
} from "@/lib/codex";
import type { PathChapter } from "@/lib/ai/codexAi";
import { mentions } from "@/lib/ai/prompts";
import { markDeskMove } from "@/lib/deskMove";
import { codexIconUrl, type IconChoice } from "@/lib/codexIconUrl";
import ChapterEditEntry, { type ChapterEditEntryProps } from "./ChapterEditEntry";
import ChapterEditor, { type DeskOverrides, type HeldCodex } from "./ChapterEditor";
import ChapterTreePicker, { type PickerChapter } from "./ChapterTreePicker";
import { AiText, EntryTabs, FactsTable, type Chapter, type LaterForm } from "./CodexEntryPage";
import { EntryDetailsForm, EntryHistoryList, useEntryActions, type EntryChange } from "./CodexEntryEditor";
import CodexIconPicker from "./CodexIconPicker";
import { ChangeList, comparisonTitle, type Relation } from "./CodexComparison";
import { useCodexInbox } from "./CodexInbox";
import DeskIllustrate from "./DeskIllustrate";
import DeskPath, { type PathBlock } from "./DeskPath";
import DeskPhone, { usePhone, type PhoneSheet } from "./DeskPhone";
import type { IllustrateProps } from "./IllustrateWorkspace";
import DeskSuggestions from "./DeskSuggestions";
import LinkedEntryDetails from "./LinkedEntryDetails";
import MoreMenu from "./MoreMenu";

/**
 * The codex as of the chapter on the desk, and what its entries' tabs need. For a chapter not posted yet it is the
 * codex as of the chapter before it (`chapterId`), with the changes held in the new chapter's draft on top.
 */
export type DeskCodex = {
  storyId: string;
  /**
   * The chapter on the desk: codex changes made here are saved at once, anchored at it. For a new chapter, the one it
   * follows: changes are held for the new chapter, and only those put at an earlier chapter are saved at once.
   */
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
 * On a chapter not posted yet: the codex changes held in its draft (see ChapterEditor's `Desk.onHeld`), and the new
 * chapter as a place on the path (id DRAFT_ANCHOR) for what is held there.
 */
type Holding = { held: HeldCodex; here: PathChapter };

/** Why an entry action waits for the Post on a new chapter. */
const NOT_POSTED = "Post the chapter first.";

const localId = () => `draft-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * Saves an entry change from the desk. On a new chapter a change for it (anchor DRAFT_ANCHOR, the default) is held in
 * the draft, as the Write page's drawer does; one put at an earlier chapter, or any on a posted chapter, is saved now.
 * Resolves to the entry's id, or an error.
 */
async function saveEntryChange(
  holding: Holding | null,
  chapterId: string,
  known: CodexEntry[],
  { anchor, ...change }: EntryChange,
): Promise<{ id?: string; error?: string }> {
  const at = anchor ?? (holding ? DRAFT_ANCHOR : chapterId);
  if (holding && at === DRAFT_ANCHOR) {
    const entryId = change.op === "create" ? localId() : change.entry_id!;
    const was = known.find((e) => e.entry_id === entryId);
    holding.held.update((h) => ({
      ...h,
      changes: addChange(h.changes, {
        op: change.op,
        entry_id: entryId,
        name: change.name ?? was?.name ?? "",
        type: change.type ?? was?.type ?? "note",
        aliases: change.aliases ?? was?.aliases ?? [],
        content: change.content ?? was?.content ?? "",
        always_include: change.always_include ?? was?.always_include ?? false,
      }),
    }));
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? `Request failed (${res.status})` };
    // The saved version now holds what the form showed, so a held change to the same entry would only override it.
    if (holding && change.entry_id) holding.held.update((h) => ({ ...h, changes: h.changes.filter((c) => c.entry_id !== change.entry_id) }));
    return { id: data.entry_id ?? change.entry_id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type DeskProps = {
  /** A posted chapter's box (the Edit page's editor). */
  editor?: Omit<ChapterEditEntryProps, "desk">;
  /** Or a chapter not posted yet (the Write page's editor, with its draft); Post chapter makes it. */
  newChapter?: Omit<ComponentProps<typeof ChapterEditor>, "desk">;
  codex: DeskCodex;
  /** The top bar's links ("← Back to …"); the chapter's ⋯ menu and a status line go beside them. */
  bar: ReactNode;
  /** A status line to start with ("Posted · …" after a Post). */
  note?: string | null;
  /** The earlier chapters on the path, as blocks above the box (marked "Draft not used" from draftMarks.ts). */
  pathBlocks?: PathBlock[];
  /** "What happens next?" under the box: the chapter's choices (ChapterChoices), once it is posted. */
  next?: ReactNode;
  /** How many choices `next` lists (the phone's bottom bar shows it). */
  nextCount?: number;
  illustrate?: IllustrateProps | null;
  mode?: DeskMode;
};

/**
 * The writing desk: the codex (a side column that folds to a rail), the open codex entry, and the chapter's editor.
 * On a posted chapter codex changes made here are saved at once, at the chapter. On a new one (`newChapter`) they are
 * held in its draft, as the Write page's drawer holds them, and Post saves them at it; the actions that need a posted
 * chapter are greyed out with why.
 * In Illustrate mode the side column holds the picture controls and the story column the chapter's pictures (see
 * `DeskIllustrate`); the entry column closes and the editor is hidden, kept as it was for when Codex is chosen again.
 * `illustrate` is null for a chapter that isn't posted: Illustrate is greyed out. The mode is kept in the address
 * (`?side=illustrate`), so a refresh comes back to it.
 */
export default function WritingDesk({
  editor,
  newChapter,
  codex,
  bar,
  note: firstNote = null,
  pathBlocks = [],
  next = null,
  nextCount = 0,
  illustrate = null,
  mode: initialMode = "codex",
}: DeskProps) {
  // The chapter's box (with the "→ …" line above it) is scrolled into view on arriving, from outside or by a move, once
  // its draft has loaded (the box is short until then, and the page couldn't scroll that far).
  const hereRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(pathBlocks.length === 0);
  // The draft's title, prompt and text, as the editor has them: "In this chapter" lists the entries they name.
  const [text, setText] = useState("");
  // The chapter's text alone: the names found in it are listed under it.
  const [body, setBody] = useState("");
  const onText = useCallback((t: string, b: string) => {
    setText(t);
    setBody(b);
    if (scrolled.current) return;
    scrolled.current = true;
    requestAnimationFrame(() => hereRef.current?.scrollIntoView({ block: "start" }));
  }, []);
  // Back and forward from here to another desk is a move within the desk too. It is heard from the Navigation API's
  // "navigate" event, which comes before the page it goes to is shown (by popstate the router has already shown it, and
  // this desk is gone). A browser without the Navigation API opens that desk as from outside, every block unfolded.
  useEffect(() => {
    const nav = (window as { navigation?: EventTarget }).navigation;
    if (!nav) return;
    const onNavigate = (e: Event) => {
      const n = e as Event & { navigationType?: string; destination?: { url?: string } };
      if (n.navigationType === "traverse" && n.destination?.url) markDeskMove(n.destination.url);
    };
    nav.addEventListener("navigate", onNavigate);
    return () => nav.removeEventListener("navigate", onNavigate);
  }, []);
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
  // Where the chapter's box puts the top bar's ⋯ menu, and the bar's status line (after an Update, say).
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);
  const [note, setNote] = useState<string | null>(firstNote);
  const refresh = () => router.refresh();
  const { storyId, chapterId, path, ops, facts, icons } = codex;
  const [folded, setFolded] = useState(false);
  const phone = usePhone();
  const [sheet, setSheet] = useState<PhoneSheet | null>(null);
  const [query, setQuery] = useState("");
  // The entry open in the entry column, or "new" for the new-entry form.
  const [openId, setOpenId] = useState<string | null>(null);
  // The words selected in the chapter's text box, and "Add as a fact…" once chosen: the words become a new fact's quote,
  // in the entry picked for it (`quoteN` counts the times, so the entry's form opens afresh each time).
  const [selected, setSelected] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quoteN, setQuoteN] = useState(0);
  // A new chapter's codex changes, held in its draft: the codex shows them on top of the one it follows.
  const [held, setHeld] = useState<HeldCodex | null>(null);
  const holding: Holding | null =
    newChapter && held
      ? { held, here: { id: DRAFT_ANCHOR, title: "the new chapter", depth: (path.at(-1)?.depth ?? -1) + 1, body: "", summary: null, path_summary: null } }
      : null;
  const depth = holding?.here.depth ?? 0;
  const applied = useMemo(
    () => (held && newChapter ? applyDraft(ops, facts, held.changes, held.facts, depth) : { ops, facts }),
    [ops, facts, held, newChapter, depth],
  );
  const heldIds = new Set(held && newChapter ? [...held.changes.map((c) => c.entry_id), ...held.facts.map((f) => f.entry_id)] : []);
  // The draft's entries pinned to the prompt or left out of it (null while the draft loads).
  const [overrides, setOverrides] = useState<DeskOverrides | null>(null);
  const promptPick = (id: string): PromptPick => (overrides?.value.exclude.includes(id) ? "out" : overrides?.value.include.includes(id) ? "pinned" : "auto");

  const entries = useMemo(() => foldCodex(applied.ops, applied.facts), [applied]);
  const inbox = useCodexInbox({ storyId, onPath: { chapterIds: path.map((c) => c.id), onChanged: refresh } });
  const waiting = useMemo(() => {
    const n: Record<string, number> = {};
    for (const s of inbox.items ?? []) if (s.status === "open" && s.entry_id) n[s.entry_id] = (n[s.entry_id] ?? 0) + 1;
    return n;
  }, [inbox.items]);

  const q = query.trim().toLowerCase();
  const shown = q ? entries.filter((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase().includes(q))) : entries;
  // An entry pinned to the prompt is listed here too, named in the text or not.
  const inChapter = shown.filter((e) => mentions(e, text) || promptPick(e.entry_id) === "pinned");
  const open = openId && openId !== "new" ? entries.find((e) => e.entry_id === openId) : undefined;
  const here = path[path.length - 1];

  // The entries named in the chapter's text (by name or keyword, as "In this chapter"), listed under it.
  const named = entries.filter((e) => mentions(e, body));
  // A selection still in the text (the box may have been switched to reading, or the words typed over).
  const selection = selected.trim() && body.includes(selected) ? selected.trim() : "";
  /** "Add as a fact…": the words, as a quote, in the entry they name (or the one open), else one to choose. */
  const startQuote = (words: string) => {
    const hit = entries.find((e) => mentions(e, words));
    setQuote(words.slice(0, FACT_LIMITS.quote));
    setQuoteN((n) => n + 1);
    setOpenId(hit?.entry_id ?? (open ? open.entry_id : null));
  };
  const belowText =
    named.length > 0 || selection ? (
      <div className="row desk-named" role="group" aria-label="Codex entries named in the text">
        {named.length > 0 && <span className="desk-label">Named in the text</span>}
        {named.map((e) => (
          <button
            key={e.entry_id}
            type="button"
            className={e.entry_id === openId ? "desk-name on" : "desk-name"}
            aria-current={e.entry_id === openId ? "true" : undefined}
            onClick={() => setOpenId(e.entry_id)}
          >
            {e.name}
          </button>
        ))}
        <span className="desk-spacer" />
        {selection && (
          // Pressing it would take the focus, and the selection's highlight, from the text box: it keeps both.
          <button type="button" className="secondary desk-add-fact" onMouseDown={(e) => e.preventDefault()} onClick={() => startQuote(selection)}>
            Add as a fact…
          </button>
        )}
      </div>
    ) : null;

  const row = (e: CodexEntry) => {
    const n = waiting[e.entry_id] ?? 0;
    const icon = icons[e.entry_id];
    const pick = promptPick(e.entry_id);
    return (
      <li key={e.entry_id} className={`desk-row-item pick-${pick}`}>
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
          {heldIds.has(e.entry_id) && (
            <span className="desk-chip" title="Changed for the new chapter: saved when you post it">
              held
            </span>
          )}
          {pick !== "auto" && (
            <span className={`desk-chip desk-pick-chip ${pick}`} title={PICKS[pick].note}>
              {PICKS[pick].chip}
            </span>
          )}
          {n > 0 && (
            <span className="desk-badge" title={`${n} suggestion${n === 1 ? "" : "s"} waiting`}>
              {n}
              <span className="visually-hidden"> suggestion{n === 1 ? "" : "s"} waiting</span>
            </span>
          )}
        </button>
        <PickButton name={e.name} pick={pick} overrides={overrides} id={e.entry_id} />
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

  // On a phone the story column shows only the box; the bottom bar opens the path, the codex or the choices over it
  // (`desk-phone-<sheet>`), or Illustrate mode, full screen. See DeskPhone.
  const phoneSheet = phone && !illus ? sheet : null;
  const onPhone = phone ? [phoneSheet ? `desk-phone-${phoneSheet}` : "", phoneSheet || illus ? "desk-phone-open" : ""] : [];
  const classes = (illus ? ["desk", "desk-illus", ...onPhone] : ["desk", folded ? "desk-folded" : "", openId || quote !== null ? "desk-has-entry" : "", ...onPhone]).filter(Boolean).join(" ");
  // "Add as a fact…": the quote, and which entry it goes in (the entry column then shows that entry's new-fact form).
  const quotePick = quote !== null && (
    <div className="desk-quote-pick" role="group" aria-label="Add as a fact">
      <div className="row">
        <label className="desk-quote-entry">
          Add as a fact of
          <select aria-label="Entry for the fact" value={open ? open.entry_id : ""} onChange={(e) => setOpenId(e.target.value || null)}>
            <option value="">Choose an entry…</option>
            {GROUPS.map((g) => {
              const list = entries.filter((e) => g.types.includes(e.type));
              return (
                list.length > 0 && (
                  <optgroup key={g.title} label={g.title}>
                    {list.map((e) => (
                      <option key={e.entry_id} value={e.entry_id}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => setQuote(null)}>
          Cancel
        </button>
      </div>
      {!open && <blockquote className="fact-quote">“{quote}”</blockquote>}
    </div>
  );
  return (
    <>
    <DeskBar bar={bar} note={note} onSlot={setMenuSlot} />
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
          {newChapter && !holding ? (
            <p className="meta">Loading the draft…</p>
          ) : (
            <NewEntry chapterId={chapterId} path={path} holding={holding} entries={entries} onClose={() => setOpenId(null)} onMade={(id) => setOpenId(id)} />
          )}
        </section>
      )}
      {!illus && quote !== null && !open && openId !== "new" && (
        <section className="desk-entry" aria-label="Add as a fact">
          <div className="desk-entry-inner">{quotePick}</div>
        </section>
      )}
      {!illus && open && (
        <section className="desk-entry" aria-label={`Codex entry: ${open.name}`}>
          {quotePick}
          {newChapter && !holding ? (
            <p className="meta">Loading the draft…</p>
          ) : (
            <DeskEntry
              key={`${open.entry_id}|${quoteN}`}
              quote={quote}
              onQuoteDone={() => setQuote(null)}
              entry={open}
              entries={entries}
              codex={{ ...codex, ops: applied.ops, facts: applied.facts }}
              holding={holding}
              waiting={waiting[open.entry_id] ?? 0}
              inbox={inbox}
              onClose={() => setOpenId(null)}
            />
          )}
        </section>
      )}

      {/* Hidden, not removed, in Illustrate mode: an unsaved edit is still there when Codex is chosen again. */}
      {/* The path, the box and "What happens next?" belong to Codex mode; Illustrate shows the chapter's pictures. */}
      <div className="desk-story" hidden={illus}>
        <h1 className="visually-hidden">{editor ? `Edit “${here.title}”` : "New chapter"}</h1>
        <DeskPath storyId={storyId} blocks={pathBlocks} onQuote={startQuote} />
        <div className="desk-here" ref={hereRef}>
          {editor ? (
            // An Update makes a new revision: the box starts again from the chapter, its drafts kept with it.
            <ChapterEditEntry key={editor.baseRevision} {...editor} desk={{ onText, menuSlot, onNote: setNote, onOverrides: setOverrides, onSelection: setSelected, belowText }} />
          ) : newChapter ? (
            <ChapterEditor {...newChapter} desk={{ onText, menuSlot, onNote: setNote, onHeld: setHeld, onOverrides: setOverrides, onSelection: setSelected, belowText }} />
          ) : null}
        </div>
        {next}
      </div>
    </div>
    {phone && (
      <DeskPhone
        sheet={phoneSheet}
        onSheet={(s) => {
          if (s === "codex") setFolded(false);
          // The codex opens on its list; an entry opened there closes with it.
          else setOpenId(null);
          setSheet(s);
        }}
        illus={illus}
        canIllustrate={illustrate !== null}
        onIllustrate={(on) => choose(on ? "illustrate" : "codex")}
        pathCount={pathBlocks.length}
        choices={next ? nextCount : null}
        entry={phoneSheet === "codex" ? open : undefined}
        asOf={holding ? "as of the new chapter" : `as of “${here.title}”`}
        onCloseEntry={() => setOpenId(null)}
      />
    )}
    </>
  );
}

/** How an entry goes into the chapter's prompt: as the text decides, pinned in by hand, or left out by hand. */
type PromptPick = "auto" | "pinned" | "out";

/** Each pick: its row chip, the toggle's mark, and what it means. The toggle goes auto → pinned → left out → auto. */
const PICKS: Record<PromptPick, { chip: string; mark: string; note: string; next: PromptPick }> = {
  auto: { chip: "", mark: "○", note: "Sent with the prompt when it is named in the text, or always included", next: "pinned" },
  pinned: { chip: "pinned", mark: "●", note: "Pinned: sent with this chapter's prompt even when the text doesn't name it", next: "out" },
  out: { chip: "left out", mark: "⊘", note: "Left out of this chapter's prompt, even when the text names it", next: "auto" },
};

/** The small toggle beside a codex row: pins the entry to the chapter's prompt, leaves it out, or puts it back to auto. */
function PickButton({ id, name, pick, overrides }: { id: string; name: string; pick: PromptPick; overrides: DeskOverrides | null }) {
  const next = PICKS[pick].next;
  const label = { pinned: `Pin ${name} to the prompt`, out: `Leave ${name} out of the prompt`, auto: `Let the text decide whether ${name} goes into the prompt` }[next];
  return (
    <button
      type="button"
      className={`desk-pick ${pick}`}
      aria-label={label}
      title={`${PICKS[pick].note}. Click: ${label.charAt(0).toLowerCase()}${label.slice(1)}.`}
      disabled={!overrides}
      onClick={() => {
        if (!overrides) return;
        const { include, exclude } = overrides.value;
        const without = (list: string[]) => list.filter((k) => k !== id);
        overrides.set({ include: next === "pinned" ? [...without(include), id] : without(include), exclude: next === "out" ? [...without(exclude), id] : without(exclude) });
      }}
    >
      <span aria-hidden="true">{PICKS[pick].mark}</span>
    </button>
  );
}

/** The desk's top bar: the links back, a status line, and the chapter's ⋯ menu (put there by the chapter's box). */
export function DeskBar({ bar, note, onSlot }: { bar: ReactNode; note: string | null; onSlot: (el: HTMLElement | null) => void }) {
  return (
    <div className="desk-bar">
      <p className="crumbs">{bar}</p>
      {note && (
        <span className="meta desk-bar-note" role="status">
          {note}
        </span>
      )}
      <span className="desk-bar-menu" ref={onSlot} />
    </div>
  );
}

/** "+": a new entry's name, type and keywords, saved at once at the chapter; it opens when it is made. */
function NewEntry({
  chapterId,
  path,
  holding,
  entries,
  onClose,
  onMade,
}: {
  chapterId: string;
  path: PathChapter[];
  holding: Holding | null;
  entries: CodexEntry[];
  onClose: () => void;
  onMade: (id: string) => void;
}) {
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
      {holding && <HeldNote />}
      {error && <p className="error">{error}</p>}
      <EntryDetailsForm
        initial={null}
        busy={busy}
        path={path}
        chapterId={chapterId}
        inDraft={!!holding}
        onCancel={onClose}
        onSave={async (f, anchor) => {
          setBusy(true);
          setError(null);
          const r = await saveEntryChange(holding, chapterId, entries, { op: "create", ...f, content: "", always_include: false, anchor: holding ? anchor : chapterId });
          setBusy(false);
          if (r.error || !r.id) return setError(r.error ?? "Couldn't add the entry");
          if (!holding || anchor !== DRAFT_ANCHOR) router.refresh();
          onMade(r.id);
        }}
      />
    </div>
  );
}

/** The entry column's note on a chapter not posted yet. */
function HeldNote({ name, onDiscard }: { name?: string; onDiscard?: () => void }) {
  return (
    <p className="notice desk-held-note" role="note">
      This chapter isn&apos;t posted yet: codex changes made here are held in its draft and saved when you post it.
      {name && onDiscard && (
        <>
          {" "}
          {name} has changes held.{" "}
          <button type="button" className="link-button" onClick={onDiscard}>
            Discard them
          </button>
        </>
      )}
    </p>
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
  holding,
  waiting,
  inbox,
  onClose,
  quote = null,
  onQuoteDone,
}: {
  /** "Add as a fact…": the Facts tab opens with the new-fact form, these words its quote. */
  quote?: string | null;
  onQuoteDone?: () => void;
  entry: CodexEntry;
  entries: CodexEntry[];
  /** On a new chapter, `ops` and `facts` have the draft's held changes in them. */
  codex: DeskCodex;
  holding: Holding | null;
  waiting: number;
  inbox: ReturnType<typeof useCodexInbox>;
  onClose: () => void;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const { storyId, chapterId, path, ops, facts } = codex;
  // On a new chapter, "here" is the new chapter (DRAFT_ANCHOR): what is changed there is held in its draft.
  const here = holding ? holding.here : path[path.length - 1];
  const fullPath = holding ? [...path, holding.here] : path;
  const shared = entry.shared_entry_id;
  // Only in the draft so far (made on this new chapter): it has no page, icon or history on the server yet.
  const draftOnly = isDraftEntry(entry.entry_id);
  const { busy, error, setError, replace, share, removeHere, retire } = useEntryActions({
    entry,
    chapterId,
    storyId,
    save: holding
      ? async (c) => {
          const r = await saveEntryChange(holding, chapterId, [...entries, ...retiredEntries(ops)], c);
          if (!r.error && c.anchor && c.anchor !== DRAFT_ANCHOR) router.refresh();
          return r.error ?? null;
        }
      : undefined,
    onRetired: () => {
      onClose();
      router.refresh();
    },
  });
  const heldHere = !!holding && (holding.held.changes.some((c) => c.entry_id === entry.entry_id) || holding.held.facts.some((f) => f.entry_id === entry.entry_id));
  const discardHeld = () =>
    holding?.held.update((h) => ({ changes: h.changes.filter((c) => c.entry_id !== entry.entry_id), facts: h.facts.filter((f) => f.entry_id !== entry.entry_id) }));
  const [tab, setTab] = useState<Tab>(waiting > 0 && !quote ? "suggestions" : "facts");
  const [panel, setPanel] = useState<"details" | "icon" | "compare" | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const icon = codex.icons[entry.entry_id] ?? null;
  const start = entryStart(ops, fullPath, entry.entry_id);
  const titleOf = (id: string) => (id === DRAFT_ANCHOR ? "this chapter (not posted yet)" : (path.find((p) => p.id === id)?.title ?? "an earlier chapter"));
  const toggle = (p: NonNullable<typeof panel>) => setPanel(panel === p ? null : p);

  return (
    <div className="desk-entry-inner">
      <div className="desk-entry-bar">
        <span className="meta">
          {TYPE_LABELS[entry.type]} · {holding ? "as of the new chapter" : `as of “${here.title}”`}
        </span>
        {/* On a new chapter the actions that save at a posted chapter wait for the Post (greyed out, with why). */}
        <MoreMenu label="More entry actions">
          <button
            type="button"
            disabled={!!holding && !!shared}
            title={holding && shared ? `${NOT_POSTED} A shared entry's details are saved at a posted chapter.` : undefined}
            onClick={() => setPanel("details")}
          >
            Edit details
          </button>
          <button type="button" disabled={draftOnly} title={draftOnly ? `${NOT_POSTED} The entry is only in the draft.` : undefined} onClick={() => setPanel("compare")}>
            Compare with a chapter…
          </button>
          {!shared && (
            <button
              type="button"
              disabled={busy || !!holding}
              title={holding ? `${NOT_POSTED} An entry is shared as it reads at a posted chapter.` : `Make this a shared entry, as it reads at “${here.title}”, so other stories can add it too.`}
              onClick={() => void share(here.title)}
            >
              Share to other stories…
            </button>
          )}
          {draftOnly ? (
            <button type="button" disabled title={`${NOT_POSTED} The entry is only in the draft.`}>
              Open on its own page
            </button>
          ) : (
            <Link href={`/s/${storyId}/codex/${entry.entry_id}?at=${chapterId}`}>Open on its own page</Link>
          )}
          <button
            type="button"
            className="danger"
            disabled={busy || !!holding || codex.after.length === 0}
            title={
              holding
                ? `${NOT_POSTED} Nothing is written after a new chapter.`
                : codex.after.length > 0
                  ? `${entry.name} stays in the ${codex.after.length === 1 ? "chapter" : `${codex.after.length} chapters`} after “${here.title}”.`
                  : "No chapter has been written after this one, so there is nothing to keep it in. Use Retire."
            }
            onClick={() => void removeHere(here.title, codex.after)}
          >
            Remove from this chapter only…
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy || !!holding}
            title={holding ? `${NOT_POSTED} Then retire it on the desk, from this chapter on.` : `Gone from “${here.title}” and every chapter after it. Earlier chapters keep it.`}
            onClick={() => void retire()}
          >
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
          title={draftOnly ? `${NOT_POSTED} A new entry gets its icon once it is saved.` : icon !== null ? "Change the icon" : "Add an icon"}
          disabled={draftOnly}
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
      {holding && <HeldNote name={heldHere ? entry.name : undefined} onDiscard={heldHere ? discardHeld : undefined} />}
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
              inDraft={!!holding}
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
            path={fullPath}
            chapterId={here.id}
            storyId={storyId}
            usedAspects={usedAspectsOf(entries)}
            start={start}
            laterForm={holding ? null : (codex.laterForms[entry.entry_id] ?? null)}
            formChapters={holding ? [holding.here] : codex.formChapters}
            suggestions={[]}
            quote={quote}
            onQuoteDone={onQuoteDone}
            onSaved={refresh}
            onError={setError}
            hold={
              holding
                ? (f) =>
                    holding.held.update((h) => ({
                      ...h,
                      facts: addFactChange(h.facts, { ...f, entry_id: entry.entry_id, fact_id: f.fact_id ?? `draft-fact-${localId().slice(6)}` }),
                    }))
                : undefined
            }
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
        {tab === "suggestions" && (
          <DeskSuggestions
            entry={entry}
            storyId={storyId}
            chapterId={chapterId}
            path={path}
            start={start}
            inbox={inbox}
            askOff={holding ? `${NOT_POSTED} The AI reads the chapter's text once it is posted.` : null}
          />
        )}
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
