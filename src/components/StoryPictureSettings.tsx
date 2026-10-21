"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import { useSettings } from "@/lib/settings";
import type { ImagePromptStyle } from "@/lib/settingsSchema";
import { listCheckpoints } from "@/lib/comfy/client";
import AutoTextarea from "./AutoTextarea";

export const PROMPT_STYLE_NAMES: Record<ImagePromptStyle, string> = {
  tags: "Tags (SDXL, Pony, SD 1.5)",
  natural: "Sentences (Flux, SD3)",
};

/** A story's picture settings, kept the same for all its pictures so they match. */
export type StoryPictures = { image_prompt_style: ImagePromptStyle | null; art_style: string; checkpoint: string };

/** Which of a story's picture settings are still to be chosen, by name. */
export function unsetPictureSettings(s: StoryPictures): string[] {
  return [!s.image_prompt_style && "prompt style", !s.art_style.trim() && "art style", !s.checkpoint && "checkpoint"].filter(
    (x): x is string => Boolean(x),
  );
}

/**
 * The story's picture settings, on its details page: how picture prompts are written, the art style added
 * to every one, and the ComfyUI checkpoint (listed from ComfyUI when its address is set in Settings).
 */
export default function StoryPictureSettings({ story }: { story: StoryPictures & { id: string } }) {
  const router = useRouter();
  const comfyUrl = useSettings().comfy.url;
  const [saved, setSaved] = useState<StoryPictures>(story);
  const [style, setStyle] = useState<ImagePromptStyle | null>(story.image_prompt_style);
  const [art, setArt] = useState(story.art_style);
  const [checkpoint, setCheckpoint] = useState(story.checkpoint);
  const [checkpoints, setCheckpoints] = useState<{ url: string; list: string[] | null; error: string | null } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = style !== saved.image_prompt_style || art.trim() !== saved.art_style || checkpoint !== saved.checkpoint;
  const listed = checkpoints?.url === comfyUrl ? checkpoints : null;

  // The checkpoint list comes from ComfyUI whenever its address changes.
  useEffect(() => {
    if (!comfyUrl) return;
    let live = true;
    listCheckpoints(comfyUrl).then(
      (list) => live && setCheckpoints({ url: comfyUrl, list, error: null }),
      (e) => live && setCheckpoints({ url: comfyUrl, list: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [comfyUrl]);

  async function save() {
    setBusy(true);
    setStatus(null);
    const next: StoryPictures = { image_prompt_style: style, art_style: art.trim(), checkpoint };
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

  const unset = unsetPictureSettings({ image_prompt_style: style, art_style: art, checkpoint });
  return (
    <section className="ai-panel" id="pictures">
      <h2>Pictures</h2>
      <p className="meta" style={{ margin: 0 }}>
        Used for every picture in this story, so they match.{unset.length > 0 && ` Not chosen yet: ${unset.join(", ")}.`}
      </p>
      <label className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        Prompt style
        <select
          value={style ?? ""}
          onChange={(e) => {
            setStatus(null);
            setStyle((e.target.value || null) as ImagePromptStyle | null);
          }}
          style={{ width: "auto" }}
        >
          {!style && <option value="">Choose one…</option>}
          {(Object.keys(PROMPT_STYLE_NAMES) as ImagePromptStyle[]).map((s) => (
            <option key={s} value={s}>
              {PROMPT_STYLE_NAMES[s]}
            </option>
          ))}
        </select>
      </label>
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
      {comfyUrl ? (
        <label className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          Checkpoint
          <select
            value={checkpoint}
            onChange={(e) => {
              setStatus(null);
              setCheckpoint(e.target.value);
            }}
            style={{ width: "auto", maxWidth: "min(24rem, 100%)" }}
          >
            {!checkpoint && <option value="">{listed?.list ? "Choose one…" : listed?.error ? "Couldn't list them" : "Loading…"}</option>}
            {checkpoint && !listed?.list?.includes(checkpoint) && <option value={checkpoint}>{checkpoint}</option>}
            {(listed?.list ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="meta" style={{ margin: 0 }}>
          Checkpoint: {checkpoint || "not chosen"}. To choose one, add your ComfyUI machine in <Link href="/settings#comfyui">Settings</Link>.
        </p>
      )}
      {listed?.error && <p className="error" style={{ margin: 0 }}>Couldn&apos;t list ComfyUI&apos;s checkpoints: {listed.error}</p>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={save} disabled={busy || !changed}>
          {busy ? "Saving…" : "Save picture settings"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
    </section>
  );
}
