"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import AutoTextarea from "./AutoTextarea";

type Story = { id: string; title: string; premise: string; style?: string };

/** The story's title and summary, plus its style notes when `style` is given. Saved together. */
export default function StoryDetailsForm({ story, heading = "Story details" }: { story: Story; heading?: string }) {
  const router = useRouter();
  const withStyle = story.style !== undefined;
  const [saved, setSaved] = useState(story);
  const [title, setTitle] = useState(story.title);
  const [premise, setPremise] = useState(story.premise);
  const [style, setStyle] = useState(story.style ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const changed =
    title.trim() !== saved.title || premise.trim() !== saved.premise || (withStyle && style.trim() !== (saved.style ?? ""));

  async function save() {
    setBusy(true);
    setStatus(null);
    const next = { title: title.trim(), premise: premise.trim(), ...(withStyle ? { style: style.trim() } : {}) };
    try {
      const res = await fetch(`/api/stories/${story.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaved({ ...saved, ...next });
      setStatus({ ok: true, text: "Story details saved." });
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
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
          {busy ? "Saving…" : "Save story details"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
    </section>
  );
}
