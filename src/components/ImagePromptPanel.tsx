"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { saveSettings, useSettings } from "@/lib/settings";
import { LIMITS } from "@/lib/limits";
import { copyText } from "@/lib/copyText";
import { codexBudget, budgetFor, explainCodex, type ContextChapter, type ContextCodexEntry } from "@/lib/ai/prompts";
import { imagePromptRequest, withArtStyle, writeImagePrompt, type ImageMoment } from "@/lib/ai/imagePrompt";
import AutoTextarea from "./AutoTextarea";
import ModelPicker from "./ModelPicker";
import PromptButton from "./PromptButton";
import ComfyGenerate from "./ComfyGenerate";
import { CopyIcon } from "./PictureIcons";
import type { StartPicture } from "@/lib/comfy/startPicture";
import type { PendingJob, Picture, PromptToLoad, StartMode } from "./pictures";
import type { EditModels } from "./useEditModels";
import type { PictureBoxes, PictureDraft } from "@/lib/pictureDrafts";
import { EMPTY_BOXES, usePictureDraft } from "./usePictureDraft";
import { PROMPT_STYLE_NAMES, unsetPictureSettings, type StoryPictures } from "./StoryPictureSettings";
import { drawPresetFor, presetName } from "@/lib/comfy/presets";

const MOMENT_NAMES: Record<ImageMoment, string> = { start: "Chapter start", end: "Chapter end" };

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** The story fields the picture prompt uses: its premise, and its picture settings (see StoryPictureSettings). */
export type IllustratedStory = { id: string; title: string; premise: string } & StoryPictures;

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
  /** Where Size, Queue and the queue's status go, to stay in view at the bottom of the column. */
  dock?: HTMLElement | null;
  /** Where the "Codex entries used" line goes: the bottom of the chapter panel. */
  codexSlot?: HTMLElement | null;
  /** ComfyUI's ids of the chapter's jobs already in the log, so the pictures found in ComfyUI that aren't there yet can be recorded. */
  recorded?: string[];
};

/**
 * Writes a prompt for an image generator from the chapter and the codex entries it mentions. Each moment
 * (chapter start, chapter end) has its own boxes, so switching between them brings each one's prompt back;
 * they are kept for the chapter on the server, so they are there again next time.
 */
export default function ImagePromptPanel({ chapterId, story, chapterPreset = null, path, codex, loaded = null, start = null, onClearStart, startMode = "redraw", onStartMode, editModels, onPictures, onQueue, draft = null, dock = null, codexSlot = null, recorded }: Props) {
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
    const into = loaded.moment ?? moment;
    change(into, { scene: "", prompt: loaded.prompt, negative: loaded.negative });
    setMoment(into);
    setStatus({ ok: true, text: "Prompt loaded from the picture." });
  }
  // Tags until the story's prompt style is chosen.
  const style = story.image_prompt_style ?? "tags";
  const model = settings.imagePromptModel;
  const unset = unsetPictureSettings(story);
  const settingsHref = `/s/${story.id}/details#pictures`;

  const options = () => ({ story, path, codex, moment, direction, style });
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
      change(forMoment, { scene: p.scene, prompt: withArtStyle(p.prompt, story.art_style, style), negative: p.negative });
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
      {/* The story's picture settings, the same for all its chapters, are set on its details page. */}
      <div className="story-pictures">
        <div className="story-pictures-row">
          <ul className="story-pictures-list" aria-label="This story's picture settings">
            <li>{story.image_prompt_style ? PROMPT_STYLE_NAMES[story.image_prompt_style] : "no prompt style"}</li>
            <li>{story.art_style.trim() ? <span title={story.art_style}>{short(story.art_style.trim(), 80)}</span> : "no art style"}</li>
            <li title="The story's drawing preset">{presetName(drawPresetFor(settings.comfy.drawPresets, story.draw_preset))}</li>
          </ul>
          <Link href={settingsHref}>Change</Link>
        </div>
        {unset.length > 0 && (
          <p className="notice" style={{ margin: 0 }}>
            Not chosen yet for this story: {unset.join(", ")}.{" "}
            {!story.image_prompt_style && "Prompts are written as tags until a prompt style is chosen. "}
            <Link href={settingsHref}>Choose them in Story details</Link>
          </p>
        )}
      </div>

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

      <div className="row" style={{ flexWrap: "wrap" }}>
        <ModelPicker
          label="Model for picture prompts"
          role="cheap"
          use="picture"
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
        </div>
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
        </div>
      </div>
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
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
        chapterId={chapterId}
        storyId={story.id}
        storyPreset={story.draw_preset}
        chapterPreset={chapterPreset}
        moment={moment}
        prompt={result.prompt}
        negative={result.negative}
        loaded={loaded}
        start={start}
        startMode={startMode}
        onStartMode={onStartMode}
        editModels={editModels}
        onPictures={onPictures}
        onQueue={onQueue}
        dock={dock}
        recorded={recorded}
        onClearStart={onClearStart}
      />
    </>
  );
}
