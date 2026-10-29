"use client";

import { useEffect, useRef, useState } from "react";
import { saveSettings, useSettings } from "@/lib/settings";
import { LIMITS } from "@/lib/limits";
import { codexBudget, budgetFor, explainCodex, type ContextChapter, type ContextCodexEntry } from "@/lib/ai/prompts";
import { withArtStyle, withoutGiven } from "@/lib/ai/imagePrompt";
import { writeCoverPrompt } from "@/lib/ai/coverPrompt";
import type { CoverDraft } from "@/lib/coverPictures";
import type { CoverSource } from "@/lib/pictureTarget";
import type { StartPicture } from "@/lib/comfy/startPicture";
import { drawPresetFor } from "@/lib/comfy/presets";
import { referenceChoices, restoreReference, type RefPool } from "@/lib/comfy/referenceChoices";
import { useReferences, type RefRequest } from "./useReferences";
import ChapterTreePicker, { type PickerChapter } from "./ChapterTreePicker";
import ModelPicker from "./ModelPicker";
import PromptFields from "./PromptFields";
import ComfyGenerate from "./ComfyGenerate";
import { coverTarget } from "@/lib/pictureTarget";
import { StoryPicturesLine,type IllustratedStory, type LoadedPrompt } from "./ImagePromptPanel";
import type { PendingJob, Picture } from "./pictures";
import type { EditModels } from "./useEditModels";
import { EMPTY_COVER, useCoverDraft } from "./usePictureDraft";

const SOURCE_NAMES: Record<CoverSource, string> = {
  premise: "The summary and codex",
  opening: "The first chapter",
  path: "A path through the story",
};

/** A chapter the path can end at, in the outline's order; `parent_id` is null for the first chapter, `label` the choice that leads here. */
export type CoverChapter = PickerChapter;

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
  /** The saved pictures the References offer (the cover). */
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
 * Writes a prompt for the story's cover from what is chosen (the summary and codex, the first chapter, or a
 * path to a chosen chapter), with the same boxes as a chapter's picture prompt, then makes pictures from
 * it. The boxes and the choice are kept on the server (see `useCoverDraft`).
 */
export default function CoverPromptPanel({
  story, coverPreset, chapters, opening, savedPath, draft = null, pool, refRequest = null, pinned = [], loaded = null, start = null, onClearStart, editModels, onPictures, onQueue, dock = null,
}: Props) {
  const settings = useSettings();
  const [boxes, setBoxes] = useState<CoverDraft>(() => ({
    ...EMPTY_COVER,
    ...draft,
    // Without chapters there is only the summary to write from.
    source: opening ? (draft?.source ?? "premise") : "premise",
  }));
  const change = (patch: Partial<CoverDraft>) => setBoxes((prev) => ({ ...prev, ...patch }));
  // The cover's reference pictures, kept with the boxes.
  const refState = useReferences({ cover: draft?.refs ?? [] }, pool, settings.comfy.url);
  const saveError = useCoverDraft(story.id, { ...boxes, refs: refState.stored("cover") }, draft);
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
    if (loaded.refs) refState.replace("cover", loaded.refs);
    setStatus({ ok: true, text: "Prompt loaded from the picture." });
  }
  // A picture chosen with "Use as reference" joins the References.
  const [seenRef, setSeenRef] = useState(0);
  if (refRequest && refRequest.nonce !== seenRef) {
    setSeenRef(refRequest.nonce);
    refState.add("cover", refRequest.ref);
  }
  const choices = referenceChoices({ pool, chapterId: null, moment: "cover", comfyUrl: settings.comfy.url, pinned, text: `${boxes.prompt}\n${boxes.direction}` });

  // Prompts are written in the style of the model that will draw them: the cover's drawing preset, else the story's.
  const [presetNow, setPresetNow] = useState(coverPreset);
  const draw = drawPresetFor(settings.comfy.drawPresets, presetNow, story.draw_preset);
  const style = draw.promptStyle;
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
            <div className="row" style={{ gap: "0.4rem", minWidth: 0, flex: "1 1 16rem", alignItems: "start" }}>
              <label id="cover-path-end-label" htmlFor="cover-path-end" style={{ paddingTop: "0.45rem" }}>
                ending at
              </label>
              <ChapterTreePicker
                id="cover-path-end"
                labelledBy="cover-path-end-label"
                chapters={chapters}
                value={pathEnd}
                onChange={(id) => change({ path_chapter_id: id })}
              />
            </div>
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
          {busy && (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
        </div>
        <p className="meta" style={{ margin: 0 }}>{used.length ? `Codex entries used: ${used.join(", ")}` : "No codex entries are used."}</p>

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
        target={coverTarget(story.id)}
        storyPreset={story.draw_preset}
        chapterPreset={coverPreset}
        onChapterPreset={setPresetNow}
        moment="cover"
        prompt={boxes.prompt}
        negative={boxes.negative}
        loaded={loaded}
        refs={refState.refsOf("cover")}
        onRefs={(refs) => refState.set("cover", refs)}
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
