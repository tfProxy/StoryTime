"use client";

import { useEffect, useRef, useState } from "react";
import { saveSettings, useSettings } from "@/lib/settings";
import { LIMITS } from "@/lib/limits";
import { copyText } from "@/lib/copyText";
import { codexBudget, budgetFor, explainCodex, type ContextChapter, type ContextCodexEntry } from "@/lib/ai/prompts";
import { withArtStyle } from "@/lib/ai/imagePrompt";
import { coverPromptRequest, writeCoverPrompt } from "@/lib/ai/coverPrompt";
import type { CoverDraft } from "@/lib/coverPictures";
import type { CoverSource } from "@/lib/pictureTarget";
import type { StartPicture } from "@/lib/comfy/startPicture";
import { drawPresetFor } from "@/lib/comfy/presets";
import AutoTextarea from "./AutoTextarea";
import ModelPicker from "./ModelPicker";
import PromptButton from "./PromptButton";
import ComfyGenerate, { type PaintProps } from "./ComfyGenerate";
import { CopyIcon } from "./PictureIcons";
import { StoryPicturesLine, type IllustratedStory, type LoadedPrompt } from "./ImagePromptPanel";
import type { PendingJob, Picture, StartMode } from "./pictures";
import type { EditModels } from "./useEditModels";
import { EMPTY_COVER, useCoverDraft } from "./usePictureDraft";

const SOURCE_NAMES: Record<CoverSource, string> = {
  premise: "The summary and codex",
  opening: "The first chapter",
  path: "A path through the story",
};

/** A chapter the path can end at, in the outline's order; `depth` 0 is the first chapter. */
export type CoverChapter = { id: string; title: string; depth: number };

/** What the prompt can be written from: chapters from the first one on, and the codex at the last of them. */
export type CoverContext = { path: ContextChapter[]; codex: ContextCodexEntry[] };

/** The path from the first chapter to this one, and the codex there, from the server. */
async function fetchContext(chapterId: string): Promise<CoverContext> {
  const [chapter, codex] = await Promise.all([fetch(`/api/chapters/${chapterId}`), fetch(`/api/chapters/${chapterId}/codex`)]);
  if (!chapter.ok || !codex.ok) throw new Error(`Couldn't load that path (${chapter.ok ? codex.status : chapter.status}).`);
  const { path } = (await chapter.json()) as { path: ContextChapter[] };
  const { entries } = (await codex.json()) as { entries: (Omit<ContextCodexEntry, "id"> & { entry_id: string })[] };
  return {
    path: path.map(({ title, body, summary, path_summary }) => ({ title, body, summary, path_summary })),
    codex: entries.map((e) => ({ id: e.entry_id, name: e.name, type: e.type, aliases: e.aliases, content: e.content, always_include: e.always_include })),
  };
}

type Props = {
  story: IllustratedStory;
  /** The cover's own drawing preset (chosen on this page), or null to use the story's. */
  coverPreset: string | null;
  /** The story's chapters in the outline's order, for choosing where a path ends. */
  chapters: CoverChapter[];
  /** The first chapter and the codex there, or null when the story has no chapters yet. */
  opening: CoverContext | null;
  /** The path the saved boxes chose, when they chose one that still exists. */
  savedPath: CoverContext | null;
  /** The boxes as last left, to start from. */
  draft: CoverDraft | null;
  loaded?: LoadedPrompt | null;
  start?: StartPicture | null;
  onClearStart?: () => void;
  startMode?: StartMode;
  onStartMode?: (mode: StartMode) => void;
  paint?: PaintProps;
  editModels?: EditModels;
  onPictures?: (pictures: Picture[]) => void;
  onQueue?: (jobs: PendingJob[]) => void;
  dock?: HTMLElement | null;
};

/**
 * Writes a prompt for the story's cover from what is chosen (the summary and codex, the first chapter, or a
 * path to a chosen chapter), with the same boxes as a chapter's picture prompt, then makes pictures from
 * it. The boxes and the choice are kept on the server (see `useCoverDraft`).
 */
export default function CoverPromptPanel({
  story, coverPreset, chapters, opening, savedPath, draft = null, loaded = null, start = null, onClearStart, startMode, onStartMode, paint, editModels, onPictures, onQueue, dock = null,
}: Props) {
  const settings = useSettings();
  const [boxes, setBoxes] = useState<CoverDraft>(() => ({
    ...EMPTY_COVER,
    ...draft,
    // Without chapters there is only the summary to write from.
    source: opening ? (draft?.source ?? "premise") : "premise",
  }));
  const change = (patch: Partial<CoverDraft>) => setBoxes((prev) => ({ ...prev, ...patch }));
  const saveError = useCoverDraft(story.id, boxes, draft);
  const [written, setWritten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The path chosen, loaded when another chapter is chosen; the saved one is known as the page opens.
  const [paths, setPaths] = useState<Record<string, CoverContext>>(() => (draft?.path_chapter_id && savedPath ? { [draft.path_chapter_id]: savedPath } : {}));
  const pathEnd = boxes.path_chapter_id ?? chapters.at(-1)?.id ?? null;
  const pathContext = pathEnd ? (paths[pathEnd] ?? null) : null;
  useEffect(() => {
    if (boxes.source !== "path" || !pathEnd || paths[pathEnd]) return;
    let live = true;
    fetchContext(pathEnd).then(
      (c) => live && setPaths((prev) => ({ ...prev, [pathEnd]: c })),
      (e) => live && setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [boxes.source, pathEnd, paths]);

  // A prompt loaded from a picture replaces the boxes once per request.
  const [seenLoad, setSeenLoad] = useState(0);
  if (loaded && loaded.nonce !== seenLoad) {
    setSeenLoad(loaded.nonce);
    change({ scene: "", prompt: loaded.prompt, negative: loaded.negative });
    setStatus({ ok: true, text: "Prompt loaded from the picture." });
  }

  // Prompts are written in the style of the model that will draw them: the cover's drawing preset, else the story's.
  const [presetNow, setPresetNow] = useState(coverPreset);
  const style = drawPresetFor(settings.comfy.drawPresets, presetNow, story.draw_preset).promptStyle;
  const model = settings.imagePromptModel;
  const context = boxes.source === "path" ? pathContext : opening;
  const options = () => ({
    story,
    source: boxes.source,
    path: boxes.source === "premise" ? [] : (context?.path ?? []),
    codex: context?.codex ?? opening?.codex ?? [],
    direction: boxes.direction,
    style,
  });
  const triggerText = [story.premise, ...options().path.map((c) => c.body), boxes.direction].join("\n");
  const used = explainCodex(options().codex, triggerText, codexBudget(budgetFor(settings.contextTokens)))
    .filter((r) => r.state === "included")
    .map((r) => r.entry.name);
  const loading = boxes.source === "path" && !pathContext;

  async function write() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setStatus(null);
    try {
      const p = await writeCoverPrompt(settings, { ...options(), model, signal: ctl.signal });
      change({ scene: p.scene, prompt: withArtStyle(p.prompt, story.art_style, style), negative: p.negative });
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
    <>
      <section className="ai-panel image-prompt" id="picture-prompt">
        <h2>Cover prompt</h2>
        <StoryPicturesLine story={story} />

        <div className="row" style={{ flexWrap: "wrap" }}>
          <label className="row" style={{ gap: "0.4rem" }}>
            Write from
            <select
              aria-label="Write the cover from"
              title="The story branches, so say what the cover is written from"
              value={boxes.source}
              onChange={(e) => change({ source: e.target.value as CoverSource })}
              style={{ width: "auto" }}
            >
              {(Object.keys(SOURCE_NAMES) as CoverSource[]).map((s) => (
                <option key={s} value={s} disabled={s !== "premise" && !opening}>
                  {SOURCE_NAMES[s]}
                </option>
              ))}
            </select>
          </label>
          {boxes.source === "path" && (
            <label className="row" style={{ gap: "0.4rem", minWidth: 0 }}>
              ending at
              <select
                aria-label="Path ends at"
                value={pathEnd ?? ""}
                onChange={(e) => change({ path_chapter_id: e.target.value })}
                style={{ width: "auto", minWidth: 0, maxWidth: "100%" }}
              >
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${"– ".repeat(c.depth)}${c.title}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!opening && <p className="meta" style={{ margin: 0 }}>The story has no chapters yet, so the cover is written from its summary.</p>}

        <label>
          What to show (optional)
          <input
            type="text"
            value={boxes.direction}
            maxLength={LIMITS.label}
            placeholder="e.g. the lighthouse keeper at the window [dusk]"
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
          <button type="button" onClick={() => void write()} disabled={busy || loading}>
            {busy ? "Writing…" : loading ? "Loading the path…" : written ? "Write again" : "Write prompt"}
          </button>
          <PromptButton label="Write prompt" build={() => coverPromptRequest(settings.contextTokens, options())} disabled={loading} />
          {busy && (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
        </div>
        <p className="meta" style={{ margin: 0 }}>{used.length ? `Codex entries used: ${used.join(", ")}` : "No codex entries are used."}</p>

        <div className="image-prompt-result">
          <div className="prompt-field">
            <div className="field-head">
              <label htmlFor="picture-prompt-text">Prompt</label>
              <button type="button" className="secondary icon-button" aria-label="Copy prompt" title="Copy the prompt" onClick={() => void copy(boxes.prompt, "Prompt")} disabled={!boxes.prompt}>
                <CopyIcon />
              </button>
            </div>
            <AutoTextarea
              id="picture-prompt-text"
              aria-label="Prompt"
              style={{ minHeight: "5rem", fontFamily: "inherit" }}
              maxLength={LIMITS.picturePrompt}
              value={boxes.prompt}
              onChange={(e) => change({ prompt: e.target.value })}
            />
          </div>
          <div className="prompt-field">
            <div className="field-head">
              <label htmlFor="picture-negative-text">Negative prompt</label>
              <button type="button" className="secondary icon-button" aria-label="Copy negative prompt" title="Copy the negative prompt" onClick={() => void copy(boxes.negative, "Negative prompt")} disabled={!boxes.negative}>
                <CopyIcon />
              </button>
            </div>
            <AutoTextarea
              id="picture-negative-text"
              aria-label="Negative prompt"
              style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
              maxLength={LIMITS.picturePrompt}
              value={boxes.negative}
              onChange={(e) => change({ negative: e.target.value })}
            />
          </div>
        </div>
        {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
        {saveError && <p className="error" style={{ margin: 0 }}>Couldn&apos;t keep the prompt for next time: {saveError}</p>}
      </section>
      <ComfyGenerate
        target={{ storyId: story.id, chapterId: null }}
        storyPreset={story.draw_preset}
        chapterPreset={coverPreset}
        onChapterPreset={setPresetNow}
        moment="cover"
        prompt={boxes.prompt}
        negative={boxes.negative}
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
