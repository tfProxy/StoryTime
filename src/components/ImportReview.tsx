"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AutoTextarea from "./AutoTextarea";
import ImportOptionsFields from "./ImportOptionsFields";
import { saveDraft, DraftConflict, type Draft } from "@/lib/drafts";
import { LIMITS } from "@/lib/limits";
import { chapterRanges, countWords, planProblems, rangeWords, type ImportDraft, type ImportOptions, type ImportPlan, type PlanChapter } from "@/lib/textImport";

type Loaded = { draft: ImportDraft; queued: "waiting" | "working" | null };

const POLL_MS = 1500;
const SAVE_MS = 800;

/** The first and last few words of a paragraph run, for a chapter's card. */
const opening = (s: string) => (s.length > 140 ? `${s.slice(0, 140).replace(/\s+\S*$/, "")}…` : s);
const closing = (s: string) => (s.length > 140 ? `…${s.slice(-140).replace(/^\S*\s+/, "")}` : s);

/**
 * The import's page: while the queue splits the story it shows how far it got; then every chapter with its title,
 * its opening and closing lines, the original choice and the suggested ones, the controls that move a break, and
 * the button that makes the story. Changes are saved into the import's draft as they are made.
 */
export default function ImportReview({ id }: { id: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [gone, setGone] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "create" | "split" | "discard" | "stop">(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [onlyCheck, setOnlyCheck] = useState(false);
  const [resplit, setResplit] = useState<ImportOptions | null>(null);
  const base = useRef(0);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The import as the server has it; null when it is gone. */
  const fetchImport = useCallback(async (): Promise<Loaded | null> => {
    const res = await fetch(`/api/import-text/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Couldn't load the import (${res.status})`);
    return (await res.json()) as Loaded;
  }, [id]);

  const apply = useCallback((out: Loaded | null) => {
    if (!out) {
      setGone(true);
      return;
    }
    setLoaded(out);
    base.current = out.draft.updatedAt;
    // The page's own edits win over what it last saved; a fresh plan from the server replaces an unedited one.
    if (!dirty.current) setPlan(out.draft.plan);
  }, []);

  const load = useCallback(() => fetchImport().then(apply), [fetchImport, apply]);

  const status = loaded?.draft.status;
  const splitting = status === "splitting" && loaded?.queued !== null;

  useEffect(() => {
    let cancelled = false;
    fetchImport()
      .then((out) => !cancelled && apply(out))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [fetchImport, apply]);

  // While the queue splits the story, ask again every so often.
  useEffect(() => {
    if (!splitting) return;
    const t = setInterval(() => void load().catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  }, [splitting, load]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!dirty.current || !loaded || !plan) return true;
    const next = { ...loaded.draft, plan, storyTitle: plan.title, label: `Import: ${plan.title || "a story"}` };
    try {
      base.current = await saveDraft(next as unknown as Draft, base.current);
      dirty.current = false;
      return true;
    } catch (e) {
      setError(e instanceof DraftConflict ? "The import was changed somewhere else. Reload the page to see it." : e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [loaded, plan]);

  // Edits are saved a moment after the last one.
  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_MS);
  }, [plan, save]);

  const paragraphs = useMemo(() => loaded?.draft.paragraphs ?? [], [loaded]);
  const ranges = useMemo(() => (plan ? chapterRanges(plan.chapters, paragraphs.length) : []), [plan, paragraphs]);
  const words = useMemo(() => ranges.map((r) => rangeWords(paragraphs, r)), [ranges, paragraphs]);
  const totalWords = useMemo(() => paragraphs.reduce((n, p) => n + countWords(p), 0), [paragraphs]);
  const problems = useMemo(() => (plan ? planProblems(plan, paragraphs.length) : []), [plan, paragraphs]);

  if (gone) {
    return (
      <>
        <h1>Import a story</h1>
        <p>
          This import is gone: it was made into a story or discarded. <Link href="/new?tab=import">Import another story</Link>
        </p>
      </>
    );
  }
  if (!loaded) return <p className="meta">{error ?? "Loading…"}</p>;

  const options = loaded.draft.options;
  const change = (fn: (p: ImportPlan) => ImportPlan) => {
    dirty.current = true;
    setPlan((p) => (p ? fn(p) : p));
  };
  const changeChapter = (i: number, patch: Partial<PlanChapter>) =>
    change((p) => ({ ...p, chapters: p.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  async function splitAgain(next: ImportOptions | null) {
    setBusy("split");
    setError(null);
    try {
      const res = await fetch(`/api/import-text/${encodeURIComponent(id)}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next ? { options: next } : {}),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `Couldn't split it again (${res.status})`);
      dirty.current = false;
      setPlan(null);
      setResplit(null);
      setOpen(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    try {
      await fetch(`/api/queue/items/${encodeURIComponent(`gen:import:${id}`)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!window.confirm("Discard this import? The text and the chapters found are deleted.")) return;
    setBusy("discard");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirty.current = false;
    await fetch(`/api/import-text/${encodeURIComponent(id)}`, { method: "DELETE" });
    router.push("/new?tab=import");
  }

  async function create() {
    setBusy("create");
    setError(null);
    try {
      if (!(await save())) return;
      const res = await fetch(`/api/import-text/${encodeURIComponent(id)}/create`, { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `Couldn't create the story (${res.status})`);
      router.push(`/c/${out.chapter_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const name = plan?.title || loaded.draft.storyTitle || "a story";

  // ---- splitting, stopped or failed ----
  if (status !== "ready" || !plan) {
    const found = loaded.draft.plan?.chapters ?? [];
    const foundRanges = chapterRanges(found, paragraphs.length);
    return (
      <>
        <h1>Importing “{name}”</h1>
        <p className="meta">
          {totalWords.toLocaleString("en")} words · {paragraphs.length} paragraphs
        </p>
        {splitting ? (
          <div className="card import-progress" aria-live="polite">
            <p>
              <strong>{loaded.queued === "waiting" ? "Waiting for its turn in the queue" : loaded.draft.progress || "Working…"}</strong>
            </p>
            <p className="meta">This runs on the server’s queue, so you can close the tab and come back. It is listed under Drafts until you create the story.</p>
            <button type="button" className="secondary" onClick={stop} disabled={busy !== null}>
              {busy === "stop" ? "Stopping…" : "Stop"}
            </button>
          </div>
        ) : (
          <div className="notice import-stopped">
            <p>{loaded.draft.error ?? "The splitting stopped before it finished."}</p>
          </div>
        )}
        {found.length > 0 && (
          <div className="card import-found">
            <strong>Found so far</strong>
            <ol>
              {found.map((c, i) => (
                <li key={i}>
                  {c.title} · {rangeWords(paragraphs, foundRanges[i])} words{c.choice && <> → <em>{c.choice}</em></>}
                </li>
              ))}
            </ol>
          </div>
        )}
        {!splitting && (
          <SplitAgain options={resplit ?? options} onChange={setResplit} busy={busy} onSplit={() => splitAgain(resplit)} onDiscard={discard} />
        )}
        {error && <p className="error">{error}</p>}
      </>
    );
  }

  // ---- the review ----
  const n = plan.chapters.length;
  const flagged = (i: number) => words[i] > options.maxWords || words[i] < options.minWords || !plan.chapters[i].title.trim() || (i < n - 1 && !plan.chapters[i].choice.trim());
  const lengthNote = (i: number) => (words[i] > options.maxWords ? `over ${options.maxWords}` : words[i] < options.minWords ? `under ${options.minWords}` : null);
  const toggle = (i: number) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  function moveBreak(i: number, delta: number) {
    change((p) => {
      const chapters = p.chapters.map((c) => ({ ...c }));
      const start = chapters[i + 1].start + delta;
      const limit = i + 2 < chapters.length ? chapters[i + 2].start : paragraphs.length;
      if (start <= chapters[i].start || start >= limit) return p;
      chapters[i + 1].start = start;
      return { ...p, chapters };
    });
  }

  function merge(i: number) {
    change((p) => {
      const a = p.chapters[i];
      const b = p.chapters[i + 1];
      const chapters = [...p.chapters.slice(0, i), { ...a, choice: b.choice, alternatives: b.alternatives }, ...p.chapters.slice(i + 2)];
      return { ...p, chapters };
    });
    setOpen(new Set());
  }

  function splitAt(i: number, start: number) {
    change((p) => {
      const c = p.chapters[i];
      const heading = loaded!.draft.headings[start] ?? "";
      const chapters = [
        ...p.chapters.slice(0, i),
        { ...c, choice: "", alternatives: [] },
        { start, title: heading, choice: c.choice, alternatives: c.alternatives },
        ...p.chapters.slice(i + 1),
      ];
      return { ...p, chapters };
    });
    setOpen(new Set([i, i + 1]));
  }

  const toc = plan.chapters.map((c, i) => ({ i, c })).filter(({ i }) => !onlyCheck || flagged(i));
  const toCheck = plan.chapters.filter((_, i) => flagged(i)).length;

  return (
    <>
      <div className="import-head">
        <h1>Review the import</h1>
        <p className="meta">
          {n} chapter{n === 1 ? "" : "s"} · {totalWords.toLocaleString("en")} words · every word of the original is kept
        </p>
      </div>
      <div className="import-review">
        <nav className="card import-toc" aria-label="Chapters">
          <strong>Chapters</strong>
          <label className="inline-label">
            <input type="checkbox" checked={onlyCheck} onChange={(e) => setOnlyCheck(e.target.checked)} /> Only ones to check ({toCheck})
          </label>
          <ol>
            {!onlyCheck && (
              <li>
                <a href="#import-details">Title, summary, style</a>
              </li>
            )}
            {toc.map(({ i, c }) => (
              <li key={i}>
                <a href={`#import-ch-${i + 1}`} className={flagged(i) ? "import-toc-flag" : undefined}>
                  <span className="import-toc-n">{i + 1}</span>
                  <span className="import-toc-title">{c.title || "Untitled"}</span>
                  <span className="import-toc-words">
                    {words[i]}
                    {flagged(i) && <span aria-label="to check"> !</span>}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="import-chapters">
          <section id="import-details" className="card import-details">
            <label>
              Title
              <input value={plan.title} maxLength={LIMITS.title} onChange={(e) => change((p) => ({ ...p, title: e.target.value }))} />
            </label>
            <label>
              Summary <small>(drafted by the AI)</small>
              <AutoTextarea value={plan.premise} maxLength={LIMITS.premise} onChange={(e) => change((p) => ({ ...p, premise: e.target.value }))} />
            </label>
            <label>
              Style notes <small>(drafted by the AI)</small>
              <AutoTextarea value={plan.style} maxLength={LIMITS.style} onChange={(e) => change((p) => ({ ...p, style: e.target.value }))} />
            </label>
          </section>

          {plan.chapters.map((c, i) => {
            const r = ranges[i];
            const last = i === n - 1;
            const note = lengthNote(i);
            return (
              <div key={`${i}-${c.start}`} className="import-chapter-wrap">
                <section id={`import-ch-${i + 1}`} className={`card import-chapter${flagged(i) ? " import-flagged" : ""}`} aria-label={`Chapter ${i + 1}`}>
                  <div className="row import-chapter-head">
                    <span className="import-n">{i + 1}</span>
                    <input aria-label={`Chapter ${i + 1} title`} value={c.title} maxLength={LIMITS.title} placeholder="Chapter title" onChange={(e) => changeChapter(i, { title: e.target.value })} />
                    <span className={`meta import-words${note ? " import-warn" : ""}`}>
                      {words[i]} words{note && ` · ${note}`} · ¶ {r.start + 1}–{r.end}
                    </span>
                  </div>
                  {open.has(i) ? (
                    <div className="import-paragraphs">
                      {paragraphs.slice(r.start, r.end).map((p, k) => {
                        const at = r.start + k;
                        return (
                          <div key={at} className="import-paragraph">
                            <p>{p}</p>
                            {at + 1 < r.end && (
                              <button type="button" className="link-button" onClick={() => splitAt(i, at + 1)}>
                                Start a new chapter after this paragraph
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="import-excerpt">
                      <p>{opening(paragraphs[r.start])}</p>
                      {r.end - r.start > 1 && (
                        <>
                          <p className="meta" aria-hidden="true">
                            ⋯
                          </p>
                          <p>{closing(paragraphs[r.end - 1])}</p>
                        </>
                      )}
                    </div>
                  )}
                  <button type="button" className="link-button" onClick={() => toggle(i)} aria-expanded={open.has(i)}>
                    {open.has(i) ? "Show less" : r.end - r.start > 1 ? "Show the whole chapter, to split it" : "Show the whole chapter"}
                  </button>
                  <div className="import-choices">
                    {last ? (
                      <p className="row">
                        <span className="original-mark">Original</span> The end of the original story
                      </p>
                    ) : (
                      <label className="row import-choice">
                        <span className="original-mark">Original</span>
                        <input
                          aria-label={`Original choice after chapter ${i + 1}`}
                          value={c.choice}
                          maxLength={LIMITS.label}
                          placeholder="What the character does next"
                          onChange={(e) => changeChapter(i, { choice: e.target.value })}
                        />
                      </label>
                    )}
                    {last && c.alternatives.length > 0 && <p className="meta">Other endings: choices from the last chapter, to write later.</p>}
                    {c.alternatives.map((a, k) => (
                      <div key={k} className="row import-choice import-alt">
                        <input
                          type="checkbox"
                          aria-label={`Keep “${a.label || "this choice"}”`}
                          checked={a.keep}
                          onChange={(e) => changeChapter(i, { alternatives: c.alternatives.map((x, j) => (j === k ? { ...x, keep: e.target.checked } : x)) })}
                        />
                        <span className="meta import-suggested">Suggested</span>
                        <input
                          aria-label={`Suggested choice ${k + 1} after chapter ${i + 1}`}
                          value={a.label}
                          maxLength={LIMITS.label}
                          className={a.keep ? undefined : "import-dropped"}
                          onChange={(e) => changeChapter(i, { alternatives: c.alternatives.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })}
                        />
                      </div>
                    ))}
                    {c.alternatives.length + 1 < LIMITS.choices && (
                      <button type="button" className="link-button" onClick={() => changeChapter(i, { alternatives: [...c.alternatives, { label: "", keep: true }] })}>
                        + Add a choice
                      </button>
                    )}
                  </div>
                </section>
                {!last && (
                  <div className="import-break" role="group" aria-label={`Break after chapter ${i + 1}`}>
                    <span>Break</span>
                    <button type="button" className="secondary" onClick={() => moveBreak(i, -1)} disabled={ranges[i].end - 1 <= ranges[i].start}>
                      ▲ A paragraph earlier
                    </button>
                    <button type="button" className="secondary" onClick={() => moveBreak(i, 1)} disabled={ranges[i + 1].end - 1 <= ranges[i + 1].start}>
                      ▼ A paragraph later
                    </button>
                    <button type="button" className="secondary" onClick={() => merge(i)}>
                      Merge
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {problems.length > 0 && (
            <div className="problems">
              <strong>Before the story can be made:</strong>
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row import-actions">
            <button type="button" onClick={create} disabled={busy !== null || problems.length > 0}>
              {busy === "create" ? "Creating…" : "Create the story"}
            </button>
            <button type="button" className="secondary" onClick={() => setResplit(resplit ? null : options)} aria-expanded={resplit !== null} disabled={busy !== null}>
              Split again…
            </button>
            <button type="button" className="secondary" onClick={discard} disabled={busy !== null}>
              Discard
            </button>
          </div>
          <p className="meta">The codex check (and the other automatic checks turned on in Settings) runs on the new chapters afterwards.</p>
          {resplit && (
            <SplitAgain
              options={resplit}
              onChange={setResplit}
              busy={busy}
              onSplit={() => {
                if (window.confirm("Split the story again? The chapters and your changes to them are replaced.")) void splitAgain(resplit);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** "Split again", with the options to change first. */
function SplitAgain({
  options,
  onChange,
  busy,
  onSplit,
  onDiscard,
}: {
  options: ImportOptions;
  onChange: (o: ImportOptions) => void;
  busy: string | null;
  onSplit: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div className="card import-options import-resplit">
      <ImportOptionsFields options={options} onChange={onChange} />
      <div className="row">
        <button type="button" onClick={onSplit} disabled={busy !== null || options.maxWords <= options.minWords}>
          {busy === "split" ? "Starting…" : "Split again"}
        </button>
        {onDiscard && (
          <button type="button" className="secondary" onClick={onDiscard} disabled={busy !== null}>
            Discard
          </button>
        )}
      </div>
    </div>
  );
}
