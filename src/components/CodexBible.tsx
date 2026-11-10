"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AiRun, CodexTask } from "@/lib/aiRuns/types";
import type { PathChapter } from "@/lib/ai/codexAi";
import { ENTRY_TYPES, TYPE_HEADINGS, TYPE_LABELS, type CodexEntry, type EntryType, type StoryEntrySummary } from "@/lib/codex";
import type { CodexSuggestion } from "@/lib/codexSuggestions";
import AiRunProgress from "./AiRunProgress";
import { Card, DismissedList, INBOX_CHANGED, SourceBadge, suggestionSource, useCodexInbox } from "./CodexInbox";
import CodexEntryCards, { HintCount, StaleNote } from "./CodexEntryCards";
import { STALE_FROM } from "@/lib/codexHints";
import { EntryDetailsForm } from "./CodexEntryEditor";
import CodexGroup from "./CodexGroup";
import IssueActions from "./IssueActions";
import MoreMenu from "./MoreMenu";
import SharedEntryLink from "./SharedEntryLink";
import { useWorkQueue } from "./WorkQueue";

/** A name the chapters use that has no codex entry yet. */
export type CodexGap = { chapterId: string; fingerprint: string; name: string; count: number };
type MiniChapter = { id: string; title: string; depth: number };

type Ctx = {
  storyId: string;
  /** The chapter the Bible is narrowed to; null for the whole story. */
  chosenId: string | null;
  /** Where new entries are anchored: the chosen chapter, or the story's first chapter. */
  anchorId: string;
  creating: { name: string } | null;
  startCreating: (name?: string) => void;
  stopCreating: () => void;
  sharing: boolean;
  setSharing: (open: boolean) => void;
  checking: boolean;
  runId: string | null;
  message: { ok: boolean; text: string } | null;
  startCheck: () => void;
  checkFinished: (run: AiRun) => void;
};

const CodexCtx = createContext<Ctx | null>(null);
function useCodexBible() {
  const ctx = useContext(CodexCtx);
  if (!ctx) throw new Error("CodexBible components need CodexBibleProvider");
  return ctx;
}

/**
 * What the Codex section's ⋯ menu and its list share: the new-entry form, the shared-entry form and the AI check
 * (a review run whose "codex" tasks leave suggestions on the entries). The menu sits by the Section control, the list below.
 */
export function CodexBibleProvider({ storyId, chosenId, anchorId, children }: { storyId: string; chosenId: string | null; anchorId: string; children: ReactNode }) {
  const router = useRouter();
  const { startRun } = useWorkQueue();
  const [creating, setCreating] = useState<{ name: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runGoing, setRunGoing] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const checkFinished = useCallback(
    (run: AiRun) => {
      const tasks = run.tasks.filter((t): t is CodexTask => t.kind === "codex");
      const failed = tasks.filter((t) => t.status === "failed").length;
      const found = tasks.reduce((sum, t) => sum + (t.found ?? 0), 0);
      setRunGoing(false);
      if (failed > 0) setMessage({ ok: false, text: `${failed} chapter${failed === 1 ? "" : "s"} could not be read. Try again from the run's list.` });
      else setMessage({ ok: true, text: found === 0 ? "Nothing to suggest: the codex already matches what the chapter says." : `Left ${found} suggestion${found === 1 ? "" : "s"} on the entries below.` });
      window.dispatchEvent(new Event(INBOX_CHANGED));
      router.refresh();
    },
    [router],
  );

  const startCheck = useCallback(async () => {
    setMessage(null);
    setStarting(true);
    try {
      const res = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story_id: storyId,
          start_chapter_id: chosenId,
          mode: "review",
          options: { tagScope: chosenId ? "chapter" : "story", checks: ["codex"], recheck: true },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't start the check (${res.status})`);
      setRunId(data.id);
      setRunGoing(true);
      await startRun(data.id);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }, [storyId, chosenId, startRun]);

  const value = useMemo<Ctx>(
    () => ({
      storyId,
      chosenId,
      anchorId,
      creating,
      startCreating: (name = "") => {
        setSharing(false);
        setCreating({ name });
      },
      stopCreating: () => setCreating(null),
      sharing,
      setSharing: (open) => {
        if (open) setCreating(null);
        setSharing(open);
      },
      checking: starting || runGoing,
      runId,
      message,
      startCheck: () => void startCheck(),
      checkFinished,
    }),
    [storyId, chosenId, anchorId, creating, sharing, starting, runGoing, runId, message, startCheck, checkFinished],
  );
  return <CodexCtx.Provider value={value}>{children}</CodexCtx.Provider>;
}

/** The Codex section's "⋯" menu: new entries, and the AI check. */
export function CodexMenu() {
  const c = useCodexBible();
  return (
    <MoreMenu label="Codex actions">
      <button type="button" onClick={() => c.startCreating()}>
        {c.chosenId ? "New entry from here" : "New entry"}
      </button>
      <button type="button" onClick={() => c.setSharing(true)}>
        New entry from the shared codex…
      </button>
      <button type="button" className="menu-two-lines" disabled={c.checking} onClick={c.startCheck}>
        {c.chosenId ? "Check this chapter with AI" : "Check every chapter with AI"}
        <span className="meta">Suggests changes to entries</span>
      </button>
    </MoreMenu>
  );
}

type Props = {
  /** The chapters from the story's first to the chosen one (or just the first, for the whole story). */
  path: MiniChapter[];
  /** Chapter scope: the codex as of the chosen chapter. */
  entries: CodexEntry[];
  pictures: Record<string, { id: string }>;
  /** The chapters whose suggestions apply on the chosen chapter's branch. */
  pathIds: string[];
  /** Whole-story scope: every entry on any branch. */
  summaries: StoryEntrySummary[];
  /** The entries the shared-entry form leaves out (those already in the codex). */
  entriesForShared: CodexEntry[];
  gaps: CodexGap[];
  /** Chapter scope: entries retired on this branch, which can be brought back. */
  retired: { entry_id: string; name: string; type: EntryType; aliases: string[]; content: string; always_include: boolean }[];
  /** Arrived from "Review codex for this chapter": offer to run the check. */
  offerCheck: boolean;
  /** How many hints each entry's page shows, by entry id. */
  hintCounts?: Record<string, number>;
  /** How many chapters mention each entry since its last change, by entry id. */
  staleCounts?: Record<string, number>;
  /** The always-included entries, when together they crowd the prompt (`alwaysIncludedLoad`). */
  alwaysLoad?: { names: string[]; tokens: number; room: number } | null;
};

/** The Codex section of the Story Bible: entries in folds by type, with their suggestions inside their cards. */
export default function CodexSection({ path, entries, pictures, pathIds, summaries, entriesForShared, gaps, retired, offerCheck, hintCounts = {}, staleCounts = {}, alwaysLoad = null }: Props) {
  const c = useCodexBible();
  const router = useRouter();
  const chapterScope = c.chosenId !== null;
  // A chapter: the suggestions that apply on its branch. The whole story: every suggestion, wherever it was made.
  const live = useCodexInbox({
    storyId: c.storyId,
    onPath: chapterScope ? { chapterIds: pathIds } : undefined,
    onChanged: () => router.refresh(),
  });
  const formRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [offered, setOffered] = useState(offerCheck);
  // "Most out of date first": within each type, the entries mentioned in the most chapters since their last change come first.
  const [staleFirst, setStaleFirst] = useState(false);
  const byStale = <T extends { entry_id: string }>(list: T[]) => (staleFirst ? [...list].sort((a, b) => (staleCounts[b.entry_id] ?? 0) - (staleCounts[a.entry_id] ?? 0)) : list);
  const anyStale = Object.values(staleCounts).some((n) => n >= STALE_FROM);

  useEffect(() => {
    if (c.creating || c.sharing) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [c.creating, c.sharing]);

  const suggestions = live.shown;
  const openFor = (s: CodexSuggestion) => s.status === "open";
  const forEntry = (entryId: string) => suggestions.filter((s) => s.kind !== "entry" && s.entry_id === entryId);
  const created = (type: EntryType) => suggestions.filter((s) => s.kind === "entry" && (s.entry?.type ?? "note") === type);
  const known = new Set((chapterScope ? entries.map((e) => e.entry_id) : summaries.map((e) => e.entry_id)));
  const stray = suggestions.filter((s) => s.kind !== "entry" && !(s.entry_id && known.has(s.entry_id)));

  async function create(f: { name: string; type: EntryType; aliases: string[] }) {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/codex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: c.anchorId, op: "create", ...f, content: "", always_include: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.entry_id) return setFormError(data.error ?? `Request failed (${res.status})`);
      c.stopCreating();
      router.push(`/s/${c.storyId}/codex/${data.entry_id}?at=${c.anchorId}`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const [bringing, setBringing] = useState<string | null>(null);
  async function bringBack(e: Props["retired"][number]) {
    setBringing(e.entry_id);
    setFormError(null);
    try {
      const res = await fetch("/api/codex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: c.anchorId, op: "replace", ...e }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setFormError(data.error ?? `Request failed (${res.status})`);
      else router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBringing(null);
    }
  }

  const cardFor = (s: CodexSuggestion, inEntry: boolean) => (
    <Card
      key={s.id}
      s={s}
      inEntry={inEntry}
      busy={live.busy.has(s.id)}
      error={live.errors[s.id]}
      editing={live.editing === s.id}
      onEdit={(on) => live.setEditing(on ? s.id : null)}
      onAccept={(edits) => void live.accept(s, edits)}
      onDismiss={() => void live.dismiss(s)}
      onReopen={() => void live.reopen(s)}
    />
  );


  /** Under an entry's card: how many of its suggestions wait at this chapter (they are reviewed on its page). */
  const reviewCountOf = (entryId: string) => {
    const n = forEntry(entryId).filter((s) => openFor(s) && s.chapter_id === c.chosenId).length;
    return n > 0 ? <p className="entry-review-count">{n} to review</p> : null;
  };

  /**
   * "To review": what the AI left at this chapter (or, for the whole story, at every chapter), one row per entry that
   * links to the entry's page at that chapter, where the suggestions are. A new entry has no page yet, so its row has
   * Add and Dismiss. In a chapter, the earlier chapters on the branch that still have some are linked below.
   */
  const reviewByChapter = (() => {
    const out: { id: string; title: string; rows: { key: string; entryId: string | null; name: string; list: CodexSuggestion[] }[] }[] = [];
    for (const s of suggestions) {
      if (!openFor(s) && s.kind !== "entry") continue;
      if (s.kind !== "entry" && !(s.entry_id && known.has(s.entry_id))) continue; // listed under "Other suggestions"
      let ch = out.find((x) => x.id === s.chapter_id);
      if (!ch) out.push((ch = { id: s.chapter_id, title: s.chapter_title, rows: [] }));
      const key = s.kind === "entry" ? `new:${s.id}` : s.entry_id!;
      let row = ch.rows.find((r) => r.key === key);
      if (!row) ch.rows.push((row = { key, entryId: s.kind === "entry" ? null : s.entry_id, name: s.entry_name, list: [] }));
      row.list.push(s);
    }
    return out;
  })();

  const toneSummary = (list: CodexSuggestion[]) => {
    const counts = new Map<string, number>();
    for (const s of list) {
      const { tone } = suggestionSource(s);
      const word = tone === "invented" ? "AI idea" : tone === "conflict" ? "contradicts the codex" : tone === "notes" ? "from your notes" : "from the text";
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    return [...counts].map(([w, n]) => (w === "AI idea" ? `${n} AI idea${n === 1 ? "" : "s"}` : `${n} ${w}`)).join(" · ");
  };

  const reviewRows = (ch: (typeof reviewByChapter)[number]) => (
    <ul className="codex-review-rows">
      {ch.rows.map((r) => {
        if (r.entryId === null) {
          const s = r.list[0];
          if (s.status !== "open") return <li key={r.key}>{cardFor(s, false)}</li>;
          return (
            <li key={r.key} className="codex-review-new">
              <span className="codex-review-new-text">
                <span>
                  <strong className="codex-suggested-label">New {s.entry?.type ?? "entry"}:</strong> <strong>{s.entry_name}</strong> <SourceBadge s={s} />
                </span>
                {s.entry?.notes && <span className="meta">{s.entry.notes}</span>}
                {s.quote && <span className="inbox-quote">“{s.quote}”</span>}
                {live.errors[s.id] && <span className="error">{live.errors[s.id]}</span>}
              </span>
              <button type="button" disabled={live.busy.has(s.id)} onClick={() => void live.accept(s)}>
                Add it
              </button>
              <button type="button" className="secondary" disabled={live.busy.has(s.id)} onClick={() => void live.dismiss(s)}>
                Dismiss
              </button>
            </li>
          );
        }
        const open = r.list.filter(openFor);
        return (
          <li key={r.key}>
            <Link className="codex-review-row" href={`/s/${c.storyId}/codex/${r.entryId}?at=${ch.id}#entry-review`}>
              <strong className="codex-review-name">{r.name || "An entry"}</strong>
              <span className="meta">{toneSummary(open)}</span>
              <span className="codex-review-count">{open.length}</span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const reviewBox = () => {
    if (chapterScope) {
      const here = reviewByChapter.find((ch) => ch.id === c.chosenId);
      const earlier = reviewByChapter.filter((ch) => ch.id !== c.chosenId && ch.rows.some((r) => r.list.some(openFor)));
      if (!here && earlier.length === 0) return null;
      const n = here ? here.rows.reduce((t, r) => t + r.list.filter(openFor).length, 0) : 0;
      return (
        <section className="codex-review-box" aria-label="To review">
          <div className="codex-review-box-head">
            <h2>To review from this chapter</h2>
            <span className="meta">{n === 0 ? "nothing waiting" : `${n} waiting`}</span>
          </div>
          {here && reviewRows(here)}
          {earlier.length > 0 && (
            <p className="meta">
              Earlier chapters still have some:{" "}
              {earlier.map((ch, i) => (
                <span key={ch.id}>
                  {i > 0 && " · "}
                  <Link href={`/s/${c.storyId}/review?tab=codex&chapter=${ch.id}`}>
                    “{ch.title}” ({ch.rows.reduce((t, r) => t + r.list.filter(openFor).length, 0)})
                  </Link>
                </span>
              ))}
            </p>
          )}
        </section>
      );
    }
    if (reviewByChapter.length === 0) return null;
    return (
      <section className="codex-review-box" aria-label="To review">
        <div className="codex-review-box-head">
          <h2>To review</h2>
          <span className="meta">{openCount(suggestions)} waiting</span>
        </div>
        {reviewByChapter.map((ch) => (
          <div key={ch.id}>
            <h3 className="inbox-chapter">
              <Link href={`/s/${c.storyId}/review?tab=codex&chapter=${ch.id}`}>“{ch.title}”</Link>
            </h3>
            {reviewRows(ch)}
          </div>
        ))}
      </section>
    );
  };

  const openCount = (list: CodexSuggestion[]) => list.filter(openFor).length;
  const groupCount = (type: EntryType) => {
    const ids = new Set((chapterScope ? entries : summaries).filter((e) => e.type === type).map((e) => e.entry_id));
    return openCount(suggestions.filter((s) => (s.kind === "entry" ? (s.entry?.type ?? "note") === type : s.entry_id !== null && ids.has(s.entry_id))));
  };

  const nothing = (chapterScope ? entries.length === 0 : summaries.length === 0) && gaps.length === 0 && !suggestions.some((s) => s.kind === "entry");
  const sharedPath = path as unknown as PathChapter[];

  return (
    <div className="codex-bible">
      {c.checking && c.runId && <p className="meta" role="status">Checking with the AI… the suggestions will appear on the entries.</p>}
      {c.runId && <AiRunProgress key={c.runId} runId={c.runId} onFinished={c.checkFinished} />}
      {c.message && <p className={c.message.ok ? "ok" : "error"}>{c.message.text}</p>}
      {offered && chapterScope && !c.runId && (
        <p className="notice">
          Want the codex to catch up with this chapter?{" "}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setOffered(false);
              c.startCheck();
            }}
          >
            Check this chapter with AI
          </button>
        </p>
      )}

      {reviewBox()}

      {alwaysLoad && (
        <p className="notice codex-always-load">
          The always-included entries ({alwaysLoad.names.join(", ")}) take about {alwaysLoad.tokens} of the {alwaysLoad.room} tokens the codex gets in
          each prompt at your context size, leaving little room for the entries a scene mentions. Turn Always include off for the ones the AI only needs
          when they come up (they still go in when named), or shorten their facts.
        </p>
      )}
      {formError && !c.creating && <p className="error">{formError}</p>}
      <div ref={formRef}>
        {c.creating && (
          <div id="codex-new-entry">
            {formError && <p className="error">{formError}</p>}
            <EntryDetailsForm
              key={c.creating.name}
              initial={null}
              startName={c.creating.name}
              busy={saving}
              path={sharedPath}
              chapterId={c.anchorId}
              inDraft={false}
              onCancel={c.stopCreating}
              onSave={(f) => void create(f)}
            />
          </div>
        )}
        <SharedEntryLink chapterId={c.anchorId} path={sharedPath} entries={entriesForShared} open={c.sharing} onOpenChange={c.setSharing} />
      </div>

      {anyStale && (
        <label className="codex-stale-sort">
          <input type="checkbox" checked={staleFirst} onChange={(e) => setStaleFirst(e.target.checked)} />
          Most out of date first
        </label>
      )}
      {nothing && (
        <div className="codex-empty">
          <p>No entries yet.</p>
          {!c.creating && (
            <button type="button" onClick={() => c.startCreating()}>
              + New entry
            </button>
          )}
        </div>
      )}

      {chapterScope ? (
        <CodexEntryCards
          fold
          hints={hintCounts}
          entries={byStale(entries)}
          stale={staleCounts}
          chapterId={c.chosenId!}
          storyId={c.storyId}
          pictures={pictures}
          extra={(e) => reviewCountOf(e.entry_id)}
          groupSuggestions={groupCount}
        />
      ) : (
        ENTRY_TYPES.map((type) => {
          const group = byStale(summaries.filter((e) => e.type === type));
          const fresh = created(type);
          if (group.length === 0 && fresh.length === 0) return null;
          return (
            <CodexGroup key={type} title={TYPE_HEADINGS[type]} count={group.length} suggestions={groupCount(type)}>
              <ul className="entry-cards">
                {group.map((e) => {
                  const n = openCount(forEntry(e.entry_id));
                  return (
                    <li key={e.entry_id}>
                      <Link className="entry-card" href={`/s/${c.storyId}/codex/${e.entry_id}?at=${e.last_chapter_id}`}>
                        <span className="entry-card-text">
                          <span>
                            <strong>{e.name}</strong> <span className="meta">{TYPE_LABELS[e.type]}</span>
                            <HintCount n={hintCounts[e.entry_id]} />
                            {n > 0 && (
                              <span className="codex-group-note">
                                {" "}
                                · {n} suggestion{n === 1 ? "" : "s"}
                              </span>
                            )}
                          </span>
                          <span className="meta entry-card-line">
                            from {e.first_chapter_title}
                            {e.retired ? " · retired" : ""}
                          </span>
                          <StaleNote n={staleCounts[e.entry_id]} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CodexGroup>
          );
        })
      )}

      {gaps.length > 0 && (
        <CodexGroup title="Not in the codex yet" count={gaps.length}>
          <ul className="entry-cards">
            {gaps.map((g) => (
              <li key={`${g.chapterId}-${g.fingerprint}`} className="codex-suggested">
                <span>
                  <strong className="codex-suggested-label">Not in the codex yet:</strong> <strong>{g.name}</strong> <span className="meta">· named in {g.count} chapters</span>
                </span>
                <span className="row">
                  <button type="button" onClick={() => c.startCreating(g.name)}>
                    Add entry
                  </button>
                  <IssueActions chapterId={g.chapterId} kind="codex-missing" fingerprint={g.fingerprint} actions={["dismissed"]} />
                </span>
              </li>
            ))}
          </ul>
        </CodexGroup>
      )}

      {chapterScope && retired.length > 0 && (
        <CodexGroup title="Retired" count={retired.length}>
          <p className="meta">Entries that no longer apply on this branch.</p>
          <ul className="entry-cards">
            {retired.map((e) => (
              <li key={e.entry_id} className="card row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{e.name}</strong> <span className="meta">{TYPE_LABELS[e.type]}</span>
                </span>
                <button type="button" className="secondary" disabled={bringing === e.entry_id} onClick={() => void bringBack(e)}>
                  Bring back
                </button>
              </li>
            ))}
          </ul>
        </CodexGroup>
      )}

      {stray.length > 0 && (
        <CodexGroup title="Other suggestions" count={stray.length}>
          {stray.map((s) => cardFor(s, false))}
        </CodexGroup>
      )}

      <p className="meta">
        <a href={`/api/chapters/${c.anchorId}/codex?format=md`}>{chapterScope ? "Download this chapter's codex as Markdown" : "Download the first chapter's codex as Markdown"}</a>
      </p>

      {live.dismissedList.length > 0 && (
        <div className="codex-review-footer codex-dismissed">
          <DismissedList
            list={live.dismissedList}
            busy={live.busy}
            errors={live.errors}
            open={live.showDismissed}
            onToggle={() => live.setShowDismissed((v) => !v)}
            onReopen={(s) => void live.reopen(s)}
          />
        </div>
      )}
    </div>
  );
}
