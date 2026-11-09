"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSettings } from "@/lib/settings";
import { summarizeChapter } from "@/lib/ai/summaries";
import type { StoryChapter } from "@/lib/tree";
import SplitActionButton, { type SplitMode } from "./SplitActionButton";
import { useSummaryCheck } from "./SummaryCheck";
import { AiCallProgress } from "./GenerateProgress";

export type SummaryStatus = "done" | "stale" | "missing" | "wrong";

const STATUS_TEXT: Record<SummaryStatus, string> = { done: "Done", stale: "Out of date", missing: "Missing", wrong: "Doesn't match" };

type Props = {
  storyId: string;
  story: { title: string; premise: string };
  /** Parents before children. */
  chapters: StoryChapter[];
  status: Record<string, SummaryStatus>;
  /** A summary check run for this story that is not finished (found when the page loaded). */
  unfinishedRunId?: string | null;
};

/** Each chapter followed by the chapters below it (the list arrives parents first, level by level). */
function inTreeOrder(chapters: StoryChapter[]): StoryChapter[] {
  const below = new Map<string | null, StoryChapter[]>();
  for (const c of chapters) below.set(c.parent_id, [...(below.get(c.parent_id) ?? []), c]);
  const out: StoryChapter[] = [];
  const walk = (parent: string | null) => {
    for (const c of below.get(parent) ?? []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  return out;
}

/**
 * The Summaries section for the whole story: how many chapters have a summary, one ▾ combo button to fix or redo them or
 * to have the AI check them, and the chapters with their status. The summaries are written chapter by chapter from the
 * first chapter down so each chapter's story-so-far builds on its parent's.
 */
export default function SummariesOverview({ storyId, story, chapters, status, unfinishedRunId = null }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const checker = useSummaryCheck(storyId, null, unfinishedRunId);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setMode] = useState("fix");
  const abortRef = useRef<AbortController | null>(null);

  const count = (s: SummaryStatus) => chapters.filter((c) => status[c.id] === s).length;
  const missing = count("missing");
  const stale = count("stale");
  const wrong = count("wrong");
  const toFix = missing + stale;
  const have = chapters.length - missing;
  const mode = picked === "fix" && toFix === 0 ? "redo" : picked;

  const modes: SplitMode[] = [
    ...(toFix > 0
      ? [{ id: "fix", label: `Fix the ${toFix} summar${toFix === 1 ? "y" : "ies"}`, hint: "Writes the missing and the out-of-date ones." }]
      : []),
    { id: "redo", label: "Redo them all", hint: "Writes a new summary for every chapter." },
    { id: "check", label: "Check every summary with AI", hint: "Says which summaries don't match their chapter." },
  ];

  async function write(only: Set<string> | null) {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setRunning(true);
    setError(null);
    setResult(null);
    const list = only ? chapters.filter((c) => only.has(c.id)) : chapters;
    // Each chapter's story-so-far as it stands now, so children build on a new one.
    const pathSummary = new Map<string, string | null>(chapters.map((c) => [c.id, c.path_summary]));
    let done = 0;
    try {
      for (const c of chapters) {
        if (only && !only.has(c.id)) continue;
        const previous = c.parent_id ? (pathSummary.get(c.parent_id) ?? null) : null;
        setProgress({ done, total: list.length, current: c.title });
        const s = await summarizeChapter(settings, { story, previous, chapter: c, signal: ctl.signal });
        const res = await fetch(`/api/chapters/${c.id}/summary`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: c.revision, summary: s.summary, path_summary: s.path_summary }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`“${c.title}”: ${data.error ?? `couldn't save (${res.status})`}`);
        pathSummary.set(c.id, s.path_summary);
        done++;
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      // Whatever finished is already saved.
      setResult(`${done} written.`);
      setRunning(false);
      setProgress(null);
      router.refresh();
    }
  }

  function main() {
    setMode("fix");
    if (mode === "check") void checker.check();
    else void write(mode === "fix" ? new Set(chapters.filter((c) => status[c.id] === "missing" || status[c.id] === "stale").map((c) => c.id)) : null);
  }

  const parts = [missing > 0 && `${missing} missing`, stale > 0 && `${stale} out of date`, wrong > 0 && `${wrong} ${wrong === 1 ? "doesn't" : "don't"} match`].filter(Boolean);
  return (
    <>
      <section className="card summary-card">
        <strong>
          {have} of {chapters.length} chapter{chapters.length === 1 ? "" : "s"} {have === 1 ? "has" : "have"} a summary
        </strong>
        <span className="meta">{parts.length > 0 ? parts.join(" · ") : "Every summary is up to date."}</span>
        <div>
          <SplitActionButton
            startAligned
            verb="fix summaries"
            modes={modes}
            mode={mode}
            onMode={setMode}
            onMain={main}
            busyLabel={running ? "Writing…" : checker.busy ? "Checking…" : null}
            disabled={running || checker.busy}
          />
          {running && (
            <button type="button" className="secondary" style={{ marginLeft: "0.5rem" }} onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
        </div>
        {(running || checker.busy) && <AiCallProgress labels={["Summary", "Summary check"]} />}
        {progress && (
          <p className="meta" aria-live="polite" style={{ margin: 0 }}>
            {progress.done} of {progress.total} done. Now: {progress.current}
          </p>
        )}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        {result !== null && !running && (
          <p className="ok" aria-live="polite" style={{ margin: 0 }}>
            {result}
          </p>
        )}
        {checker.view}
        <p className="meta" style={{ margin: 0 }}>
          One request to your summary model for each chapter, with your <Link href="/settings">AI settings</Link>. If you stop it, the chapters already done stay done.
        </p>
      </section>

      <h2>Chapters</h2>
      <p className="meta">Tap a chapter to edit its summary here.</p>
      <ul className="summary-chapters">
        {inTreeOrder(chapters).map((c) => (
          <li key={c.id} style={{ paddingLeft: `calc(0.75rem + ${Math.min(c.depth, 8)} * 1rem)` }}>
            <Link href={`/s/${storyId}/review?tab=summaries&chapter=${c.id}`}>{c.title}</Link>
            <span className={`summary-status ${status[c.id]}`}>{STATUS_TEXT[status[c.id]]}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
