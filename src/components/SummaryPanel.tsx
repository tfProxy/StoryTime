"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSettings } from "@/lib/settings";
import { useEditKey } from "@/lib/keys";
import { LIMITS } from "@/lib/limits";
import { ensurePathSummaries, summarizeChapter, type Summaries } from "@/lib/ai/summaries";
import type { ContextChapter } from "@/lib/ai/prompts";

type Props = {
  chapterId: string;
  story: { title: string; premise: string };
  /** The story from its first chapter down to (and including) this one. */
  path: ContextChapter[];
};

export default function SummaryPanel({ chapterId, story, path }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const editKey = useEditKey(chapterId);
  const chapter = path[path.length - 1];
  const index = path.length - 1;

  const [summary, setSummary] = useState(chapter.summary ?? "");
  const [pathSummary, setPathSummary] = useState(chapter.path_summary ?? "");
  const [saved, setSaved] = useState({ summary: chapter.summary ?? "", path: chapter.path_summary ?? "" });
  const [busy, setBusy] = useState<null | "generate" | "save">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const missing = !saved.summary || !saved.path;
  const dirty = summary.trim() !== saved.summary || pathSummary.trim() !== saved.path;

  function show(s: Summaries) {
    setSummary(s.summary);
    setPathSummary(s.path_summary);
    setSaved({ summary: s.summary, path: s.path_summary });
  }

  async function put(s: Summaries) {
    const res = await fetch(`/api/chapters/${chapterId}/summary`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edit_key: editKey, revision: chapter.revision, summary: s.summary, path_summary: s.path_summary }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Couldn't save (${res.status})`);
  }

  /**
   * Without `force`, fills in what is missing (anyone can). With `force`, the author's key lets
   * it redo this chapter's summaries from scratch.
   */
  async function generate(force: boolean) {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy("generate");
    setError(null);
    const progress = (done: number, total: number) =>
      setStatus(`Summarizing the story so far (${Math.min(done + 1, total)} of ${total})…`);
    try {
      if (!force) {
        const made = await ensurePathSummaries(settings, path, index, { story, signal: ctl.signal, onProgress: progress });
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
      const s = await summarizeChapter(settings, { story, previous, chapter, signal: ctl.signal });
      await put(s);
      show(s);
      setStatus("Regenerated and saved.");
      router.refresh();
    } catch (e) {
      setStatus(null);
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

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      {missing && (
        <p className="notice">
          {saved.summary || saved.path ? "Part of this chapter's summary is missing." : "This chapter has no summary yet."}{" "}
          Generate it now so the AI can remember this chapter when the story continues.
        </p>
      )}

      <label>
        This chapter <small>(what happens in “{chapter.title}”)</small>
        <textarea
          style={{ minHeight: "7rem", fontFamily: "inherit" }}
          value={summary}
          maxLength={LIMITS.summary}
          readOnly={!editKey}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label>
        The story so far <small>(everything up to and including this chapter)</small>
        <textarea
          style={{ minHeight: "12rem", fontFamily: "inherit" }}
          value={pathSummary}
          maxLength={LIMITS.summary}
          readOnly={!editKey}
          onChange={(e) => setPathSummary(e.target.value)}
        />
      </label>

      {!editKey && (
        <p className="meta">
          Only the browser that posted this chapter can edit or replace its summary.
          {!missing && " Anyone can fill in a missing one."}
        </p>
      )}

      <div className="row">
        {missing && (
          <button type="button" onClick={() => generate(false)} disabled={busy !== null}>
            {busy === "generate" ? "Generating…" : "Generate summary"}
          </button>
        )}
        {editKey && (
          <>
            <button type="button" onClick={save} disabled={busy !== null || !dirty || !summary.trim() || !pathSummary.trim()}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="secondary" onClick={() => generate(true)} disabled={busy !== null}>
              Regenerate
            </button>
          </>
        )}
        {busy === "generate" && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
        <Link href="/settings" className="meta">
          AI settings
        </Link>
      </div>
      {status && <p className="meta">{status}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
