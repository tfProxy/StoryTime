"use client";

import { useRef, useState } from "react";
import { saveSettings, useSettings } from "@/lib/settings";
import type { ImagePromptStyle } from "@/lib/settingsSchema";
import { LIMITS } from "@/lib/limits";
import { copyText } from "@/lib/copyText";
import { codexBudget, budgetFor, explainCodex, type ContextChapter, type ContextCodexEntry } from "@/lib/ai/prompts";
import { imagePromptRequest, withArtStyle, writeImagePrompt, type ImageMoment } from "@/lib/ai/imagePrompt";
import AutoTextarea from "./AutoTextarea";
import ModelPicker from "./ModelPicker";
import PromptButton from "./PromptButton";
import ComfyGenerate from "./ComfyGenerate";
import type { StartPicture } from "@/lib/comfy/startPicture";
import type { Picture, PromptToLoad } from "./pictures";
import type { PictureBoxes, PictureDraft } from "@/lib/pictureDrafts";
import { EMPTY_BOXES, usePictureDraft } from "./usePictureDraft";

const MOMENT_NAMES: Record<ImageMoment, string> = { start: "Chapter start", end: "Chapter end" };
const STYLE_NAMES: Record<ImagePromptStyle, string> = {
  tags: "Tags (SDXL, Pony, SD 1.5)",
  natural: "Sentences (Flux, SD3)",
};

/** A prompt brought back from a saved picture. `nonce` changes with every request, even for the same prompt. */
export type LoadedPrompt = PromptToLoad & { nonce: number };

type Props = {
  /** Fills in the prompt boxes when it changes. */
  loaded?: LoadedPrompt | null;
  /** The picture new pictures start from (image to image), and how to drop it. */
  start?: StartPicture | null;
  onClearStart?: () => void;
  /** Called with each finished job's pictures. */
  onPictures?: (pictures: Picture[]) => void;
  /** Where to show the jobs being made. */
  queueSlot?: HTMLElement | null;
  chapterId: string;
  story: { id: string; title: string; premise: string; art_style: string };
  /** The story from its first chapter down to the chapter being illustrated. */
  path: ContextChapter[];
  codex: ContextCodexEntry[];
  /** The prompt boxes as last left for this chapter, to start from. */
  draft?: PictureDraft | null;
};

/**
 * Writes a prompt for an image generator from the chapter and the codex entries it mentions. Each moment
 * (chapter start, chapter end) has its own boxes, so switching between them brings each one's prompt back;
 * they are kept for the chapter on the server, so they are there again next time.
 */
export default function ImagePromptPanel({ chapterId, story, path, codex, loaded = null, start = null, onClearStart, onPictures, queueSlot, draft = null }: Props) {
  const settings = useSettings();
  const chapter = path[path.length - 1];
  const [moment, setMoment] = useState<ImageMoment>(draft?.moment ?? "start");
  const [artStyle, setArtStyle] = useState(story.art_style);
  const [savedArtStyle, setSavedArtStyle] = useState(story.art_style);
  // Each moment's boxes; those of the moment chosen are shown.
  const [boxes, setBoxes] = useState<Record<ImageMoment, PictureBoxes>>(() => ({ start: draft?.start ?? EMPTY_BOXES, end: draft?.end ?? EMPTY_BOXES }));
  const result = boxes[moment];
  const direction = result.direction;
  const change = (m: ImageMoment, patch: Partial<PictureBoxes>) => setBoxes((prev) => ({ ...prev, [m]: { ...prev[m], ...patch } }));
  const saveError = usePictureDraft(chapterId, { ...result, moment }, draft);
  // The moments a prompt was written for on this visit.
  const [written, setWritten] = useState<Record<ImageMoment, boolean>>({ start: false, end: false });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // A prompt loaded from a picture replaces the boxes (and the moment, when known) once per request.
  const [seenLoad, setSeenLoad] = useState(0);
  if (loaded && loaded.nonce !== seenLoad) {
    setSeenLoad(loaded.nonce);
    const into = loaded.moment ?? moment;
    change(into, { scene: "", prompt: loaded.prompt, negative: loaded.negative });
    setMoment(into);
    setStatus({ ok: true, text: "Prompt loaded from the picture." });
  }
  const style = settings.imagePromptStyle;
  const model = settings.imagePromptModel;

  const options = () => ({ story, path, codex, moment, direction, style });
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
    // The prompt goes to the moment it was written for, even if another is chosen meanwhile.
    const forMoment = moment;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setStatus(null);
    try {
      await saveArtStyle();
      const p = await writeImagePrompt(settings, { ...options(), model, signal: ctl.signal });
      change(forMoment, { scene: p.scene, prompt: withArtStyle(p.prompt, artStyle, style), negative: p.negative });
      setWritten((prev) => ({ ...prev, [forMoment]: true }));
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
    <section className="ai-panel image-prompt" id="picture-prompt">
      <h2>Picture prompt</h2>
      <p className="meta" style={{ margin: 0 }}>
        Writes a prompt for your image generator from this chapter and the codex entries it mentions (or type your
        own). Make the pictures with ComfyUI here, or elsewhere and upload them below.
      </p>

      <div className="row" style={{ flexWrap: "wrap" }}>
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

      <div className="row">
        <label className="row" style={{ gap: "0.4rem" }}>
          Picture for
          <select
            aria-label="Moment to show"
            title="Which part of the chapter the picture shows. Each has its own prompt."
            value={moment}
            onChange={(e) => setMoment(e.target.value as ImageMoment)}
            style={{ width: "auto" }}
          >
            {(Object.keys(MOMENT_NAMES) as ImageMoment[]).map((m) => (
              <option key={m} value={m}>
                {MOMENT_NAMES[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        What to show (optional)
        <input
          type="text"
          value={direction}
          maxLength={LIMITS.label}
          placeholder="e.g. Jim taking the first bite [close-up]"
          onChange={(e) => change(moment, { direction: e.target.value })}
        />
      </label>

      <p className="meta" style={{ margin: 0 }}>
        {used.length ? `Codex entries used: ${used.join(", ")}` : "No codex entries are mentioned in this chapter."}
      </p>

      <div className="row" style={{ flexWrap: "wrap" }}>
        <ModelPicker
          label="Model for picture prompts"
          role="cheap"
          value={model}
          onChange={(ref) => void saveSettings({ ...settings, imagePromptModel: ref })}
        />
        <button type="button" onClick={() => void write()} disabled={busy}>
          {busy ? "Writing…" : written[moment] ? "Write again" : "Write prompt"}
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
              maxLength={LIMITS.picturePrompt}
              value={result.prompt}
              onChange={(e) => change(moment, { prompt: e.target.value })}
            />
          </label>
          <label>
            Negative prompt
            <AutoTextarea
              aria-label="Negative prompt"
              style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
              maxLength={LIMITS.picturePrompt}
              value={result.negative}
              onChange={(e) => change(moment, { negative: e.target.value })}
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
      {saveError && <p className="error" style={{ margin: 0 }}>Couldn&apos;t keep the prompt for next time: {saveError}</p>}

      <ComfyGenerate
        chapterId={chapterId}
        storyId={story.id}
        moment={moment}
        prompt={result.prompt}
        negative={result.negative}
        loaded={loaded}
        start={start}
        onPictures={onPictures}
        queueSlot={queueSlot}
        onClearStart={onClearStart}
      />
    </section>
  );
}
