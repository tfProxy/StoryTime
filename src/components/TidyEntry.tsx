"use client";

import { useRef, useState } from "react";
import type { CodexEntry } from "@/lib/codex";
import { runTidy, tidyOps, type TidyChange } from "@/lib/ai/tidyAi";
import { useSettings } from "@/lib/settings";

const factLine = (aspect: string, form: string, text: string) => `${aspect.trim() || "(no aspect)"}${form.trim() ? ` [${form.trim()}]` : ""}: ${text.trim()}`;

/**
 * "Tidy this entry": the AI proposes renames, merges and splits that put the entry's facts under the category list
 * (Settings → Codex). Each change shows the facts before and after with a tick box; the ticked ones are saved as
 * corrections, so every fact reads the new way from where it was set.
 */
export default function TidyEntry({ entry, storyId, chapterId, onApplied, onClose }: { entry: CodexEntry; storyId: string; chapterId: string; onApplied: () => void; onClose: () => void }) {
  const settings = useSettings();
  const [changes, setChanges] = useState<TidyChange[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"asking" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const byId = new Map(entry.facts.map((f) => [f.fact_id, f]));

  async function ask() {
    setBusy("asking");
    setError(null);
    abort.current = new AbortController();
    try {
      const found = await runTidy(settings, entry, { signal: abort.current.signal, source: { storyId, chapterId } });
      setChanges(found);
      setPicked(new Set(found.map((_, i) => i).filter((i) => !found[i].newCategory)));
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!changes) return;
    setBusy("saving");
    setError(null);
    const ops = tidyOps(entry, changes.filter((_, i) => picked.has(i)));
    for (const op of ops) {
      const res = await fetch("/api/codex/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: op.anchor, entry_id: entry.entry_id, fact_id: op.fact_id, op: op.op, aspect: op.aspect, form: op.form, text: op.text, quote: op.quote }),
      }).catch(() => null);
      if (!res?.ok) {
        const data = res ? await res.json().catch(() => ({})) : {};
        setError(`Some changes were saved, but one failed: ${data.error ?? "the server didn't answer"}. Look over the facts and tidy again.`);
        setBusy(null);
        onApplied();
        return;
      }
    }
    setBusy(null);
    onApplied();
    onClose();
  }

  return (
    <section className="tidy-entry" aria-label={`Tidy ${entry.name}`}>
      <h3>Tidy this entry</h3>
      {changes === null ? (
        <>
          <p className="meta">
            The AI moves {entry.name}&apos;s facts onto your fact categories (Settings › Codex): it renames facts under other
            names, merges ones about the same thing, splits mixed ones and removes “none” facts. It adds nothing. You pick
            which changes to keep.
          </p>
          <div className="row">
            <button type="button" disabled={busy !== null} onClick={() => void ask()}>
              {busy === "asking" ? "Reading the facts…" : "Ask the AI"}
            </button>
            <button type="button" className="secondary" onClick={() => { abort.current?.abort(); onClose(); }}>
              Cancel
            </button>
          </div>
        </>
      ) : changes.length === 0 ? (
        <>
          <p>Nothing to tidy: every fact is already under a category on your list.</p>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <>
          <p className="meta">
            Saved as corrections: each fact reads the new way from the chapter where it was set. Earlier versions of a fact
            keep their wording.
          </p>
          <ul className="tidy-changes">
            {changes.map((c, i) => (
              <li key={i} className="tidy-change">
                <label className="row" style={{ alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={picked.has(i)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setPicked(next);
                    }}
                  />
                  <span>
                    {c.why && <strong className="tidy-why">{c.why}</strong>}
                    {c.sources.map((id) => {
                      const f = byId.get(id);
                      return f ? (
                        <del key={id} className="tidy-before">
                          {factLine(f.aspect, f.form, f.text)}
                        </del>
                      ) : null;
                    })}
                    {c.text ? <ins className="tidy-after">{factLine(c.aspect, c.form, c.text)}</ins> : <em className="tidy-after">Removed</em>}
                    {c.newCategory && <span className="source-badge source-new-category">New category: {c.aspect}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" disabled={busy !== null || picked.size === 0} onClick={() => void apply()}>
              {busy === "saving" ? "Saving…" : `Apply ${picked.size} ${picked.size === 1 ? "change" : "changes"}`}
            </button>
            <button type="button" className="secondary" disabled={busy !== null} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
