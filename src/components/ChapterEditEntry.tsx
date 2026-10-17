"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import type { StoryContext } from "@/lib/ai/prompts";
import type { PathChapter } from "@/lib/ai/codexAi";
import type { CodexOp } from "@/lib/codex";
import ChapterEditor from "./ChapterEditor";

type Props = {
  chapterId: string;
  baseRevision: number;
  descendantCount: number;
  initialTitle: string;
  initialBody: string;
  initialSummary: string | null;
  initialPathSummary: string | null;
  existingChoices: { id: string; label: string; hasChild: boolean }[];
  incomingLabel: string | null;
  context: StoryContext;
  draftLabel: string;
  /** The codex as of the previous chapter; absent for a story's first chapter. */
  codexPanel?: { chapterId: string; path: PathChapter[]; ops: CodexOp[] };
  /** Present only for a story's first chapter. */
  story: { id: string; title: string; premise: string } | null;
};

export default function ChapterEditEntry({ story, ...p }: Props) {
  return (
    <>
      {story && <StoryMeta story={story} />}
      <ChapterEditor
        target={{
          kind: "edit",
          chapterId: p.chapterId,
          baseRevision: p.baseRevision,
          descendantCount: p.descendantCount,
          initialTitle: p.initialTitle,
          initialBody: p.initialBody,
          initialSummary: p.initialSummary,
          initialPathSummary: p.initialPathSummary,
          existingChoices: p.existingChoices,
          incomingLabel: p.incomingLabel,
        }}
        context={p.context}
        draftKey={`edit:${p.chapterId}`}
        resumeHref={`/c/${p.chapterId}/edit`}
        draftLabel={p.draftLabel}
        codexPanel={p.codexPanel}
      />
    </>
  );
}

// The story's title and blurb are edited alongside its first chapter.
function StoryMeta({ story }: { story: { id: string; title: string; premise: string } }) {
  const router = useRouter();
  const [title, setTitle] = useState(story.title);
  const [premise, setPremise] = useState(story.premise);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = title.trim() !== story.title || premise.trim() !== story.premise;

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/stories/${story.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, premise }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setStatus({ ok: true, text: "Story details saved." });
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-panel" style={{ marginBottom: "1.5rem" }}>
      <h2>Story details</h2>
      <label>
        Story title
        <input value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Premise
        <textarea
          style={{ minHeight: "5rem" }}
          value={premise}
          maxLength={LIMITS.premise}
          onChange={(e) => setPremise(e.target.value)}
        />
      </label>
      <div className="row">
        <button type="button" onClick={save} disabled={busy || !changed || !title.trim()}>
          {busy ? "Saving…" : "Save story details"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
    </section>
  );
}
