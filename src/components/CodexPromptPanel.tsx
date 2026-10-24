"use client";

import { useRef, useState } from "react";
import { saveSettings, useSettings } from "@/lib/settings";
import { LIMITS } from "@/lib/limits";
import type { EntryType } from "@/lib/codex";
import { withArtStyle, withoutGiven } from "@/lib/ai/imagePrompt";
import { codexPromptRequest, writeCodexPrompt } from "@/lib/ai/codexPrompt";
import type { CodexDraft } from "@/lib/codexPictures";
import { codexTarget } from "@/lib/pictureTarget";
import type { StartPicture } from "@/lib/comfy/startPicture";
import { drawPresetFor } from "@/lib/comfy/presets";
import { referenceChoices, restoreReference, type RefPool } from "@/lib/comfy/referenceChoices";
import { useReferences, type RefRequest } from "./useReferences";
import ModelPicker from "./ModelPicker";
import PromptButton from "./PromptButton";
import PromptFields from "./PromptFields";
import ComfyGenerate from "./ComfyGenerate";
import { StoryPicturesLine, type IllustratedStory, type LoadedPrompt } from "./ImagePromptPanel";
import type { PendingJob, Picture } from "./pictures";
import type { EditModels } from "./useEditModels";
import { EMPTY_CODEX, useCodexDraft } from "./usePictureDraft";

/** The codex entry the page is for, as it reads at the chapter the page was opened from. */
export type CodexSubject = { id: string; name: string; type: EntryType; aliases: string[]; content: string };

type Props = {
  story: IllustratedStory;
  entry: CodexSubject;
  /** The title of the chapter the entry's text is as of, or null when the page wasn't opened from a chapter. */
  asOf: string | null;
  /** The entry's own drawing preset (chosen on this page), or null to use the story's. */
  entryPreset: string | null;
  /** The boxes as last left, to start from. */
  draft: CodexDraft | null;
  /** The saved pictures the References offer (the cover, and the codex entries' pictures as of the chapter). */
  pool: RefPool;
  /** A picture chosen with "Use as reference" in a picture's menu, to add to the References. */
  refRequest?: RefRequest | null;
  /** The pinned pictures, which the reference picker offers. */
  pinned?: Picture[];
  loaded?: LoadedPrompt | null;
  start?: StartPicture | null;
  onClearStart?: () => void;
  editModels?: EditModels;
  onPictures?: (pictures: Picture[]) => void;
  onQueue?: (jobs: PendingJob[]) => void;
  dock?: HTMLElement | null;
};

/**
 * Writes a prompt for a codex entry's picture from the entry's text as of a chapter (one clear picture of the
 * character, item or place), with the same boxes as the chapter and cover prompts, then makes pictures from
 * it. The boxes are kept on the server (see `useCodexDraft`).
 */
export default function CodexPromptPanel({
  story, entry, asOf, entryPreset, draft = null, pool, refRequest = null, pinned = [], loaded = null, start = null, onClearStart, editModels, onPictures, onQueue, dock = null,
}: Props) {
  const settings = useSettings();
  const [boxes, setBoxes] = useState<CodexDraft>(() => ({ ...EMPTY_CODEX, ...draft }));
  const change = (patch: Partial<CodexDraft>) => setBoxes((prev) => ({ ...prev, ...patch }));
  // The entry's reference pictures, kept with the boxes.
  const refState = useReferences({ codex: draft?.refs ?? [] }, pool, settings.comfy.url);
  const saveError = useCodexDraft(story.id, entry.id, { ...boxes, refs: refState.stored("codex") }, draft);
  const [written, setWritten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A prompt loaded from a picture replaces the boxes once per request.
  const [seenLoad, setSeenLoad] = useState(0);
  if (loaded && loaded.nonce !== seenLoad) {
    setSeenLoad(loaded.nonce);
    change({ scene: "", prompt: loaded.prompt, negative: loaded.negative });
    if (loaded.refs) refState.replace("codex", loaded.refs);
    setStatus({ ok: true, text: "Prompt loaded from the picture." });
  }
  // A picture chosen with "Use as reference" joins the References.
  const [seenRef, setSeenRef] = useState(0);
  if (refRequest && refRequest.nonce !== seenRef) {
    setSeenRef(refRequest.nonce);
    refState.add("codex", refRequest.ref);
  }
  const choices = referenceChoices({ pool, chapterId: null, moment: "codex", comfyUrl: settings.comfy.url, pinned, text: `${boxes.prompt}\n${boxes.direction}` });

  // Prompts are written in the style of the model that will draw them: the entry's drawing preset, else the story's.
  const [presetNow, setPresetNow] = useState(entryPreset);
  const draw = drawPresetFor(settings.comfy.drawPresets, presetNow, story.draw_preset);
  const style = draw.promptStyle;
  const model = settings.imagePromptModel;
  const options = () => ({ story, entry, direction: boxes.direction, style });

  async function write() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setStatus(null);
    try {
      const p = await writeCodexPrompt(settings, { ...options(), model, signal: ctl.signal });
      change({ scene: p.scene, prompt: withArtStyle(withoutGiven(p.prompt, [draw.prompt], style), story.art_style, style), negative: withoutGiven(p.negative, [draw.negative], style) });
      setWritten(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="ai-panel image-prompt" id="picture-prompt">
        <h2>Codex picture prompt</h2>
        <StoryPicturesLine story={story} />
        <p className="meta" style={{ margin: 0 }}>
          {entry.name} ({entry.type}), {asOf ? <>as written at “{asOf}”.</> : "as last written."} The prompt asks for one clear {entry.type === "character" ? "full-body picture" : entry.type === "place" ? "establishing picture" : "picture"} of it.
        </p>

        <label>
          What to show (optional)
          <input
            type="text"
            value={boxes.direction}
            maxLength={LIMITS.label}
            placeholder="e.g. in her winter coat [arms crossed]"
            onChange={(e) => change({ direction: e.target.value })}
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
            {busy ? "Writing…" : written ? "Write again" : "Write prompt"}
          </button>
          <PromptButton label="Write prompt" build={() => codexPromptRequest(options())} />
          {busy && (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
        </div>

        <PromptFields
          prompt={boxes.prompt}
          negative={boxes.negative}
          onPrompt={(prompt) => change({ prompt })}
          onNegative={(negative) => change({ negative })}
          presetPrompt={draw.prompt}
          presetNegative={draw.negative}
          status={status}
          onStatus={setStatus}
          saveError={saveError}
        />
      </section>
      <ComfyGenerate
        target={codexTarget(story.id, entry.id)}
        storyPreset={story.draw_preset}
        chapterPreset={entryPreset}
        onChapterPreset={setPresetNow}
        moment="codex"
        prompt={boxes.prompt}
        negative={boxes.negative}
        loaded={loaded}
        refs={refState.refsOf("codex")}
        onRefs={(refs) => refState.set("codex", refs)}
        refChoices={choices}
        styleRef={story.style_ref ? restoreReference(story.style_ref, { pool, comfyUrl: settings.comfy.url }) : null}
        start={start}
        editModels={editModels}
        onPictures={onPictures}
        onQueue={onQueue}
        dock={dock}
        onClearStart={onClearStart}
      />
    </>
  );
}
