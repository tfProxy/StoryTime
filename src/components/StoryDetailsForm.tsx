"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import AutoTextarea from "./AutoTextarea";

/** A story's details; without an `id`, the form makes a new story with them. */
type Story = { id?: string; title: string; premise: string; style?: string };

type Props = {
  story: Story;
  heading?: string;
  /** With no story id: keep the draft started on the old New story page as the new story's first chapter. */
  adoptDraft?: boolean;
};

/**
 * The story's title and summary, plus its style notes when `style` is given. Saved together. For a new
 * story (no id) the button creates it, then opens its details page, where its first chapter is started.
 */
export default function StoryDetailsForm({ story, heading = "Story details", adoptDraft = false }: Props) {
  const router = useRouter();
  const withStyle = story.style !== undefined;
  const [saved, setSaved] = useState(story);
  const [title, setTitle] = useState(story.title);
  const [premise, setPremise] = useState(story.premise);
  const [style, setStyle] = useState(story.style ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = story.id === undefined;
  const changed =
    creating || title.trim() !== saved.title || premise.trim() !== saved.premise || (withStyle && style.trim() !== (saved.style ?? ""));

  async function save() {
    setBusy(true);
    setStatus(null);
    const next = { title: title.trim(), premise: premise.trim(), ...(withStyle ? { style: style.trim() } : {}) };
    try {
      const res = await fetch(creating ? "/api/stories" : `/api/stories/${story.id}`, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creating ? { ...next, adopt_draft: adoptDraft } : next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (creating) {
        router.push(`/s/${data.story_id}/details`);
        return;
      }
      setSaved({ ...saved, ...next });
      setStatus({ ok: true, text: "Story details saved." });
      router.refresh();
      setBusy(false);
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  }

  return (
    <section className="ai-panel">
      <h2>{heading}</h2>
      <label>
        Story title
        <input
          value={title}
          maxLength={LIMITS.title}
          onChange={(e) => {
            setStatus(null);
            setTitle(e.target.value);
          }}
        />
      </label>
      <label>
        Summary <small>(the premise: shown under the cover in the story list; the AI also sees it)</small>
        <AutoTextarea
          style={{ minHeight: "5rem", fontFamily: "inherit" }}
          value={premise}
          maxLength={LIMITS.premise}
          onChange={(e) => {
            setStatus(null);
            setPremise(e.target.value);
          }}
        />
      </label>
      {withStyle && (
        <label>
          Style notes <small>(point of view, tense, tone, things to avoid. Only the AI sees these, with every prompt)</small>
          <AutoTextarea
            style={{ minHeight: "4rem", fontFamily: "inherit" }}
            value={style}
            maxLength={LIMITS.style}
            placeholder="e.g. First person, past tense. Dry humour. No graphic violence."
            onChange={(e) => {
              setStatus(null);
              setStyle(e.target.value);
            }}
          />
        </label>
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={save} disabled={busy || !changed || !title.trim()}>
          {creating ? (busy ? "Creating…" : "Create story") : busy ? "Saving…" : "Save story details"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
    </section>
  );
}
