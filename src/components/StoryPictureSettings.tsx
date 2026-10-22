"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import { useSettings } from "@/lib/settings";
import { drawPresetFor, drawPresetSummary, presetName } from "@/lib/comfy/presets";
import AutoTextarea from "./AutoTextarea";

/**
 * A story's picture settings, kept the same for all its pictures so they match. `draw_preset` is its
 * drawing preset (an id from Settings), null for the first one.
 */
export type StoryPictures = { art_style: string; draw_preset: string | null };

/** Which of a story's picture settings are still to be chosen, by name. */
export function unsetPictureSettings(s: StoryPictures): string[] {
  return [!s.art_style.trim() && "art style"].filter((x): x is string => Boolean(x));
}

/**
 * The story's picture settings, on its details page: the art style added
 * to every one, and the drawing preset (from Settings) its chapters use unless one chooses another.
 */
export default function StoryPictureSettings({ story }: { story: StoryPictures & { id: string } }) {
  const router = useRouter();
  const presets = useSettings().comfy.drawPresets;
  const [saved, setSaved] = useState<StoryPictures>(story);
  const [art, setArt] = useState(story.art_style);
  // The preset shown is the one used: a deleted one shows as the first, which is what the story then uses.
  const [preset, setPreset] = useState<string | null>(story.draw_preset);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = drawPresetFor(presets, preset);
  const changed = art.trim() !== saved.art_style || preset !== saved.draw_preset;

  async function save() {
    setBusy(true);
    setStatus(null);
    const next: StoryPictures = { art_style: art.trim(), draw_preset: preset };
    try {
      const res = await fetch(`/api/stories/${story.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaved(next);
      setStatus({ ok: true, text: "Picture settings saved." });
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const unset = unsetPictureSettings({ art_style: art, draw_preset: preset });
  return (
    <section className="ai-panel" id="pictures">
      <h2>Pictures</h2>
      <p className="meta" style={{ margin: 0 }}>
        Used for every picture in this story, so they match.{unset.length > 0 && ` Not chosen yet: ${unset.join(", ")}.`}
      </p>
      <label>
        Art style
        <AutoTextarea
          style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
          value={art}
          maxLength={LIMITS.artStyle}
          placeholder="e.g. watercolor storybook illustration, soft muted palette, warm light"
          onChange={(e) => {
            setStatus(null);
            setArt(e.target.value);
          }}
        />
        <span className="meta">Added to the end of every picture prompt in this story.</span>
      </label>
      <label className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        Drawing preset
        <select
          aria-label="Drawing preset"
          value={shown.id}
          onChange={(e) => {
            setStatus(null);
            setPreset(e.target.value);
          }}
          style={{ width: "auto", maxWidth: "min(24rem, 100%)" }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {presetName(p)}
            </option>
          ))}
        </select>
      </label>
      <p className="meta" style={{ margin: 0 }}>
        {drawPresetSummary(shown)}. A chapter can choose another on its Illustrate page.{" "}
        <Link href={`/settings#preset-${shown.id}`}>Change presets in Settings</Link>
      </p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={save} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save picture settings"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
    </section>
  );
}
