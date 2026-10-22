"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { saveSettings, useSettings } from "@/lib/settings";
import { LIMITS } from "@/lib/limits";
import { copyText } from "@/lib/copyText";
import { codexBudget, budgetFor, explainCodex, type ContextChapter, type ContextCodexEntry } from "@/lib/ai/prompts";
import { combinePrompts, imagePromptRequest, withArtStyle, withoutGiven, writeImagePrompt, type ImageMoment } from "@/lib/ai/imagePrompt";
import AutoTextarea from "./AutoTextarea";
import ModelPicker from "./ModelPicker";
import PromptButton from "./PromptButton";
import ComfyGenerate, { type PaintProps } from "./ComfyGenerate";
import { CopyIcon, RedoIcon, SparkleIcon, StopIcon } from "./PictureIcons";
import type { StartPicture } from "@/lib/comfy/startPicture";
import type { PendingJob, Picture, PromptToLoad, StartMode } from "./pictures";
import type { EditModels } from "./useEditModels";
import type { PictureBoxes, PictureDraft } from "@/lib/pictureDrafts";
import { EMPTY_BOXES, usePictureDraft } from "./usePictureDraft";
import { unsetPictureSettings, type StoryPictures } from "./StoryPictureSettings";
import { drawPresetFor, presetName } from "@/lib/comfy/presets";

const MOMENT_NAMES: Record<ImageMoment, string> = { start: "Chapter Start", end: "Chapter End" };

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** The story fields the picture prompt uses: its premise, and its picture settings (see StoryPictureSettings). */
export type IllustratedStory = { id: string; title: string; premise: string } & StoryPictures;

/** The story's picture settings, the same for all its pictures, with a link to its details page where they are set. */
export function StoryPicturesLine({ story }: { story: IllustratedStory }) {
  const settings = useSettings();
  const unset = unsetPictureSettings(story);
  const settingsHref = `/s/${story.id}/details#pictures`;
  return (
    <div className="story-pictures">
      <div className="story-pictures-row">
        <ul className="story-pictures-list" aria-label="This story's picture settings">
          <li>{story.art_style.trim() ? <span title={story.art_style}>{short(story.art_style.trim(), 80)}</span> : "no art style"}</li>
          <li title="The story's drawing preset">{presetName(drawPresetFor(settings.comfy.drawPresets, story.draw_preset))}</li>
        </ul>
        <Link href={settingsHref} title={unset.length > 0 ? `Not chosen yet for this story: ${unset.join(", ")}` : undefined}>
          {unset.length > 0 ? "Choose in Story details" : "Change"}
        </Link>
      </div>
    </div>
  );
}

/** A prompt brought back from a saved picture. `nonce` changes with every request, even for the same prompt. */
export type LoadedPrompt = PromptToLoad & { nonce: number };

type Props = {
  /** Fills in the prompt boxes when it changes. */
  loaded?: LoadedPrompt | null;
  /** The picture new pictures start from (image to image), and how to drop it. */
  start?: StartPicture | null;
  onClearStart?: () => void;
  /** Whether the starting picture is redrawn from the prompt or edited by instruction, and how to switch. */
  startMode?: StartMode;
  onStartMode?: (mode: StartMode) => void;
  /** The part of the starting picture painted to redraw (Redraw only). */
  paint?: PaintProps;
  /** Which edit models ComfyUI can run. */
  editModels?: EditModels;
  /** Called with each finished job's pictures. */
  onPictures?: (pictures: Picture[]) => void;
  /** Called with the jobs being made, newest first. */
  onQueue?: (jobs: PendingJob[]) => void;
  chapterId: string;
  story: IllustratedStory;
  /** The chapter's own drawing preset (chosen on this page), or null to use the story's. */
  chapterPreset?: string | null;
  /** The story from its first chapter down to the chapter being illustrated. */
  path: ContextChapter[];
  codex: ContextCodexEntry[];
  /** The prompt boxes as last left for this chapter, to start from. */
  draft?: PictureDraft | null;
  /** Text the chapter's prompts always include, as saved. */
  fixedPrompt?: string;
  /** Where Size, Queue and the queue's status go, to stay in view at the bottom of the column. */
  dock?: HTMLElement | null;
  /** Where the "Codex entries used" line goes: the bottom of the chapter panel. */
  codexSlot?: HTMLElement | null;
};

/**
 * Writes a prompt for an image generator from the chapter and the codex entries it mentions. Each moment
 * (chapter start, chapter end) has its own boxes, so switching between them brings each one's prompt back;
 * they are kept for the chapter on the server, so they are there again next time.
 */
export default function ImagePromptPanel({ chapterId, story, chapterPreset = null, path, codex, loaded = null, start = null, onClearStart, startMode = "redraw", onStartMode, paint, editModels, onPictures, onQueue, draft = null, fixedPrompt = "", dock = null, codexSlot = null }: Props) {
  const settings = useSettings();
  const chapter = path[path.length - 1];
  const [moment, setMoment] = useState<ImageMoment>(draft?.moment ?? "start");
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
    // A cover's prompt goes to the moment shown.
    const into = loaded.moment && loaded.moment !== "cover" ? loaded.moment : moment;
    change(into, { scene: "", prompt: loaded.prompt, negative: loaded.negative });
    setMoment(into);
    setStatus({ ok: true, text: "Prompt loaded from the picture." });
  }
  // Prompts are written in the style of the model that will draw them: the chapter's drawing preset, else the story's.
  const [presetNow, setPresetNow] = useState(chapterPreset);
  const draw = drawPresetFor(settings.comfy.drawPresets, presetNow, story.draw_preset);
  const style = draw.promptStyle;
  const model = settings.imagePromptModel;

  // Text always included in this chapter's prompts: kept on the server 0.7 s after typing stops, and when the page is left.
  const [fixed, setFixed] = useState(fixedPrompt);
  const [fixedError, setFixedError] = useState<string | null>(null);
  const fixedSaved = useRef(fixedPrompt);
  const fixedNow = useRef(fixed);
  useEffect(() => {
    fixedNow.current = fixed;
  }, [fixed]);
  const saveFixed = useCallback(
    (keepalive: boolean) => {
      const text = fixedNow.current;
      if (text === fixedSaved.current) return;
      fetch(`/api/chapters/${chapterId}/picture-fixed`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixed: text }),
        keepalive,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Request failed (${res.status})`);
          fixedSaved.current = text;
          setFixedError(null);
        })
        .catch((e) => setFixedError(e instanceof Error ? e.message : String(e)));
    },
    [chapterId],
  );
  useEffect(() => {
    const timer = setTimeout(() => saveFixed(false), 700);
    return () => clearTimeout(timer);
  }, [fixed, saveFixed]);
  useEffect(() => {
    const leave = () => saveFixed(true);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [saveFixed]);

  const options = () => ({ story, path, codex, moment, direction, style, fixed: combinePrompts(style, fixed, draw.prompt) });
  const used = explainCodex(codex, `${chapter.body}\n${direction}`, codexBudget(budgetFor(settings.contextTokens)))
    .filter((r) => r.state === "included")
    .map((r) => r.entry.name);

  async function write() {
    // The prompt goes to the moment it was written for, even if another is chosen meanwhile.
    const forMoment = moment;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setStatus(null);
    try {
      const p = await writeImagePrompt(settings, { ...options(), model, signal: ctl.signal });
      // What the author always includes is added when pictures are made, so it isn't repeated in the written prompt.
      const prompt = withoutGiven(p.prompt, [fixed, draw.prompt], style);
      change(forMoment, { scene: p.scene, prompt: withArtStyle(prompt, story.art_style, style), negative: withoutGiven(p.negative, [draw.negative], style) });
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

  const promptPanel = (
    <section className="ai-panel image-prompt" id="picture-prompt">
      <h2>Picture prompt</h2>
      <div className="row">
        <label className="row" style={{ gap: "0.4rem" }}>
          Generate Prompt From
          <select
            aria-label="Moment to show"
            title="Which part of the chapter the prompt is written from. Each has its own prompt."
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
        <AutoTextarea
          className="two-lines"
          rows={2}
          style={{ fontFamily: "inherit" }}
          value={direction}
          maxLength={LIMITS.label}
          placeholder="e.g. Jim taking the first bite [close-up]"
          onChange={(e) => change(moment, { direction: e.target.value })}
        />
      </label>

      <div className="row prompt-writer-row">
        <ModelPicker
          label="Model for picture prompts"
          role="cheap"
          use="picture"
          value={model}
          onChange={(ref) => void saveSettings({ ...settings, imagePromptModel: ref })}
        />
        {/* The write button and the eye that shows its prompt stay together on one line. */}
        <span className="row prompt-writer-buttons" style={{ flexWrap: "nowrap", gap: "0.4rem" }}>
          <button
            type="button"
            className="icon-button"
            onClick={() => (busy ? abortRef.current?.abort() : void write())}
            aria-label={busy ? "Stop writing" : written[moment] ? "Write again" : "Write prompt"}
            title={busy ? "Stop writing the prompt" : written[moment] ? "Write the prompt again" : "Write the prompt from the chapter"}
          >
            {busy ? <StopIcon /> : written[moment] ? <RedoIcon /> : <SparkleIcon />}
          </button>
          <PromptButton label="Write prompt" build={() => imagePromptRequest(settings.contextTokens, options())} />
        </span>
      </div>

      <div className="image-prompt-result">
        <div className="prompt-field">
          <div className="field-head">
            <label htmlFor="picture-prompt-text">Prompt</label>
            <button type="button" className="secondary icon-button" aria-label="Copy prompt" title="Copy the prompt" onClick={() => void copy(result.prompt, "Prompt")} disabled={!result.prompt}>
              <CopyIcon />
            </button>
          </div>
          <AutoTextarea
            id="picture-prompt-text"
            aria-label="Prompt"
            style={{ minHeight: "5rem", fontFamily: "inherit" }}
            maxLength={LIMITS.picturePrompt}
            value={result.prompt}
            onChange={(e) => change(moment, { prompt: e.target.value })}
          />
          {story.art_style.trim() && (
            <span className="meta prompt-art-style" title="The story's art style, added to the end of every prompt">
              {story.art_style.trim()}
            </span>
          )}
          {draw.prompt.trim() && (
            <span className="meta prompt-art-style" title="The drawing preset's prompt, added to every prompt">
              Preset: {draw.prompt.trim()}
            </span>
          )}
        </div>
        <label>
          Always include (this chapter)
          <AutoTextarea
            className="two-lines"
            rows={2}
            style={{ fontFamily: "inherit" }}
            value={fixed}
            maxLength={LIMITS.label}
            placeholder="e.g. 1girl, red scarf"
            title="Added to every picture prompt for this chapter. Tags the written prompt already has aren't repeated."
            onChange={(e) => setFixed(e.target.value)}
          />
        </label>
        <div className="prompt-field">
          <div className="field-head">
            <label htmlFor="picture-negative-text">Negative prompt</label>
            <button type="button" className="secondary icon-button" aria-label="Copy negative prompt" title="Copy the negative prompt" onClick={() => void copy(result.negative, "Negative prompt")} disabled={!result.negative}>
              <CopyIcon />
            </button>
          </div>
          <AutoTextarea
            id="picture-negative-text"
            aria-label="Negative prompt"
            style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
            maxLength={LIMITS.picturePrompt}
            value={result.negative}
            onChange={(e) => change(moment, { negative: e.target.value })}
          />
          {draw.negative.trim() && (
            <span className="meta prompt-art-style" title="The drawing preset's negative prompt, added to every negative prompt">
              Preset: {draw.negative.trim()}
            </span>
          )}
        </div>
      </div>
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
      {fixedError && <p className="error" style={{ margin: 0 }}>Couldn&apos;t keep the always-included text: {fixedError}</p>}
      {saveError && <p className="error" style={{ margin: 0 }}>Couldn&apos;t keep the prompt for next time: {saveError}</p>}
    </section>
  );

  // Under the chapter (see IllustrateChapter) it reads as part of what the picture is made from.
  const codexLine = (
    <p className="meta" style={{ margin: 0 }}>
      {used.length ? `Codex entries used: ${used.join(", ")}` : "No codex entries are mentioned in this chapter."}
    </p>
  );

  return (
    <>
      {codexSlot && createPortal(codexLine, codexSlot)}
      {promptPanel}
      <ComfyGenerate
        target={{ storyId: story.id, chapterId }}
        storyPreset={story.draw_preset}
        chapterPreset={chapterPreset}
        onChapterPreset={setPresetNow}
        moment={moment}
        prompt={result.prompt}
        negative={result.negative}
        fixedPrompt={fixed}
        loaded={loaded}
        start={start}
        startMode={startMode}
        onStartMode={onStartMode}
        paint={paint}
        editModels={editModels}
        onPictures={onPictures}
        onQueue={onQueue}
        dock={dock}
        onClearStart={onClearStart}
      />
    </>
  );
}
