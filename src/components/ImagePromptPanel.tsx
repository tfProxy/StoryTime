"use client";

import { useRef, useState } from "react";
import { saveSettings, useSettings, type ModelRef } from "@/lib/settings";
import type { ImagePromptStyle } from "@/lib/settingsSchema";
import { LIMITS } from "@/lib/limits";
import { copyText } from "@/lib/copyText";
import { IMAGE_SLOTS, type ImageSlot } from "@/lib/imageSlots";
import { codexBudget, budgetFor, explainCodex, type ContextChapter, type ContextCodexEntry } from "@/lib/ai/prompts";
import { imagePromptRequest, withArtStyle, writeImagePrompt } from "@/lib/ai/imagePrompt";
import AutoTextarea from "./AutoTextarea";
import ModelPicker from "./ModelPicker";
import PromptButton from "./PromptButton";
import ComfyGenerate from "./ComfyGenerate";

const SLOT_NAMES: Record<ImageSlot, string> = { header: "Header picture", footer: "Footer picture" };
const STYLE_NAMES: Record<ImagePromptStyle, string> = {
  tags: "Tags (SDXL, Pony, SD 1.5)",
  natural: "Sentences (Flux, SD3)",
};

type Props = {
  chapterId: string;
  story: { id: string; title: string; premise: string; art_style: string };
  /** The story from its first chapter down to the chapter being illustrated. */
  path: ContextChapter[];
  codex: ContextCodexEntry[];
};

type Result = { scene: string; prompt: string; negative: string };

/** Writes a prompt for an image generator from the chapter and the codex entries it mentions. */
export default function ImagePromptPanel({ chapterId, story, path, codex }: Props) {
  const settings = useSettings();
  const chapter = path[path.length - 1];
  const [slot, setSlot] = useState<ImageSlot>("header");
  const [direction, setDirection] = useState("");
  const [model, setModel] = useState<ModelRef | null>(null);
  const [artStyle, setArtStyle] = useState(story.art_style);
  const [savedArtStyle, setSavedArtStyle] = useState(story.art_style);
  const [result, setResult] = useState<Result>({ scene: "", prompt: "", negative: "" });
  const [written, setWritten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const style = settings.imagePromptStyle;

  const options = () => ({ story, path, codex, slot, direction, style });
  const used = explainCodex(codex, `${chapter.body}\n${direction}`, codexBudget(budgetFor(settings.contextTokens)))
    .filter((r) => r.state === "included")
    .map((r) => r.entry.name);

  async function saveArtStyle() {
    const next = artStyle.trim();
    if (next === savedArtStyle) return;
    try {
      const res = await fetch(`/api/stories/${story.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ art_style: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't save the art style (${res.status})`);
      setSavedArtStyle(next);
      setStatus({ ok: true, text: "Art style saved." });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function write() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setStatus(null);
    try {
      await saveArtStyle();
      const p = await writeImagePrompt(settings, { ...options(), model, signal: ctl.signal });
      setResult({ scene: p.scene, prompt: withArtStyle(p.prompt, artStyle, style), negative: p.negative });
      setWritten(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, what: string) {
    const done = await copyText(text);
    setStatus(done ? { ok: true, text: `${what} copied.` } : { ok: false, text: "Couldn't copy; select the text and copy it yourself." });
  }

  return (
    <section className="ai-panel image-prompt">
      <h2>Picture prompt</h2>
      <p className="meta" style={{ margin: 0 }}>
        Writes a prompt for your image generator from this chapter and the codex entries it mentions (or type your
        own). Make the pictures with ComfyUI here, or elsewhere and upload them below.
      </p>

      <div className="row" style={{ flexWrap: "wrap" }}>
        <label className="row" style={{ gap: "0.4rem" }}>
          For
          <select aria-label="For" value={slot} onChange={(e) => setSlot(e.target.value as ImageSlot)} style={{ width: "auto" }}>
            {IMAGE_SLOTS.map((s) => (
              <option key={s} value={s}>
                {SLOT_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: "0.4rem" }}>
          Prompt style
          <select
            value={style}
            onChange={(e) => void saveSettings({ ...settings, imagePromptStyle: e.target.value as ImagePromptStyle })}
            style={{ width: "auto" }}
          >
            {(Object.keys(STYLE_NAMES) as ImagePromptStyle[]).map((s) => (
              <option key={s} value={s}>
                {STYLE_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Art style for this story
        <AutoTextarea
          style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
          value={artStyle}
          maxLength={LIMITS.artStyle}
          placeholder="e.g. watercolor storybook illustration, soft muted palette, warm light"
          onChange={(e) => setArtStyle(e.target.value)}
          onBlur={() => void saveArtStyle()}
        />
        <span className="meta">Added to the end of every picture prompt in this story, so the pictures match.</span>
      </label>

      <label>
        What to show (optional)
        <input
          type="text"
          value={direction}
          maxLength={LIMITS.label}
          placeholder="e.g. Jim taking the first bite [close-up]"
          onChange={(e) => setDirection(e.target.value)}
        />
      </label>

      <p className="meta" style={{ margin: 0 }}>
        {used.length ? `Codex entries used: ${used.join(", ")}` : "No codex entries are mentioned in this chapter."}
      </p>

      <div className="row" style={{ flexWrap: "wrap" }}>
        <ModelPicker label="Model for picture prompts" role="cheap" value={model} onChange={setModel} />
        <button type="button" onClick={() => void write()} disabled={busy}>
          {busy ? "Writing…" : written ? "Write again" : "Write prompt"}
        </button>
        <PromptButton label="Write prompt" build={() => imagePromptRequest(settings.contextTokens, options())} />
        {busy && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
      </div>

      <div className="image-prompt-result">
        {result.scene && <p className="meta" style={{ margin: 0 }}>Scene: {result.scene}</p>}
          <label>
            Prompt
            <AutoTextarea
              aria-label="Prompt"
              style={{ minHeight: "5rem", fontFamily: "inherit" }}
              value={result.prompt}
              onChange={(e) => setResult({ ...result, prompt: e.target.value })}
            />
          </label>
          <label>
            Negative prompt
            <AutoTextarea
              aria-label="Negative prompt"
              style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
              value={result.negative}
              onChange={(e) => setResult({ ...result, negative: e.target.value })}
            />
          </label>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="secondary" onClick={() => void copy(result.prompt, "Prompt")} disabled={!result.prompt}>
              Copy prompt
            </button>
            <button type="button" className="secondary" onClick={() => void copy(result.negative, "Negative prompt")} disabled={!result.negative}>
              Copy negative
            </button>
          </div>
      </div>
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}

      <ComfyGenerate chapterId={chapterId} slot={slot} prompt={result.prompt} negative={result.negative} />
    </section>
  );
}
