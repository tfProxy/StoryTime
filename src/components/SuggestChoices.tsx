"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeChat } from "@/lib/ai/client";
import { choicesPrompt, parseChoices, SYSTEM_CHOICES } from "@/lib/ai/prompts";
import { getContext } from "@/lib/aiRuns/api";
import { storyContextOf, withPathSummaries } from "@/lib/aiRuns/writeChapter";
import { LIMITS } from "@/lib/limits";
import { useSettings } from "@/lib/settings";

/**
 * "Suggest choices" on the chapter reading page: the same request as the writing page's, for a chapter already
 * posted. Each suggestion picked is added to the chapter as an unwritten choice.
 */
export default function SuggestChoices({
  storyId,
  chapterId,
  incoming,
  choices,
}: {
  storyId: string;
  chapterId: string;
  /** The choice the reader took to reach this chapter, if any. */
  incoming: string | null;
  choices: string[];
}) {
  const router = useRouter();
  const settings = useSettings();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState<"suggest" | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = choices.length >= LIMITS.choices;

  async function suggest() {
    setBusy("suggest");
    setError(null);
    try {
      const context = await getContext(fetch, chapterId);
      const chapter = context.path.at(-1)!;
      // The story before this chapter; the chapter itself goes into the prompt separately.
      const ctx = await withPathSummaries(settings, storyContextOf({ ...context, path: context.path.slice(0, -1) }, incoming, []));
      const have = context.choices.map((c) => c.label);
      const text = await completeChat(settings, {
        system: SYSTEM_CHOICES,
        messages: [{ role: "user", content: choicesPrompt(ctx, chapter, have, settings.contextTokens, suggestions) }],
        role: "cheap",
        maxTokens: 400,
        source: { label: "Suggest choices", storyId, chapterId },
      });
      // A model sometimes hands back a choice it was told the chapter already has.
      const taken = new Set(have.map((c) => c.trim().toLowerCase()));
      setSuggestions(parseChoices(text).filter((c) => !taken.has(c.toLowerCase())));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function add(label: string) {
    setBusy("add");
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/choices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.slice(0, LIMITS.label) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSuggestions((s) => s.filter((x) => x !== label));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <p className="row">
        <button type="button" className="secondary" onClick={suggest} disabled={busy !== null}>
          {busy === "suggest" ? "Thinking…" : "Suggest choices"}
        </button>
      </p>
      {suggestions.length > 0 && (
        <div style={{ display: "grid", justifyItems: "start", gap: "0.4rem" }}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              style={{ textAlign: "left", borderRadius: "0.9rem" }}
              disabled={busy !== null || full}
              onClick={() => add(s)}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      {full && suggestions.length > 0 && <p className="meta">This chapter has the most choices it can have ({LIMITS.choices}).</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
