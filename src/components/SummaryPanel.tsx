"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSettings } from "@/lib/settings";
import { LIMITS } from "@/lib/limits";
import { ensurePathSummaries, summarizeChapter, type Summaries } from "@/lib/ai/summaries";
import type { ContextChapter } from "@/lib/ai/prompts";
import SplitActionButton, { type SplitMode } from "./SplitActionButton";
import { useSummaryCheck } from "./SummaryCheck";

type Props = {
  storyId: string;
  chapterId: string;
  story: { title: string; premise: string };
  /** The story from its first chapter down to (and including) this one. */
  path: ContextChapter[];
  /** The chapter was edited after its summary was made. */
  stale: boolean;
  /** The chapter's summary issues from the Issues list, drawn under the boxes. */
  issues?: ReactNode;
  /** Why the summary couldn't be made when the chapter was posted. */
  failed?: string;
  unfinishedRunId?: string | null;
};

/** One chapter's summary and its story so far, with a ▾ combo button: Save, write it again with AI, check it with AI. */
export default function SummaryPanel({ storyId, chapterId, story, path, stale, issues, failed, unfinishedRunId = null }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const chapter = path[path.length - 1];
  const index = path.length - 1;
  const checker = useSummaryCheck(storyId, chapterId, unfinishedRunId);

  const [summary, setSummary] = useState(chapter.summary ?? "");
  const [pathSummary, setPathSummary] = useState(chapter.path_summary ?? "");
  const [saved, setSaved] = useState({ summary: chapter.summary ?? "", path: chapter.path_summary ?? "" });
  const [busy, setBusy] = useState<null | "generate" | "save">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const missing = !saved.summary || !saved.path;
  const dirty = summary.trim() !== saved.summary || pathSummary.trim() !== saved.path;
  const [picked, setMode] = useState<string>("save");
  // With nothing written yet the main button writes it; Save would have nothing to save.
  const mode = missing && picked === "save" ? "rewrite" : picked;

  const modes: SplitMode[] = [
    { id: "save", label: "Save", hint: "Keeps what is in the boxes." },
    { id: "rewrite", label: missing ? "Write it with AI" : "Write it again with AI", hint: "Replaces both boxes with a new summary." },
    { id: "check", label: "Check it with AI", hint: "Says whether the saved summary matches the chapter." },
  ];

  function show(s: Summaries) {
    setSummary(s.summary);
    setPathSummary(s.path_summary);
    setSaved({ summary: s.summary, path: s.path_summary });
  }

  async function put(s: Summaries) {
    const res = await fetch(`/api/chapters/${chapterId}/summary`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: chapter.revision, summary: s.summary, path_summary: s.path_summary }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Couldn't save (${res.status})`);
  }

  /**
   * Without `force`, fills in what is missing. With `force`, it redoes this chapter's summaries from scratch.
   */
  async function generate(force: boolean) {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy("generate");
    setError(null);
    const progress = (done: number, total: number) =>
      setStatus(`Summarizing the story so far (${Math.min(done + 1, total)} of ${total})…`);
    // Stream this chapter's summaries into the boxes as they are written; undo that if it fails.
    const before = { summary, pathSummary };
    const stream = (p: Summaries) => {
      setSummary(p.summary);
      setPathSummary(p.path_summary);
    };
    try {
      if (!force) {
        const made = await ensurePathSummaries(settings, path, index, {
          story,
          signal: ctl.signal,
          onProgress: progress,
          onText: (p, i) => i === index && stream(p),
        });
        const s = chapter.id ? made[chapter.id] : undefined;
        if (s) show(s);
        setStatus("Summary saved.");
        router.refresh();
        return;
      }
      // Regenerate: make sure everything before this chapter is summarized, then redo this one.
      let previous: string | null = null;
      if (index > 0) {
        const made = await ensurePathSummaries(settings, path, index - 1, { story, signal: ctl.signal, onProgress: progress });
        const parent = path[index - 1];
        previous = (parent.id && made[parent.id]?.path_summary) || parent.path_summary;
      }
      setStatus("Summarizing this chapter…");
      const s = await summarizeChapter(settings, { story, previous, chapter, signal: ctl.signal, onText: stream });
      await put(s);
      show(s);
      setStatus("Written again and saved.");
      router.refresh();
    } catch (e) {
      setStatus(null);
      setSummary(before.summary);
      setPathSummary(before.pathSummary);
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    setStatus(null);
    try {
      const s = { summary: summary.trim(), path_summary: pathSummary.trim() };
      await put(s);
      show(s);
      setStatus("Saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function main() {
    setMode("save");
    if (mode === "rewrite") void generate(!missing);
    else if (mode === "check") {
      setError(null);
      setStatus(null);
      if (dirty) setError("Save your changes first: the check reads the saved summary.");
      else if (missing) setError("There is no summary to check yet.");
      else void checker.check();
    } else void save();
  }

  const nothingToSave = mode === "save" && (!dirty || !summary.trim() || !pathSummary.trim());
  return (
    <form onSubmit={(e) => e.preventDefault()} className="summary-form">
      <p className="meta" style={{ margin: 0 }}>
        The AI reads these instead of the full text when it continues the story from “{chapter.title}”.
      </p>
      {failed && (
        <p className="notice">
          Your chapter was saved, but the AI couldn&apos;t summarize it: {failed.slice(0, 300)}. Check your{" "}
          <Link href="/settings">AI settings</Link> and write the summary again below.
        </p>
      )}
      {missing && (
        <p className="notice">
          {saved.summary || saved.path ? "Part of this chapter's summary is missing." : "This chapter has no summary yet."} Write it now so the
          AI can remember this chapter when the story continues.
        </p>
      )}
      {!missing && stale && <p className="notice">The chapter was edited after this summary was made.</p>}

      <label>
        This chapter
        <textarea
          style={{ minHeight: "7rem", fontFamily: "inherit" }}
          value={summary}
          maxLength={LIMITS.summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label>
        The story so far
        <textarea
          style={{ minHeight: "10rem", fontFamily: "inherit" }}
          value={pathSummary}
          maxLength={LIMITS.summary}
          onChange={(e) => setPathSummary(e.target.value)}
        />
      </label>

      <div className="row">
        <SplitActionButton
          startAligned
          verb="fix this summary"
          modes={modes}
          mode={mode}
          onMode={setMode}
          onMain={main}
          busyLabel={busy === "save" ? "Saving…" : busy === "generate" ? "Writing…" : checker.busy ? "Checking…" : null}
          disabled={busy !== null || checker.busy || nothingToSave}
        />
        {busy === "generate" && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
      </div>
      {status && <p className="meta" style={{ margin: 0 }}>{status}</p>}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {checker.view}
      {issues}
    </form>
  );
}
