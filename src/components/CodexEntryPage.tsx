"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DRAFT_ANCHOR,
  FACT_LIMITS,
  factHistory,
  codexBlock,
  factSharedState,
  formLine,
  isAiFact,
  isFormAspect,
  overriddenFacts,
  sameAspect,
  TYPE_LABELS,
  type CodexEntry,
  type CodexOp,
  type FactOp,
  type LiveFact,
} from "@/lib/codex";
import type { PathChapter } from "@/lib/ai/codexAi";
import type { CodexSuggestion } from "@/lib/codexSuggestions";
import { entryHints } from "@/lib/codexHints";
import { useSettings } from "@/lib/settings";
import { codexIconUrl, type IconChoice } from "@/lib/codexIconUrl";
import { EntryDetailsForm, EntryHistoryList, useEntryActions } from "./CodexEntryEditor";
import { EntryHints } from "./CodexFacts";
import CodexIconPicker from "./CodexIconPicker";
import { INBOX_CHANGED, useCodexInbox } from "./CodexInbox";
import FleshOutEntry from "./FleshOutEntry";
import LinkedEntryDetails from "./LinkedEntryDetails";
import MoreMenu from "./MoreMenu";
import UpdateFromStory from "./UpdateFromStory";
import { AspectPicker } from "./AspectPicker";
import TidyEntry from "./TidyEntry";
import { canDifferByForm } from "@/lib/codexCategories";

export type Chapter = { id: string; title: string };
/** The next chapter on a branch from here that sets the entry's form again ("Lasts until …"). */
export type LaterForm = { chapter_id: string; title: string; form: string; stage: string } | null;

export type EntryPageNav = {
  /** The chapter's codex in the Story Bible. */
  codexHref: string;
  prev: Chapter | null;
  next: Chapter | null;
  /** The chapters on the path before this one where the entry is in the codex, oldest first. */
  earlier: Chapter[];
  /** The chapters written right after this one; `more` when chapters follow them too. */
  later: (Chapter & { more: boolean })[];
};

type Props = {
  entry: CodexEntry;
  /** Every entry op on the path, for the history. */
  ops: CodexOp[];
  /** Every fact op on the path, for each fact's history. */
  facts: FactOp[];
  /** The chapters from the story's first to `chapterId`. */
  path: PathChapter[];
  /** The chapter the entry is viewed and edited at. */
  chapterId: string;
  storyId: string;
  usedAspects: string[];
  /** The entry's icon version (see codexIcons), or null when it has none. */
  icon: number | null;
  /** The story's saved pictures the icon can be picked from. */
  iconChoices: IconChoice[];
  /** The chapters already written after `chapterId`: "Remove from this chapter only" keeps the entry in them. */
  after: Chapter[];
  nav: EntryPageNav;
  /** Where the entry first appears on this path: "it was always so" anchors there. */
  start: Chapter;
  /** "First appears in … Change…". */
  startPicker: ReactNode;
  /** "Compare with a chapter…": the chapter picker, and the comparison when one is shown (`?compare=`). */
  compare: { picker: ReactNode; result: ReactNode | null };
  /** The chapter's summary ("Summary of this chapter" in the ⋯ menu). */
  summary: string | null;
  laterForm: LaterForm;
  /** The chapters a form change can start at: this one, then later ones on its branches. */
  formChapters: Chapter[];
};

type Body = { op: "set" | "retire"; aspect: string; form: string; text: string; quote: string; fact_id?: string; anchor: string };
type Tab = "ai" | "history" | "update";

const NEW_FORM = "\u0000new";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where a suggestion is reviewed: beside its chapter's text. */
const reviewHref = (chapterId: string, entryId: string, hash: string) => `/c/${chapterId}/codex-review?entry=${encodeURIComponent(entryId)}${hash}`;
/** A suggestion backed by the chapter's text (a chapter reading, or a Flesh out that stayed close to the story): reviewed beside the text. */
const fromText = (s: CodexSuggestion) => s.source === "chapter" || (s.source === "expand" && !!s.quote);

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? null : (data.error ?? `Request failed (${res.status})`);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Closes an open <details> popup when the page is clicked anywhere else. */
function useCloseOnClickAway() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);
  return ref;
}

/**
 * A codex entry's own page at a chapter: the bar with the chapter it is shown at, its details, the changes waiting in the
 * chapter's text, its facts as of the chapter (with the AI's suggestions marked on them), what the AI is told, the AI's
 * own ideas, and tabs for the rest.
 */
export default function CodexEntryPage(props: Props) {
  const { entry, ops, facts, path, chapterId, storyId, usedAspects, icon, iconChoices, after, nav, start, startPicker, compare, summary, laterForm, formChapters } = props;
  const router = useRouter();
  const shared = entry.shared_entry_id;
  const { busy, error, setError, replace, share, removeHere, retire } = useEntryActions({ entry, chapterId, storyId });
  // A linked entry's details hold its notice (where its name and details come from), so they are open until closed
  // (also right after the entry is shared from the ⋯ menu).
  const [detailsToggled, setDetailsOpen] = useState<boolean | null>(null);
  const detailsOpen = detailsToggled ?? Boolean(entry.shared_entry_id);
  const [savedNote, setSavedNote] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("ai");
  const refresh = () => router.refresh();
  const inbox = useCodexInbox({ storyId, onPath: { chapterIds: path.map((c) => c.id), entryId: entry.entry_id, onChanged: refresh } });
  const open = useMemo(() => (inbox.items ?? []).filter((s) => s.status === "open"), [inbox.items]);

  const here = path.find((c) => c.id === chapterId) ?? { id: chapterId, title: "this chapter" };
  const titleOf = (id: string) => (id === DRAFT_ANCHOR ? "this chapter (not posted yet)" : (path.find((p) => p.id === id)?.title ?? "an earlier chapter"));

  // What waits to be reviewed beside the text, by chapter: suggestions with a quote, and facts the AI applied unasked.
  const waiting = new Map<string, { id: string; title: string; n: number }>();
  const addWaiting = (id: string, title: string) => {
    const c = waiting.get(id);
    if (c) c.n++;
    else waiting.set(id, { id, title, n: 1 });
  };
  for (const s of open) if (fromText(s)) addWaiting(s.chapter_id, s.chapter_title);
  for (const f of entry.facts) if (isAiFact(f)) addWaiting(f.op.anchor_chapter_id, titleOf(f.op.anchor_chapter_id));
  const waitingHere = waiting.get(chapterId)?.n ?? 0;
  const waitingEarlier = path
    .filter((c) => c.id !== chapterId && waiting.has(c.id))
    .map((c) => waiting.get(c.id)!)
    .reverse();

  const ideas = open.filter((s) => s.source === "expand" && !s.quote);

  function reveal(id: string) {
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
  }

  return (
    <div className="entry-editor entry-page">
      <header className="entry-bar">
        <Link className="entry-bar-back" href={nav.codexHref}>
          ← Codex
        </Link>
        <h1 className="entry-bar-name">{entry.name}</h1>
        <div className="entry-bar-at">
          <span className="meta">as of</span>
          {nav.prev ? (
            <Link className="entry-bar-step" href={`/s/${storyId}/codex/${entry.entry_id}?at=${nav.prev.id}`} aria-label={`Previous chapter: “${nav.prev.title}”`} title={`“${nav.prev.title}”`}>
              ‹
            </Link>
          ) : (
            <span className="entry-bar-step off" aria-hidden="true">
              ‹
            </span>
          )}
          <ChapterPicker storyId={storyId} entryId={entry.entry_id} here={here} nav={nav} />
          {nav.next ? (
            <Link className="entry-bar-step" href={`/s/${storyId}/codex/${entry.entry_id}?at=${nav.next.id}`} aria-label={`Next chapter: “${nav.next.title}”`} title={`“${nav.next.title}”`}>
              ›
            </Link>
          ) : (
            <span className="entry-bar-step off" aria-hidden="true">
              ›
            </span>
          )}
        </div>
        <div className="entry-bar-menu">
          <MoreMenu label="More entry actions">
            <button
              type="button"
              onClick={() => {
                setDetailsOpen(true);
                reveal("entry-details");
              }}
            >
              Edit details
            </button>
            <button
              type="button"
              onClick={() => {
                setIconOpen(true);
                reveal("entry-icon");
              }}
            >
              Change the icon…
            </button>
            <button
              type="button"
              onClick={() => {
                setCompareOpen(true);
                reveal("entry-compare-panel");
              }}
            >
              Compare with a chapter…
            </button>
            <button
              type="button"
              onClick={() => {
                setSummaryOpen(true);
                reveal("entry-summary");
              }}
            >
              Summary of this chapter
            </button>
            {!shared && (
              <button type="button" disabled={busy} title={`Make this a shared entry, as it reads at “${here.title}”, so other stories can add it too. This story keeps reading it just as it does now.`} onClick={() => void share(here.title)}>
                Share to other stories…
              </button>
            )}
            <button
              type="button"
              className="danger"
              disabled={busy || after.length === 0}
              title={
                after.length > 0
                  ? `${entry.name} stays in the ${after.length === 1 ? "chapter" : `${after.length} chapters`} after “${here.title}”.`
                  : "No chapter has been written after this one, so there is nothing to keep it in. Use Retire from here on."
              }
              onClick={() => void removeHere(here.title, after)}
            >
              Remove from this chapter only…
            </button>
            <button type="button" className="danger" disabled={busy} title={`Gone from “${here.title}” and every chapter after it. Earlier chapters keep it.`} onClick={() => void retire()}>
              Retire from here on…
            </button>
          </MoreMenu>
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {(compareOpen || compare.result) && (
        <section className="entry-section entry-compare" id="entry-compare-panel" aria-label="Comparison">
          {compare.result}
          {compare.picker}
          {!compare.result && (
            <div>
              <button type="button" className="secondary" onClick={() => setCompareOpen(false)}>
                Close
              </button>
            </div>
          )}
        </section>
      )}
      {summaryOpen && (
        <section className="entry-section" id="entry-summary" aria-label={`Summary of “${here.title}”`}>
          <h2>Summary of “{here.title}”</h2>
          {summary?.trim() ? (
            <p className="entry-notes">{summary.trim()}</p>
          ) : (
            <p className="meta">
              No summary yet. <Link href={`/c/${chapterId}`}>Open the chapter</Link>
            </p>
          )}
          <div>
            <button type="button" className="secondary" onClick={() => setSummaryOpen(false)}>
              Close
            </button>
          </div>
        </section>
      )}

      <div className="entry-details-line">
        <button
          type="button"
          className="codex-icon-button"
          aria-expanded={iconOpen}
          aria-label={icon !== null ? `Change the icon of ${entry.name}` : `Add an icon for ${entry.name}`}
          title={icon !== null ? "Change the icon" : "Add an icon"}
          onClick={() => setIconOpen(!iconOpen)}
        >
          {icon !== null ? (
            // eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size
            <img className="codex-icon" src={codexIconUrl(storyId, entry.entry_id, icon)} alt={`Icon of ${entry.name}`} />
          ) : (
            <span className="codex-icon codex-icon-empty" aria-hidden="true">
              +
            </span>
          )}
        </button>
        <div className="entry-details-text">
          <span>
            {TYPE_LABELS[entry.type]}
            {entry.always_include && <span className="tag"> · always included</span>}
            {shared && (
              <>
                {" · "}
                <Link href={`/shared/${shared}`}>shared</Link>
              </>
            )}
          </span>
          {startPicker}
          <span className="entry-keywords-line">Keywords: {entry.aliases.length > 0 ? entry.aliases.join(", ") : "none"}</span>
          <button type="button" className="link-button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
            Edit details
          </button>
        </div>
      </div>
      {iconOpen && (
        <section className="entry-section" id="entry-icon" aria-label="Icon">
          <h2>Icon</h2>
          <CodexIconPicker storyId={storyId} entryId={entry.entry_id} entryName={entry.name} version={icon} saved={iconChoices} onChanged={refresh} />
          <div>
            <button type="button" className="secondary" onClick={() => setIconOpen(false)}>
              Close
            </button>
          </div>
        </section>
      )}
      {detailsOpen && (
        <section className="entry-section" id="entry-details" aria-label={shared ? "Details" : "Name, type and keywords"}>
          <h2>{shared ? "Details" : "Name, type and keywords"}</h2>
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
            <button type="button" className="secondary" onClick={() => setDetailsOpen(false)}>
              Close
            </button>
          </div>
        </section>
      )}

      {/* What the AI is actually told comes first: the facts below are how it is made. */}
      <AiToldBox entry={entry} here={here.title} />

      {(waitingHere > 0 || waitingEarlier.length > 0) && (
        <p className="entry-waiting">
          {waitingHere > 0 ? (
            <Link href={reviewHref(chapterId, entry.entry_id, "")} prefetch={false}>
              {plural(waitingHere, "change")} waiting from “{here.title}” · Review beside the text →
            </Link>
          ) : (
            <span>Changes waiting from earlier chapters</span>
          )}
          {waitingEarlier.map((c, i) => (
            <span key={c.id}>
              {" · "}
              {waitingHere > 0 || i > 0 ? "also " : ""}
              <Link href={reviewHref(c.id, entry.entry_id, "")} prefetch={false}>
                “{c.title}” ({c.n})
              </Link>
            </span>
          ))}
        </p>
      )}

      <FactsTable
        entry={entry}
        factOps={facts}
        path={path}
        chapterId={chapterId}
        storyId={storyId}
        usedAspects={usedAspects}
        start={start}
        laterForm={laterForm}
        formChapters={formChapters}
        suggestions={open.filter(fromText)}
        onSaved={refresh}
        onError={setError}
      />

      {ideas.length > 0 && (
        <AiIdeas
          entry={entry}
          ideas={ideas}
          start={start}
          dismiss={async (s) => {
            await inbox.dismiss(s);
          }}
          errors={inbox.errors}
          onKept={() => {
            window.dispatchEvent(new Event(INBOX_CHANGED));
            refresh();
          }}
        />
      )}

      <EntryTabs
        tab={tab}
        setTab={setTab}
        tabs={[
          { id: "ai", label: "What the AI reads" },
          { id: "history", label: "History" },
          { id: "update", label: "Update from the story" },
        ]}
      >
        {tab === "ai" && (
          <>
            <AiText entry={entry} />
            <p className="meta">The AI reads this when {entry.name} is named or a keyword appears nearby{entry.always_include ? " (always, here)" : ""}. The facts of other forms are not sent.</p>
          </>
        )}
        {tab === "history" && <EntryHistoryList entry={entry} ops={ops} titleOf={titleOf} busy={busy} replace={replace} />}
        {tab === "update" && (
          <UpdateFromStory
            storyId={storyId}
            chapterId={chapterId}
            entry={entry}
            path={path}
            changes={new Set([...ops, ...facts].filter((o) => o.entry_id === entry.entry_id).map((o) => o.anchor_chapter_id))}
          />
        )}
      </EntryTabs>
    </div>
  );
}

/** The chapter the entry is shown at, as a button: opens the chapters on the path (where the entry is) and those right after. */
function ChapterPicker({ storyId, entryId, here, nav }: { storyId: string; entryId: string; here: Chapter; nav: EntryPageNav }) {
  const ref = useCloseOnClickAway();
  const href = (id: string) => `/s/${storyId}/codex/${entryId}?at=${id}`;
  return (
    <details className="entry-chapter-picker" ref={ref}>
      <summary aria-label={`Shown as of “${here.title}”: choose another chapter`}>“{here.title}” ▾</summary>
      <nav className="entry-chapter-list" aria-label="Chapters" onClick={(e) => (e.target as Element).closest("a") && ref.current && (ref.current.open = false)}>
        <ol>
          {nav.earlier.map((c) => (
            <li key={c.id}>
              <Link href={href(c.id)}>{c.title}</Link>
            </li>
          ))}
          <li>
            <strong aria-current="page">{here.title}</strong>
          </li>
        </ol>
        {nav.later.length > 0 && (
          <>
            <p className="meta">After this</p>
            <ul>
              {nav.later.map((c) => (
                <li key={c.id}>
                  <Link href={href(c.id)}>{c.title}</Link>
                  {c.more && <span className="meta" title="More chapters follow"> …</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>
    </details>
  );
}

/** The entry exactly as a prompt gives it to the AI: its name line and a bullet for each fact (codexBlock). */
export function AiText({ entry }: { entry: CodexEntry }) {
  if (!entry.description) return <div className="fact-ai"><em>Nothing yet — add facts.</em></div>;
  const head = `${entry.name} [${entry.type}]${entry.aliases.length ? ` (also: ${entry.aliases.join(", ")})` : ""}`;
  return <div className="fact-ai">{codexBlock(head, entry.description)}</div>;
}

/** "What the AI is told at …": the entry's text for the AI, and which every-form facts the current form replaces. */
function AiToldBox({ entry, here }: { entry: CodexEntry; here: string }) {
  const cur = entry.form?.name ?? entry.baseForm;
  const replaced = replacedEvery(entry);
  return (
    <section className="entry-section entry-ai-told" aria-label={`What the AI is told at “${here}”`}>
      <h2>What the AI is told at “{here}”</h2>
      <AiText entry={entry} />
      {cur && replaced.length > 0 && (
        <p className="meta">
          {entry.name}&apos;s {cur} facts replace the every-form {replaced.map((f) => f.aspect.trim()).join(", ")} while {entry.name} is {cur}.
        </p>
      )}
    </section>
  );
}

/** Every-form facts the current form has its own fact for, on the same aspect: while the entry is in that form, the form's wins. */
function replacedEvery(entry: CodexEntry): LiveFact[] {
  const ids = overriddenFacts(entry);
  return entry.facts.filter((f) => ids.includes(f.fact_id));
}

type Marker = { key: string; tone: "suggest" | "conflict" | "ai"; text: string; href: string };

/** The markers under a fact: what the chapters' text suggests for it, contradicts in it, or the AI changed in it unasked. */
function Markers({ list }: { list: Marker[] }) {
  if (list.length === 0) return null;
  return (
    <div className="ef-markers">
      {list.map((m) => (
        <Link key={m.key} className={`ef-marker ef-marker-${m.tone}`} href={m.href} prefetch={false}>
          <span>
            <span aria-hidden="true">● </span>
            {m.text}
          </span>
        </Link>
      ))}
    </div>
  );
}

function suggestionMarker(s: CodexSuggestion, entryId: string): Marker {
  const href = reviewHref(s.chapter_id, entryId, `#s-${s.id}`);
  const ch = `“${s.chapter_title}”`;
  if (s.kind === "conflict") return { key: s.id, tone: "conflict", text: `${ch} says “${s.after || s.quote}” · contradicts · Review`, href };
  if (s.kind === "retire") return { key: s.id, tone: "suggest", text: `${ch} suggests removing it · Review`, href };
  const after = s.kind === "form" ? [s.form, s.after].filter(Boolean).join(", ") : s.after;
  return { key: s.id, tone: "suggest", text: `${ch} suggests “${after}” · Review`, href };
}

function aiMarker(f: LiveFact, entryId: string, titleOf: (id: string) => string): Marker {
  return { key: `f-${f.op.id}`, tone: "ai", text: `Added by the AI from “${titleOf(f.op.anchor_chapter_id)}” · Approve or undo`, href: reviewHref(f.op.anchor_chapter_id, entryId, `#f-${f.op.id}`) };
}

/**
 * The entry's facts as of the chapter: the form first, then the every-form facts, the current form's own, and the other
 * forms' folded away. Each row opens its editor when tapped; its ⋯ holds History, Remove and Retcon.
 */
export function FactsTable({
  entry,
  factOps,
  path,
  chapterId,
  storyId,
  usedAspects,
  start,
  laterForm,
  formChapters,
  suggestions,
  onSaved,
  onError,
  desk = false,
}: {
  /** On the writing desk (inside its Facts tab): no heading, the buttons first, and no Flesh out. */
  desk?: boolean;
  entry: CodexEntry;
  factOps: FactOp[];
  path: PathChapter[];
  chapterId: string;
  storyId: string;
  usedAspects: string[];
  start: Chapter;
  laterForm: LaterForm;
  formChapters: Chapter[];
  /** Open suggestions for the entry backed by the text, on the path. */
  suggestions: CodexSuggestion[];
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const settings = useSettings();
  // A fact's id while it is being changed, "new" while one is being added.
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [fleshOpen, setFleshOpen] = useState(false);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const here = path.find((c) => c.id === chapterId)?.title ?? "this chapter";
  const titleOf = (id: string) => path.find((p) => p.id === id)?.title ?? "an earlier chapter";
  const since = (id: string) => (path[0]?.id === id ? "from the start" : `since “${titleOf(id)}”`);
  const sharedState = (factId: string) => factSharedState(factHistory(factOps, factId));

  async function run(action: () => Promise<string | null>): Promise<boolean> {
    setBusy(true);
    onError(null);
    const problem = await action();
    setBusy(false);
    if (problem) {
      onError(problem);
      return false;
    }
    onSaved();
    return true;
  }
  const send = (b: Body) =>
    run(() => post("/api/codex/facts", { anchor_chapter_id: b.anchor, entry_id: entry.entry_id, fact_id: b.fact_id, op: b.op, aspect: b.aspect, form: b.form, text: b.text, quote: b.quote }));
  const resetShared = (factId: string) => run(() => post("/api/codex/reset-fact", { anchor_chapter_id: chapterId, entry_id: entry.entry_id, fact_id: factId }));

  const rows = entry.facts.filter((f) => !isFormAspect(f.aspect));
  const hasForms = entry.forms.length > 0;
  // With no form set, an entry that has had one reads as in its normal form.
  const cur = entry.form?.name ?? entry.baseForm;
  const isCur = (name: string) => cur !== null && sameAspect(name, cur);
  const every = rows.filter((f) => f.form === "");
  const own = cur ? rows.filter((f) => f.form !== "" && isCur(f.form)) : [];
  const others = entry.forms.filter((name) => !isCur(name)).map((name) => ({ name, facts: rows.filter((f) => f.form !== "" && sameAspect(f.form, name)) })).filter((g) => g.facts.length > 0);
  const replaced = new Set(overriddenFacts(entry));
  const showForm = hasForms || entry.type === "character" || entry.form !== null;
  // Facts of a form, but no form was ever set: they can't apply, and the AI isn't sent them.
  const needsForm = entry.form === null && entry.baseForm === null && hasForms;
  const hints = entryHints(entry, { chapterTexts: path.map((c) => c.body), contextTokens: settings.contextTokens });

  // Suggestions sorted onto the facts they are about; the rest are new aspects (a placeholder row each) or general.
  const used = new Set<string>();
  const markersFor = (f: LiveFact): Marker[] => {
    const out: Marker[] = [];
    if (f.aspect.trim()) {
      for (const s of suggestions) {
        if ((s.kind === "set" || s.kind === "retire" || s.kind === "conflict") && sameAspect(s.aspect, f.aspect) && sameAspect(s.form, f.form)) {
          used.add(s.id);
          out.push(suggestionMarker(s, entry.entry_id));
        }
      }
    }
    if (isAiFact(f)) out.push(aiMarker(f, entry.entry_id, titleOf));
    return out;
  };
  const formMarkers: Marker[] = [];
  for (const s of suggestions) {
    if (s.kind !== "form") continue;
    used.add(s.id);
    formMarkers.push(suggestionMarker(s, entry.entry_id));
  }
  if (entry.form && isAiFact(entry.form.fact)) formMarkers.push(aiMarker(entry.form.fact, entry.entry_id, titleOf));
  // (Worked out before the rows render, so the leftovers are known.)
  const rowMarkers = new Map(rows.map((f) => [f.fact_id, markersFor(f)]));
  const newAspects = suggestions.filter((s) => !used.has(s.id) && s.kind === "set" && s.aspect.trim());
  const general = suggestions.filter((s) => !used.has(s.id) && !(s.kind === "set" && s.aspect.trim()));

  const hiddenShared = entry.shared_entry_id
    ? [...new Set(factOps.filter((o) => o.entry_id === entry.entry_id).map((o) => o.fact_id))].flatMap((id) => {
        const h = factHistory(factOps, id);
        const last = h[h.length - 1];
        if (!last || last.op !== "retire" || !h.some((o) => o.id.startsWith("shared-"))) return [];
        const shown = [...h].reverse().find((o) => o.op === "set") ?? last;
        return [{ fact_id: id, aspect: shown.aspect, text: shown.text }];
      })
    : [];

  const editor = (fact: LiveFact | null) => (
    <FactEditor
      key={fact?.fact_id ?? "new"}
      entry={entry}
      fact={fact}
      chapterId={chapterId}
      here={here}
      start={start}
      titleOf={titleOf}
      usedAspects={usedAspects}
      busy={busy}
      onCancel={() => setEditing(null)}
      onSave={async (b) => {
        if (await send(b)) setEditing(null);
      }}
    />
  );

  const row = (f: LiveFact) => {
    const versions = [...factHistory(factOps, f.fact_id)].reverse();
    const struck = replaced.has(f.fact_id);
    const label = f.aspect || "the fact";
    return (
      <div key={f.fact_id} id={`fact-${f.fact_id}`} className={struck ? "fact-row ef-row replaced" : "fact-row ef-row"}>
        <button type="button" className="ef-main" aria-label={`Edit ${label}: ${f.text}`} aria-expanded={editing === f.fact_id} onClick={() => setEditing(editing === f.fact_id ? null : f.fact_id)}>
          <span className="ef-aspect">{f.aspect || "—"}</span>
          <span className="ef-value">
            <span className="fact-line">{f.text}</span>
            {struck && cur && (
              <span className="ef-replaced-note">
                {" "}
                · replaced by the {cur} {f.aspect.trim()} while {entry.name} is {cur}
              </span>
            )}
          </span>
        </button>
        <span className="ef-since meta">
          {since(f.op.anchor_chapter_id)}
          {f.op.anchor_chapter_id === chapterId && <span className="tag"> · changed here</span>}
          {entry.shared_entry_id && sharedState(f.fact_id) === "base" && <span className="tag"> · shared</span>}
          {entry.shared_entry_id && sharedState(f.fact_id) === "changed" && <span className="tag"> · shared, changed in this story</span>}
          {entry.shared_entry_id && sharedState(f.fact_id) === "own" && <span className="tag"> · this story only</span>}
        </span>
        <div className="ef-menu">
          <MoreMenu label={`More for ${label}`}>
            <button type="button" onClick={() => setEditing(f.fact_id)}>
              Edit
            </button>
            <button type="button" aria-expanded={history.includes(f.fact_id)} onClick={() => setHistory(history.includes(f.fact_id) ? history.filter((h) => h !== f.fact_id) : [...history, f.fact_id])}>
              History ({plural(versions.length, "version")})
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove “${f.aspect || f.text}” from “${here}” on? Earlier chapters keep it.`)) {
                  void send({ op: "retire", aspect: f.aspect, form: f.form, text: "", quote: "", fact_id: f.fact_id, anchor: chapterId });
                }
              }}
            >
              Remove from “{here}” on…
            </button>
            {entry.shared_entry_id && sharedState(f.fact_id) === "changed" && (
              <button type="button" disabled={busy} onClick={() => void resetShared(f.fact_id)}>
                Reset to the shared fact
              </button>
            )}
            {!isAiFact(f) && (
              <Link href={`/s/${storyId}/review?tab=retcons&chapter=${chapterId}&entry=${encodeURIComponent(entry.entry_id)}&fact=${encodeURIComponent(f.fact_id)}`} aria-label={`Retcon ${label}`}>
                Retcon the chapters…
              </Link>
            )}
          </MoreMenu>
        </div>
        <Markers list={rowMarkers.get(f.fact_id) ?? []} />
        {editing === f.fact_id && <div className="ef-wide">{editor(f)}</div>}
        {history.includes(f.fact_id) && (
          <ol className="history ef-wide">
            {versions.map((v, i) => (
              <li key={v.id}>
                <div className="meta" style={{ margin: 0 }}>
                  <strong>{v.op === "retire" ? "Removed" : i === versions.length - 1 ? "Added" : "Changed"}</strong> in “{titleOf(v.anchor_chapter_id)}”
                  {v.form ? ` · ${v.form} only` : ""}
                  {v.ai_suggestion_id ? " · by the AI" : ""}
                  {i === 0 && v.op !== "retire" ? " · current" : ""}
                </div>
                {v.op !== "retire" && (
                  <div className={i === 0 ? "version" : "version old"}>
                    {v.text}
                    {v.quote && <div className="fact-quote">“{v.quote}”</div>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  };

  // "+ Add a fact" and the rest, with the forms they open. On the writing desk they come first, each form right under
  // the buttons, and asking the AI for facts is in the Suggestions tab instead.
  const tidy = tidyOpen && <TidyEntry entry={entry} storyId={storyId} chapterId={chapterId} onApplied={onSaved} onClose={() => setTidyOpen(false)} />;
  const buttons = (
    <div className="row ef-add">
      {editing !== "new" && (
        <button type="button" className="secondary" disabled={busy} onClick={() => setEditing("new")}>
          + Add a fact
        </button>
      )}
      {!desk && !fleshOpen && (
        <button type="button" className="secondary" onClick={() => setFleshOpen(true)}>
          + Flesh out with AI…
        </button>
      )}
      {!tidyOpen && rows.length > 1 && (
        <button type="button" className="secondary" onClick={() => setTidyOpen(true)}>
          Tidy this entry…
        </button>
      )}
    </div>
  );
  const adding = desk ? (
    <>
      {buttons}
      {editing === "new" && editor(null)}
      {tidy}
    </>
  ) : (
    <>
      {editing === "new" && editor(null)}
      {buttons}
      {fleshOpen && <FleshOutEntry storyId={storyId} chapterId={chapterId} entryId={entry.entry_id} name={entry.name} startOpen onCancel={() => setFleshOpen(false)} />}
      {tidy}
    </>
  );

  return (
    <section className={desk ? "entry-section entry-facts desk-facts" : "entry-section entry-facts"} id="entry-facts" aria-labelledby={desk ? undefined : "entry-facts-title"} aria-label={desk ? `Facts as of “${here}”` : undefined}>
      {!desk && <h2 id="entry-facts-title">Facts as of “{here}”</h2>}
      {desk && adding}
      <EntryHints
        entry={entry}
        hints={hints}
        busy={busy}
        editing={editing}
        onEdit={(factId) => {
          setEditing(factId);
          requestAnimationFrame(() => document.getElementById(`fact-${factId}`)?.scrollIntoView({ block: "nearest" }));
        }}
        onRemove={(drop) => void send({ op: "retire", aspect: drop.aspect, form: drop.form, text: "", quote: "", fact_id: drop.fact_id, anchor: drop.op.anchor_chapter_id })}
      />

      {showForm && (
        <div className="ef-row ef-form-row">
          <div className="ef-main ef-static">
            <span className="ef-aspect">Form</span>
            <span className="ef-value facts-form">
              {entry.form ? (
                <>
                  <strong>{entry.form.name}</strong>
                  {entry.form.note && <> — {entry.form.note}</>}
                </>
              ) : entry.baseForm ? (
                <>
                  <strong>{entry.baseForm}</strong> <span className="meta">(normal form)</span>
                </>
              ) : (
                <span className="meta">No form set.</span>
              )}
            </span>
          </div>
          <span className="ef-since meta">
            {entry.form && since(entry.form.fact.op.anchor_chapter_id)}
            {entry.baseForm && entry.form && !sameAspect(entry.form.name, entry.baseForm) && ` · normal form: ${entry.baseForm}`}
          </span>
          <div className="ef-menu">
            {!formOpen && (
              <button type="button" className="secondary" disabled={busy} onClick={() => setFormOpen(true)}>
                {entry.form ? "Change form…" : "Set a form…"}
              </button>
            )}
          </div>
          <Markers list={formMarkers} />
          {entry.form && entry.baseForm && sameAspect(entry.form.name, entry.baseForm) && (
            <p className="meta ef-wide">{entry.baseForm} is the normal form, so the AI isn&apos;t told the form, only its facts, unless it has just changed back.</p>
          )}
          {laterForm && (
            <p className="meta ef-wide">
              Lasts until “{laterForm.title}”, where {entry.name} is {[laterForm.form, laterForm.stage].filter(Boolean).join(", ") || "given no form"}.
            </p>
          )}
          {needsForm && (
            <p className="notice ef-wide">
              Some facts are for a form ({entry.forms.join(", ")}), but no form is set, so the AI isn&apos;t sent them. Set the current form to include them.
            </p>
          )}
          {formOpen && (
            <div className="ef-wide">
              <ChangeFormPanel
                entry={entry}
                chapterId={chapterId}
                formChapters={formChapters}
                busy={busy}
                onCancel={() => setFormOpen(false)}
                onSave={async (body) => {
                  if (await run(() => post("/api/codex/form", body))) setFormOpen(false);
                }}
              />
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && newAspects.length === 0 && <p className="meta">No facts yet.</p>}
      {every.length > 0 && (
        <div className="fact-group">
          {hasForms && <h3 className="fact-heading">Every form</h3>}
          {every.map(row)}
        </div>
      )}
      {own.length > 0 && cur && (
        <div className="fact-group">
          <h3 className="fact-heading">
            {cur} only · the form now
          </h3>
          {own.map(row)}
        </div>
      )}
      {others.map((g) => (
        <details key={g.name} className="fact-group ef-other">
          <summary className="fact-heading">
            {g.name} only · {cur ? `not sent to the AI while ${entry.name} is ${cur}` : "not sent to the AI: no form is set"} ({plural(g.facts.length, "fact")})
          </summary>
          {g.facts.map(row)}
        </details>
      ))}
      {newAspects.map((s) => (
        <div key={s.id} className="ef-row ef-placeholder">
          <div className="ef-main ef-static">
            <span className="ef-aspect">{s.aspect}</span>
            <span className="ef-value meta">not in the codex yet{s.form ? ` (${s.form} only)` : ""}</span>
          </div>
          <Markers list={[suggestionMarker(s, entry.entry_id)]} />
        </div>
      ))}
      {general.length > 0 && <Markers list={general.map((s) => suggestionMarker(s, entry.entry_id))} />}

      {hiddenShared.length > 0 && (
        <div className="fact-group dim">
          <h3 className="fact-heading">Hidden from the shared entry</h3>
          {hiddenShared.map((h) => (
            <div key={h.fact_id} className="fact-row">
              <div className="fact-line">
                {h.aspect && <strong>{h.aspect}</strong>} <span>{h.text}</span>
              </div>
              <div className="row" style={{ margin: "0.4rem 0 0" }}>
                <button type="button" className="secondary" disabled={busy} onClick={() => void resetShared(h.fact_id)}>
                  Show again
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!desk && adding}
    </section>
  );
}

/**
 * Editing a fact (or adding one): its aspect and text, which forms it applies to, and whether it is a change in the
 * story (from this chapter on) or a correction (it was always so, from where the fact, or the entry, starts).
 */
function FactEditor({
  entry,
  fact,
  chapterId,
  here,
  start,
  titleOf,
  busy,
  onCancel,
  onSave,
}: {
  entry: CodexEntry;
  fact: LiveFact | null;
  chapterId: string;
  here: string;
  start: Chapter;
  titleOf: (id: string) => string;
  usedAspects: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (b: Body) => void;
}) {
  const [aspect, setAspect] = useState(fact?.aspect ?? "");
  const [text, setText] = useState(fact?.text ?? "");
  const [applies, setApplies] = useState(fact?.form ? (entry.forms.find((f) => sameAspect(f, fact.form)) ?? fact.form) : "");
  const [newForm, setNewForm] = useState("");
  const [kind, setKind] = useState<"change" | "correction">("change");
  const categories = useSettings().codexCategories[entry.type];
  const showForm = entry.forms.length > 0 || entry.type === "character";
  const form = applies === NEW_FORM ? newForm.trim() : applies;
  // A correction is written where the fact's current version was set (or, for a new fact, where the entry starts), so
  // it reads that way from there on; a change is written here.
  const correctionAt = fact ? fact.op.anchor_chapter_id : start.id;
  const offerKind = correctionAt !== chapterId;
  const replaces = !fact && aspect.trim() ? entry.facts.find((f) => !isFormAspect(f.aspect) && sameAspect(f.aspect, aspect) && sameAspect(f.form, form)) : undefined;
  const name = `fact-kind-${fact?.fact_id ?? "new"}`;

  function save() {
    const anchor = offerKind && kind === "correction" ? correctionAt : chapterId;
    // An every-form fact made "<form> only" gets a version of its own for that form; the every-form one stays.
    const split = fact !== null && fact.form === "" && form !== "";
    onSave({
      op: "set",
      aspect: replaces ? replaces.aspect : aspect.trim(),
      form,
      text: text.trim(),
      quote: fact && !split ? fact.quote : "",
      fact_id: split ? undefined : (fact?.fact_id ?? replaces?.fact_id),
      anchor,
    });
  }

  return (
    <div className="fact-form ef-editor">
      <label>
        Aspect
        <AspectPicker type={entry.type} value={aspect} onChange={setAspect} have={entry.facts} />
        <small>
          what it describes; the list is in <Link href="/settings#codex">Settings</Link>
        </small>
      </label>
      <label>
        Text
        <textarea aria-label="Fact" rows={2} value={text} maxLength={FACT_LIMITS.text} onChange={(e) => setText(e.target.value)} />
      </label>
      {replaces && <p className="meta">This replaces: {replaces.text}</p>}
      {showForm && (
        <label>
          Applies to
          <select aria-label="Applies to" value={applies} onChange={(e) => setApplies(e.target.value)}>
            <option value="">every form</option>
            {entry.forms.map((f) => (
              <option key={f} value={f}>
                {f} only
              </option>
            ))}
            <option value={NEW_FORM}>+ a new form…</option>
          </select>
          {fact && fact.form === "" && form !== "" && <small>a {form} version is added; the every-form fact stays for the other forms</small>}
          {form !== "" && aspect.trim() && !canDifferByForm(aspect, categories) && (
            <small className="ef-form-note">
              {aspect.trim()} is usually the same in every form (Settings › Codex). Keep it to one form only if it truly differs there.
            </small>
          )}
        </label>
      )}
      {showForm && applies === NEW_FORM && (
        <input className="fact-form-extra" aria-label="New form name" placeholder="New form name" value={newForm} maxLength={FACT_LIMITS.form} onChange={(e) => setNewForm(e.target.value)} />
      )}
      {offerKind && (
        <fieldset className="ef-kind">
          <legend>Is this…</legend>
          <label>
            <input type="radio" name={name} checked={kind === "change"} onChange={() => setKind("change")} />
            <span>
              a change in the story, from “{here}” on
              {fact && <small> (earlier chapters keep “{fact.text}”)</small>}
            </span>
          </label>
          <label>
            <input type="radio" name={name} checked={kind === "correction"} onChange={() => setKind("correction")} />
            <span>
              a correction: it was always so <small>(from “{titleOf(correctionAt)}”)</small>
            </span>
          </label>
        </fieldset>
      )}
      <div className="row">
        <button type="button" disabled={busy || !text.trim() || (applies === NEW_FORM && !newForm.trim())} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** "From [chapter] <name> is [form]": a new form (or stage), from this chapter or a later one. No facts are moved. */
function ChangeFormPanel({
  entry,
  chapterId,
  formChapters,
  busy,
  onCancel,
  onSave,
}: {
  entry: CodexEntry;
  chapterId: string;
  formChapters: Chapter[];
  busy: boolean;
  onCancel: () => void;
  onSave: (body: unknown) => void;
}) {
  const currentName = entry.form?.name ?? "";
  const [from, setFrom] = useState(chapterId);
  const [sel, setSel] = useState(() => entry.forms.find((f) => sameAspect(f, currentName)) ?? entry.forms[0] ?? NEW_FORM);
  const [newName, setNewName] = useState("");
  const [stage, setStage] = useState(entry.form?.note ?? "");
  // The form the entry is in until now: its current form, else its normal one. With neither it is asked for.
  const known = entry.form?.name.trim() || entry.baseForm || null;
  const [oldName, setOldName] = useState("");
  const name = sel === NEW_FORM ? newName.trim() : sel;
  const line = name ? formLine(name, stage) : "";
  return (
    <div className="fact-form ef-form-panel">
      <div className="ef-form-sentence">
        <label>
          From
          <select aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)}>
            {formChapters.map((c) => (
              <option key={c.id} value={c.id}>
                “{c.title}”{c.id === chapterId ? " (this chapter)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          {entry.name} is
          <select aria-label="Form" value={sel} onChange={(e) => setSel(e.target.value)}>
            {entry.forms.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value={NEW_FORM}>+ a new form…</option>
          </select>
        </label>
      </div>
      {sel === NEW_FORM && (
        <input className="fact-form-extra" aria-label="New form name" placeholder="New form name" value={newName} maxLength={FACT_LIMITS.form} onChange={(e) => setNewName(e.target.value)} />
      )}
      {!known && (
        <label>
          Form until now
          <input aria-label="Form until now" placeholder="e.g. human" value={oldName} maxLength={FACT_LIMITS.form} onChange={(e) => setOldName(e.target.value)} />
          <small>{entry.name}&apos;s form before this, which becomes the normal form; leave empty if there wasn&apos;t one</small>
        </label>
      )}
      <label>
        How far along (optional)
        <input aria-label="How far along (optional)" placeholder="e.g. halfway, complete" value={stage} maxLength={FACT_LIMITS.text} onChange={(e) => setStage(e.target.value)} />
      </label>
      <p className="meta" aria-live="polite">
        {line ? (
          <>
            The AI will read: <strong>{line}</strong>
          </>
        ) : (
          "Pick or name a form to see what the AI will read."
        )}
      </p>
      <p className="meta">
        {entry.name}&apos;s {name || "form"} facts replace the every-form ones on the same aspect while {entry.name} is in that form.
      </p>
      <div className="row">
        <button
          type="button"
          disabled={busy || !name}
          onClick={() =>
            onSave({
              chapter_id: chapterId,
              entry_id: entry.entry_id,
              form: { name, stage: stage.trim(), anchor_chapter_id: from },
              base_form: !known && oldName.trim() && !sameAspect(oldName, name) ? oldName.trim() : "",
              move: [],
              add: [],
            })
          }
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * "AI ideas for …": what Flesh out made up (no quote from the story). Keep… asks where the fact starts: where the entry
 * first appears (it was always so), or the chapter it was suggested at.
 */
function AiIdeas({
  entry,
  ideas,
  start,
  dismiss,
  errors,
  onKept,
}: {
  entry: CodexEntry;
  ideas: CodexSuggestion[];
  start: Chapter;
  dismiss: (s: CodexSuggestion) => Promise<void>;
  errors: Record<string, string>;
  onKept: () => void;
}) {
  return (
    <section className="entry-section entry-ideas" aria-labelledby="entry-ideas-title">
      <h2 id="entry-ideas-title">AI ideas for {entry.name}</h2>
      <p className="meta">Made up by the AI, not in the story.</p>
      <ul className="idea-list">
        {ideas.map((s) => (
          <IdeaRow key={s.id} s={s} entry={entry} start={start} dismiss={dismiss} error={errors[s.id]} onKept={onKept} />
        ))}
      </ul>
    </section>
  );
}

function IdeaRow({
  s,
  entry,
  start,
  dismiss,
  error,
  onKept,
}: {
  s: CodexSuggestion;
  entry: CodexEntry;
  start: Chapter;
  dismiss: (s: CodexSuggestion) => Promise<void>;
  error?: string;
  onKept: () => void;
}) {
  // "keep": choosing where it starts; "edit": the same, with the aspect and text to change.
  const [mode, setMode] = useState<"keep" | "edit" | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [aspect, setAspect] = useState(s.kind === "form" ? s.form : s.aspect);
  const [text, setText] = useState(s.after);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sameChapter = start.id === s.chapter_id;

  async function keep() {
    setBusy(true);
    setProblem(null);
    const edits = mode === "edit" ? (s.kind === "form" ? { form: aspect.trim(), text: text.trim() } : { aspect: aspect.trim(), text: text.trim() }) : {};
    const err = await post(`/api/codex-suggestions/${s.id}/accept`, { ...edits, ...(atStart && !sameChapter ? { anchor_chapter_id: start.id } : {}) });
    setBusy(false);
    if (err) setProblem(err);
    else onKept();
  }

  return (
    <li className="idea-row">
      <div className="idea-text">
        <strong>{s.kind === "form" ? "Form" : s.aspect || "General"}</strong> {s.kind === "form" ? [s.form, s.after].filter(Boolean).join(", ") : s.after}
      </div>
      {mode === null && (
        <div className="row idea-actions">
          <button type="button" disabled={busy} onClick={() => (sameChapter ? void keep() : setMode("keep"))}>
            Keep…
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setMode("edit")}>
            Edit
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void dismiss(s)}>
            Discard
          </button>
        </div>
      )}
      {mode !== null && (
        <div className="fact-form">
          {mode === "edit" && (
            <>
              <label>
                {s.kind === "form" ? "Form" : "Aspect"}
                <input aria-label={s.kind === "form" ? "Form" : "Aspect"} value={aspect} maxLength={FACT_LIMITS.aspect} onChange={(e) => setAspect(e.target.value)} />
              </label>
              <label>
                Text
                <textarea aria-label="Fact" rows={2} value={text} maxLength={FACT_LIMITS.text} onChange={(e) => setText(e.target.value)} />
              </label>
            </>
          )}
          {!sameChapter && <KeepFrom legend="Keep from…" s={s} entryName={entry.name} start={start} atStart={atStart} onChange={setAtStart} />}
          <div className="row">
            <button type="button" disabled={busy || (mode === "edit" && !text.trim())} onClick={() => void keep()}>
              {busy ? "Saving…" : "Keep"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {(problem || error) && <p className="error">{problem || error}</p>}
    </li>
  );
}

/**
 * Where an idea the AI made up is kept from: where the entry first appears ("it was always so"), or the chapter it was
 * suggested at. (Asked only when those differ.)
 */
export function KeepFrom({
  legend,
  s,
  entryName,
  start,
  atStart,
  onChange,
}: {
  legend: string;
  s: CodexSuggestion;
  entryName: string;
  start: Chapter;
  atStart: boolean;
  onChange: (atStart: boolean) => void;
}) {
  return (
    <fieldset className="ef-kind">
      <legend>{legend}</legend>
      <label>
        <input type="radio" name={`keep-${s.id}`} checked={atStart} onChange={() => onChange(true)} />
        <span>
          where {entryName} first appears (“{start.title}”): it was always so
        </span>
      </label>
      <label>
        <input type="radio" name={`keep-${s.id}`} checked={!atStart} onChange={() => onChange(false)} />
        <span>“{s.chapter_title}” on</span>
      </label>
    </fieldset>
  );
}

/** The tabs at the foot of the page: one panel shown at a time. Arrow keys move between the tabs. */
export function EntryTabs<T extends string>({ tab, setTab, tabs, children }: { tab: T; setTab: (t: T) => void; tabs: { id: T; label: string }[]; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  return (
    <section className="entry-section entry-tabs">
      <div
        className="entry-tablist"
        role="tablist"
        aria-label="More about the entry"
        ref={list}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const i = tabs.findIndex((t) => t.id === tab);
          const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
          setTab(next.id);
          requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`#entry-tab-${next.id}`)?.focus());
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`entry-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="entry-tabpanel"
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "entry-tab on" : "entry-tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="entry-tabpanel" id="entry-tabpanel" role="tabpanel" aria-labelledby={`entry-tab-${tab}`}>
        {children}
      </div>
    </section>
  );
}
