"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditKey } from "@/lib/keys";
import { LIMITS } from "@/lib/limits";
import type { StoryContext } from "@/lib/ai/prompts";
import ChapterEditor from "./ChapterEditor";

type Props = {
  chapterId: string;
  baseRevision: number;
  descendantCount: number;
  initialTitle: string;
  initialBody: string;
  existingChoices: { id: string; label: string; hasChild: boolean }[];
  incomingLabel: string | null;
  context: StoryContext;
  draftLabel: string;
  /** Present only for a story's first chapter. */
  story: { id: string; title: string; premise: string } | null;
};

export default function ChapterEditEntry({ story, ...p }: Props) {
  const key = useEditKey(p.chapterId);

  if (!key) {
    return (
      <p className="notice">
        This browser doesn&apos;t have the edit key for this chapter. Edit keys are created in the browser that posts a
        chapter. If you posted it from another browser or device, use the export and import on the{" "}
        <Link href="/settings">Settings</Link> page to bring them over here.
      </p>
    );
  }

  return (
    <>
      {story && <StoryMeta story={story} editKey={key} />}
      <ChapterEditor
        target={{
          kind: "edit",
          chapterId: p.chapterId,
          editKey: key,
          baseRevision: p.baseRevision,
          descendantCount: p.descendantCount,
          initialTitle: p.initialTitle,
          initialBody: p.initialBody,
          existingChoices: p.existingChoices,
          incomingLabel: p.incomingLabel,
        }}
        context={p.context}
        draftKey={`edit:${p.chapterId}`}
        resumeHref={`/c/${p.chapterId}/edit`}
        draftLabel={p.draftLabel}
      />
    </>
  );
}

// The story's title and blurb belong to its first chapter, so its edit key covers them too.
function StoryMeta({ story, editKey }: { story: { id: string; title: string; premise: string }; editKey: string }) {
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
        body: JSON.stringify({ edit_key: editKey, title, premise }),
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
