"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import { useSettings } from "@/lib/settings";
import { drawPresetFor, drawPresetSummary, presetName } from "@/lib/comfy/presets";
import { DEFAULT_WEIGHTS, type StoredReference } from "@/lib/comfy/references";
import { referenceChoices, restoreReference, type RefPool } from "@/lib/comfy/referenceChoices";
import AutoTextarea from "./AutoTextarea";
import { ReferencePicker } from "./References";

/**
 * A story's picture settings, kept the same for all its pictures so they match. `draw_preset` is its
 * drawing preset (an id from Settings), null for the first one.
 */
export type StoryPictures = { art_style: string; draw_preset: string | null; style_ref: StoredReference | null };

/** Which of a story's picture settings are still to be chosen, by name. */
export function unsetPictureSettings(s: StoryPictures): string[] {
  return [!s.art_style.trim() && "art style"].filter((x): x is string => Boolean(x));
}

/**
 * The story's picture settings, on its details page: the art style added
 * to every one, and the drawing preset (from Settings) its chapters use unless one chooses another.
 */
export default function StoryPictureSettings({ story, pool }: { story: StoryPictures & { id: string }; pool: RefPool }) {
  const router = useRouter();
  const settings = useSettings();
  const presets = settings.comfy.drawPresets;
  const [style, setStyle] = useState<StoredReference | null>(story.style_ref);
  const [picking, setPicking] = useState(false);
  // A picture chosen on this visit shows as it was chosen; a kept one is found again in the pool or ComfyUI.
  const [pickedThumb, setPickedThumb] = useState<{ source: string; thumb: string } | null>(null);
  const restored = style ? restoreReference(style, { pool, comfyUrl: settings.comfy.url }) : null;
  const styleThumb = style && pickedThumb?.source === style.source ? pickedThumb.thumb : (restored?.thumb ?? null);
  const choices = referenceChoices({ pool, chapterId: null, moment: "cover", comfyUrl: settings.comfy.url, pinned: [] });
  const [saved, setSaved] = useState<StoryPictures>(story);
  const [art, setArt] = useState(story.art_style);
  // The preset shown is the one used: a deleted one shows as the first, which is what the story then uses.
  const [preset, setPreset] = useState<string | null>(story.draw_preset);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = drawPresetFor(presets, preset);
  const changed = art.trim() !== saved.art_style || preset !== saved.draw_preset || JSON.stringify(style) !== JSON.stringify(saved.style_ref);

  async function save() {
    setBusy(true);
    setStatus(null);
    const next: StoryPictures = { art_style: art.trim(), draw_preset: preset, style_ref: style };
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

  const unset = unsetPictureSettings({ art_style: art, draw_preset: preset, style_ref: style });
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
      <div id="style-picture" className="reference-item story-style-setting">
        {styleThumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size
          <img className="reference-thumb" src={styleThumb} alt="Style picture" />
        ) : null}
        <div className="reference-fields">
          <strong>Style picture (optional)</strong>
          <span className="meta">
            {style
              ? `${style.label || "Picture"}${styleThumb ? "" : " (its picture can't be found now)"}. Sent with every picture in this story as a style reference; each picture page can leave it out.`
              : "A picture whose look every picture in this story should follow. Sent as a style reference."}
          </span>
          {style && (
            <label className="strength">
              Strength {style.weight.toFixed(2)}
              <input
                type="range"
                aria-label="Style picture strength"
                min={0}
                max={1}
                step={0.05}
                value={Math.min(style.weight, 1)}
                onChange={(e) => {
                  setStatus(null);
                  setStyle({ ...style, weight: Number(e.target.value) });
                }}
              />
              <span className="strength-ends" aria-hidden="true">
                <span>Low</span>
                <span>High</span>
              </span>
            </label>
          )}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="secondary" onClick={() => setPicking(true)}>
              Choose…
            </button>
            {style && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setStatus(null);
                  setStyle(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
      {picking && (
        <ReferencePicker
          suggested={choices.suggested}
          pictures={choices.pictures}
          codex={choices.codex}
          chosen={style ? [style.source] : []}
          full={false}
          noUpload
          onPick={(picture, label) => {
            setStatus(null);
            setPickedThumb({ source: picture.source, thumb: picture.thumb });
            setStyle({ source: picture.source, label, role: "style", weight: style?.weight ?? DEFAULT_WEIGHTS.style });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={save} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save picture settings"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
    </section>
  );
}
