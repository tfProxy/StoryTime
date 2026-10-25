"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LIMITS } from "@/lib/limits";
import { defaultRef, modelLabel, usableRef, useSettings, type ModelRef } from "@/lib/settings";
import { completeChat, streamChat } from "@/lib/ai/client";
import { ensurePathSummaries, neededSummaryIndex, summarizeChapter, summaryRequest, type Summaries } from "@/lib/ai/summaries";
import {
  choicesPrompt,
  choiceLabelPrompt,
  ideasPrompt,
  parseIdeas,
  SYSTEM_IDEAS,
  type Idea,
  generatePrompt,
  LENGTH_WORDS,
  parseChapterOutput,
  parseChoiceLabel,
  parseChoices,
  passageRefinePrompt,
  refinePrompt,
  SYSTEM_CHAPTER,
  SYSTEM_CHOICE_LABEL,
  SYSTEM_CHOICES,
  SYSTEM_PASSAGE,
  type CodexOverrides,
  type Length,
  type PromptParts,
  type StoryContext,
} from "@/lib/ai/prompts";
import type { PathChapter } from "@/lib/ai/codexAi";
import { draftOps, foldCodex, isDraftEntry, type CodexOp } from "@/lib/codex";
import { deleteDraft, DraftConflict, emptyDraft, getDraft, saveDraft, type Draft } from "@/lib/drafts";
import { applyAfterGenerate, applyGenerated, isBegun, pushUndo, startVersion } from "@/lib/generatedDraft";
import { useWorkQueue, type GenerateItem } from "./WorkQueue";
import Prose from "./Prose";
import AutoTextarea from "./AutoTextarea";
import CodexPanel from "./CodexPanel";
import { PageMenu } from "./SiteMenu";
import CodexPreview from "./CodexPreview";
import PromptButton from "./PromptButton";
import ModelPicker from "./ModelPicker";

export type Target =
  /** The first chapter of a story that has none yet. */
  | { kind: "first"; storyId: string }
  | { kind: "fill"; choiceId: string; label: string; parentChapterId: string }
  | { kind: "new"; parentChapterId: string }
  | {
      kind: "edit";
      chapterId: string;
      baseRevision: number;
      /** How many chapters continue from this one. */
      descendantCount: number;
      initialTitle: string;
      initialBody: string;
      /** The chapter's current summaries; kept on save unless the author changes the summary. */
      initialSummary: string | null;
      initialPathSummary: string | null;
      existingChoices: { id: string; label: string; hasChild: boolean }[];
      /** Text of the choice leading here, or null for a story's first chapter. */
      incomingLabel: string | null;
    };

type Props = {
  target: Target;
  context: StoryContext;
  /** The story being written in. Links to its details page. */
  storyId?: string;
  draftKey: string;
  resumeHref: string;
  draftLabel: string;
  /** Start generating as soon as the (empty) draft loads. */
  autoGenerate?: boolean;
  /** The codex as of the chapter being continued; absent when there is no earlier chapter to anchor it to. */
  codexPanel?: { chapterId: string; path: PathChapter[]; ops: CodexOp[] };
};

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** One line of text, cut to fit a folded section's heading. */
function snippet(text: string, max = 70) {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Mounts once and runs `run`; used to kick off generation after the draft has loaded.
function AutoStart({ run }: { run: () => void }) {
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Ideas and suggestions cost an AI call, and a half-typed instruction is work too.
const hasWorkingState = (d: Draft) =>
  !!(d.ideaPages?.length || d.suggestions?.length || d.instruction?.trim() || d.guidance?.trim());

// Don't litter the drafts list with untouched forms.
function isBlank(d: Draft, target: Target): boolean {
  if (hasWorkingState(d)) return false;
  if (target.kind === "edit") {
    return (
      d.title === target.initialTitle &&
      d.body === target.initialBody &&
      !d.prompt &&
      !d.editNote &&
      (d.summary ?? "") === (target.initialSummary ?? "") &&
      !d.choices.some((c) => c.trim()) &&
      !d.codexChanges?.length &&
      Object.keys(d.choiceEdits ?? {}).length === 0 &&
      (d.incomingLabel ?? target.incomingLabel) === target.incomingLabel
    );
  }
  return !(
    d.storyTitle ||
    d.premise ||
    d.style?.trim() ||
    (d.newChoiceLabel && !(target.kind === "fill" && d.newChoiceLabel === target.label)) ||
    d.title ||
    d.body ||
    d.prompt ||
    d.summary ||
    d.codexChanges?.length ||
    d.choices.some((c) => c.trim())
  );
}

export default function ChapterEditor({ target, context, storyId, draftKey, resumeHref, draftLabel, autoGenerate, codexPanel }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [localBusy, setBusy] = useState<null | "generate" | "refine" | "choices" | "ideas" | "summary" | "label" | "post">(null);
  // A Generate lives in the work queue (so it goes on if the author leaves the page): the page is busy while that item is.
  const { items: queued, generate, stopGenerate, listenDraft } = useWorkQueue();
  const generating = queued.find((i): i is GenerateItem => i.type === "generate" && i.draftKey === draftKey && (i.state === "waiting" || i.state === "working"));
  const busy = localBusy ?? (generating ? "generate" : null);
  // The idea being turned into a choice on the previous chapter ("page:index"), with the text being edited.
  const [promoting, setPromoting] = useState<{ key: string; text: string } | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The last action started, so its error shows in the section it came from.
  const [lastAction, setLastAction] = useState<typeof busy>(null);
  // Story summaries generated during this session, by chapter id (also saved to the server).
  const [madeSummaries, setMadeSummaries] = useState<Record<string, Summaries>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [autoDone, setAutoDone] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  // What the codex drawer opens on: an entry id, "new", or the list. `n` remounts it on each open.
  const [codexStart, setCodexStart] = useState<{ editing: string | null; n: number }>({ editing: null, n: 0 });
  // Brainstorm is open until there is a chapter, then folds away; null until the author toggles it.
  const [brainstormPref, setBrainstormPref] = useState<boolean | null>(null);
  // After the AI writes, keep showing the read-only text until the user chooses to edit it.
  const [reading, setReading] = useState(false);
  // The part of the chapter text selected in the editor; "Revise" then changes only that.
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  // When the draft was last saved, or that it couldn't be.
  const [saved, setSaved] = useState<{ at: number } | { failed: true } | null>(null);
  // A save was refused because the draft was saved from another tab or browser first.
  const [conflict, setConflict] = useState<{ current: Draft | null } | null>(null);
  // Saving changed text asks whether to keep the chapter's summary or write a new one.
  const [askSummary, setAskSummary] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);
  // The server's `updatedAt` for the version this page has; each save says it builds on it.
  const baseRef = useRef(0);
  // Saves run one after another, so each builds on the one before.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  // Changes not yet saved (waiting for the debounce, or being sent).
  const unsavedRef = useRef(0);
  // Set when the draft is replaced by the stored one, which needn't be saved back.
  const skipSaveRef = useRef(false);
  const conflictRef = useRef(false);
  const busyRef = useRef(false);

  /** Shows a draft as stored on the server. */
  function showStored(d: Draft) {
    baseRef.current = d.updatedAt;
    skipSaveRef.current = true;
    setSelection(null);
    setDraft(upgraded(d));
  }

  // An edit draft saved before summaries were carried into it has no summary field: start it from the chapter's.
  function upgraded(d: Draft): Draft {
    if (target.kind === "fill" && !d.newChoiceLabel) return { ...d, newChoiceLabel: target.label };
    return target.kind === "edit" && d.summary === undefined && target.initialSummary ? { ...d, summary: target.initialSummary } : d;
  }

  // Load any saved draft for this spot.
  useEffect(() => {
    let cancelled = false;
    const fresh = (): Draft => {
      const d = emptyDraft(draftKey, resumeHref, draftLabel);
      // Filling in an existing choice starts with its text in the choice box; changing it makes a new choice instead.
      if (target.kind === "fill") return { ...d, newChoiceLabel: target.label };
      if (target.kind !== "edit") return d;
      return {
        ...d,
        title: target.initialTitle,
        body: target.initialBody,
        summary: target.initialSummary ?? "",
        choices: [],
        baseRevision: target.baseRevision,
        incomingLabel: target.incomingLabel ?? undefined,
        choiceEdits: {},
      };
    };
    getDraft(draftKey)
      .then((d) => {
        if (cancelled) return;
        loadedRef.current = true;
        if (d) showStored(d);
        else setDraft(fresh());
      })
      .catch(() => {
        if (cancelled) return;
        // Carry on with a fresh form; if a stored draft does exist, the first save says so.
        loadedRef.current = true;
        setDraft(fresh());
      });
    return () => {
      cancelled = true;
    };
    // `target` is rebuilt by the server page on each navigation; the draft key identifies the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, resumeHref, draftLabel]);

  async function save(d: Draft) {
    if (!loadedRef.current || conflictRef.current) return;
    try {
      baseRef.current = await saveDraft(d, baseRef.current);
      setSaved({ at: baseRef.current });
    } catch (e) {
      if (e instanceof DraftConflict) {
        conflictRef.current = true;
        setConflict({ current: e.current });
      } else {
        setSaved({ failed: true });
      }
    }
  }

  function queueSave(d: Draft) {
    unsavedRef.current++;
    saveChainRef.current = saveChainRef.current.then(() => save(d)).finally(() => {
      unsavedRef.current--;
    });
  }

  // Autosave (debounced) to the server.
  useEffect(() => {
    if (!draft || !loadedRef.current) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (conflict || isBlank(draft, target)) return;
    let fired = false;
    const unsaved = unsavedRef;
    unsaved.current++;
    const t = setTimeout(() => {
      fired = true;
      unsaved.current--;
      queueSave(draft);
    }, 500);
    return () => {
      clearTimeout(t);
      if (!fired) unsaved.current--;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, conflict]);

  useEffect(() => {
    busyRef.current = busy !== null;
  }, [busy]);

  // Coming back to this tab after writing somewhere else: show the newer draft, if nothing here is unsaved.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible" || !loadedRef.current) return;
      if (busyRef.current || unsavedRef.current > 0 || conflictRef.current) return;
      getDraft(draftKey)
        .then((d) => {
          if (d && d.updatedAt > baseRef.current && unsavedRef.current === 0 && !busyRef.current && loadedRef.current) showStored(d);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Leaving or reloading while the AI is working would cut it off, and unsaved changes would be lost; ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (busyRef.current || unsavedRef.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // A Generate in the queue puts its text into this draft as it comes (the queue saves it itself when no page is open).
  const draftReady = draft !== null;
  useEffect(() => {
    if (!draftReady) return;
    return listenDraft(draftKey, {
      onText: (text, base) => {
        setReading(true);
        setDraft((d) => (d ? applyGenerated(d, parseChapterOutput(text), { continued: isBegun(d, base) }) : d));
      },
      onDone: (after) => setDraft((d) => (d ? applyAfterGenerate(d, after) : d)),
      onError: (message) => setError(message),
    });
  }, [draftKey, draftReady, listenDraft]);

  if (!draft) return <p className="meta">Loading draft…</p>;

  // Working state kept in the draft, so it survives a reload.
  const length: Length = draft.length ?? "medium";
  const instruction = draft.instruction ?? "";
  const suggestions = draft.suggestions ?? [];
  // Guidance for "Suggest more"; null until edited, so it follows the choice text by default.
  const guidance = draft.guidance ?? null;
  // Each "Suggest" adds a page of ideas; earlier pages stay so the author can go back to them.
  const ideaPages: Idea[][] = draft.ideaPages ?? [];
  const ideaPage = Math.min(draft.ideaPage ?? 0, Math.max(0, ideaPages.length - 1));
  // Models picked for this draft; null means the default from Settings (also when the picked one's connection is gone).
  const writeModel = usableRef(settings, draft.models?.write);
  const suggestModel = usableRef(settings, draft.models?.suggest);
  const modelName = (ref: ModelRef | null, role: "main" | "cheap") => {
    const r = ref ?? defaultRef(settings, role);
    return r ? modelLabel(settings, r) : "no model (pick one in Settings)";
  };
  const suggestNote = `Sent to ${modelName(suggestModel, "cheap")}.`;
  const setModel = (job: "write" | "suggest", ref: ModelRef | null) =>
    setDraft((d) => (d ? { ...d, models: { ...d.models, [job]: ref ?? undefined } } : d));
  const writePicker = (
    <ModelPicker label="Model for writing" role="main" use="write" value={writeModel} onChange={(r) => setModel("write", r)} />
  );
  const suggestPicker = (
    <ModelPicker label="Model for suggestions" role="cheap" use="suggest" value={suggestModel} onChange={(r) => setModel("suggest", r)} />
  );
  // Ideas already added as choices, by the text they were added with.
  const promoted = draft.promoted ?? {};
  // Manual additions to / removals from the codex entries sent with each prompt.
  const codexOverrides: CodexOverrides = draft.codexOverrides ?? { include: [], exclude: [] };

  const withSummaries = (path: StoryContext["path"], made: Record<string, Summaries>) =>
    path.map((c) => (c.id && made[c.id] ? { ...c, summary: made[c.id].summary, path_summary: made[c.id].path_summary } : c));
  const storyInfo = { title: context.storyTitle, premise: context.premise };
  // Codex changes held in this draft apply to the chapter being written.
  const codexChanges = draft.codexChanges ?? [];
  const codex =
    codexPanel && codexChanges.length > 0
      ? foldCodex([...codexPanel.ops, ...draftOps(codexChanges, (codexPanel.path.at(-1)?.depth ?? -1) + 1)]).map((e) => ({
          id: e.entry_id,
          name: e.name,
          type: e.type,
          aliases: e.aliases,
          content: e.content,
          always_include: e.always_include,
        }))
      : context.codex;
  // The story's style notes are edited on its details page.
  const style = context.style ?? "";
  const ctx: StoryContext = {
    ...context,
    codex,
    storyTitle: storyInfo.title,
    premise: storyInfo.premise,
    style,
    path: withSummaries(context.path, madeSummaries),
    // The choice text being typed here (a new branch, or a renamed one) is what the reader will have picked.
    choiceLabel:
      target.kind === "new" || target.kind === "fill"
        ? draft.newChoiceLabel.trim() || null
        : target.kind === "edit" && target.incomingLabel !== null
          ? (draft.incomingLabel ?? "").trim() || target.incomingLabel
          : context.choiceLabel,
    codexOverrides,
  };
  const guidanceText = guidance ?? ctx.choiceLabel ?? "";

  /**
   * Makes sure the story so far can be condensed before a prompt is built: if older chapters
   * will be left out, their rolling summary has to exist. Failure is not fatal (the prompt
   * falls back to short excerpts), so this reports a note and carries on.
   */
  async function prepareContext(signal: AbortSignal): Promise<StoryContext> {
    const upTo = neededSummaryIndex(ctx.path, settings.contextTokens);
    if (upTo < 0) return ctx;
    try {
      const made = await ensurePathSummaries(settings, ctx.path, upTo, {
        story: storyInfo,
        signal,
        onProgress: (done, total) => setStatus(`Summarizing the story so far (${Math.min(done + 1, total)} of ${total})…`),
      });
      const all = { ...madeSummaries, ...made };
      setMadeSummaries(all);
      return { ...ctx, path: withSummaries(context.path, all) };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      setError(`Couldn't summarize the earlier chapters (${e instanceof Error ? e.message : String(e)}). Using short excerpts instead.`);
      return ctx;
    } finally {
      setStatus(null);
    }
  }

  function startBusy(kind: NonNullable<typeof busy>) {
    setBusy(kind);
    setLastAction(kind);
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function showVersion(j: number) {
    setDraft((d) => {
      if (!d?.versions?.[j]) return d;
      const versions = [...d.versions];
      versions[d.versionIndex ?? versions.length - 1] = { title: d.title, body: d.body };
      return { ...d, versions, versionIndex: j, title: versions[j].title, body: versions[j].body };
    });
  }

  /** The selected passage, unless the text has changed since it was selected. */
  function currentSelection(body: string) {
    return selection && selection.text.trim() && body.slice(selection.start, selection.end) === selection.text ? selection : null;
  }

  /** What "Generate" or "Revise" sends; with a passage selected, "Revise" rewrites just that. */
  function chapterRequest(kind: "generate" | "refine", from: StoryContext, picked: ReturnType<typeof currentSelection>): PromptParts {
    if (picked) {
      const body = draft!.body;
      const parts = { title: draft!.title, before: body.slice(0, picked.start), passage: body.slice(picked.start, picked.end), after: body.slice(picked.end) };
      return { system: SYSTEM_PASSAGE, message: passageRefinePrompt(from, parts, instruction, settings.contextTokens) };
    }
    return {
      system: SYSTEM_CHAPTER,
      message:
        kind === "generate"
          ? generatePrompt(from, draft!.prompt, length, settings.contextTokens)
          : refinePrompt(from, { title: draft!.title, body: draft!.body }, instruction, settings.contextTokens),
    };
  }

  /** Generate goes to the work queue, which finishes it into this draft wherever the author goes. */
  function startGenerate() {
    if (!draft) return;
    setError(null);
    setLastAction("generate");
    setReading(true);
    setSelection(null);
    generate({
      key: draftKey,
      href: resumeHref,
      label: draftLabel,
      ctx,
      direction: draft.prompt,
      length,
      model: writeModel,
      suggestModel,
      after: {
        // A new branch needs choice text; if the author hasn't written any, make it from the chapter.
        choiceText: (target.kind === "new" || target.kind === "fill") && !draft.newChoiceLabel.trim(),
        // With the setting on, offer choices for the ending too, unless the author has already written some.
        suggestChoices: settings.autoSuggestChoices && !draft.choices.some((c) => c.trim()),
      },
      base: { title: draft.title, body: draft.body },
      draft,
    });
  }

  /** Stops what is going: a Generate in the queue, or this page's own request. */
  function stopWork() {
    if (generating) stopGenerate(draftKey);
    else abortRef.current?.abort();
  }

  async function runAi(kind: "generate" | "refine") {
    if (!draft) return;
    if (kind === "generate") return startGenerate();
    setError(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    startBusy(kind);
    setReading(true);
    // With a passage selected, only that part of the text is rewritten; the rest and the title stay as they are.
    const picked = kind === "refine" ? currentSelection(draft.body) : null;
    const before = picked ? draft.body.slice(0, picked.start) : "";
    const passage = picked ? draft.body.slice(picked.start, picked.end) : "";
    const after = picked ? draft.body.slice(picked.end) : "";
    setSelection(null);
    let text = "";
    try {
      const ready = await prepareContext(ctl.signal);
      const request = chapterRequest(kind, ready, picked);
      // Keep the text we're replacing, as the previous draft and so the rewrite can be undone.
      setDraft((d) => (d ? { ...d, undo: pushUndo(d), ...startVersion(d) } : d));
      const lead = passage.match(/^\s*/)?.[0] ?? "";
      const trail = passage.match(/\s*$/)?.[0] ?? "";
      for await (const piece of streamChat(settings, {
        system: request.system,
        messages: [{ role: "user", content: request.message }],
        role: "main",
        model: writeModel,
        signal: ctl.signal,
      })) {
        text += piece;
        if (picked) {
          const body = `${before}${lead}${text.trim()}${trail}${after}`;
          setDraft((d) => (d ? { ...d, body } : d));
        } else {
          const { title, body } = parseChapterOutput(text);
          setDraft((d) => (d ? { ...d, ...(title !== null ? { title } : {}), body } : d));
        }
      }
      if (kind === "refine") patch({ instruction: "" });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(null);
    }
  }

  /** One sentence of choice text, written by the cheaper model: from the chapter, or from the previous chapter alone when there is no draft. */
  const choiceLabelRequest = (chapter: { title: string; body: string } | null, ready: StoryContext): PromptParts => ({
    system: SYSTEM_CHOICE_LABEL,
    message: choiceLabelPrompt({ ...ready, choiceLabel: null }, chapter, settings.contextTokens),
  });

  async function askChoiceLabel(chapter: { title: string; body: string } | null, ready: StoryContext, signal?: AbortSignal) {
    const request = choiceLabelRequest(chapter, ready);
    const reply = await completeChat(settings, {
      system: request.system,
      messages: [{ role: "user", content: request.message }],
      role: "cheap",
      model: suggestModel,
      maxTokens: 60,
      signal,
    });
    return parseChoiceLabel(reply).slice(0, LIMITS.label);
  }

  /** The button next to the choice text: replaces it with a fresh one made from the current chapter. */
  async function regenerateChoiceText(field: "newChoiceLabel" | "incomingLabel") {
    if (!draft) return;
    setError(null);
    startBusy("label");
    try {
      const label = await askChoiceLabel(draft.body.trim() ? { title: draft.title, body: draft.body } : null, ctx);
      if (!label) throw new Error("The AI didn't give any choice text. Try again.");
      patch({ [field]: label });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const choiceTextButton = (field: "newChoiceLabel" | "incomingLabel") => (
    <>
      <button
        type="button"
        className="secondary"
        onClick={() => regenerateChoiceText(field)}
        disabled={busy !== null}
        title={draft.body.trim() ? "Write one sentence of choice text from this chapter" : "Suggest a choice based on the previous chapter"}
      >
        {busy === "label" ? "Thinking…" : "Regenerate"}
      </button>
      <PromptButton
        label="Regenerate choice text"
        note={suggestNote}
        build={() => choiceLabelRequest(draft.body.trim() ? { title: draft.title, body: draft.body } : null, ctx)}
      />
    </>
  );

  const ideasRequest = (): PromptParts => ({
    system: SYSTEM_IDEAS,
    // Untouched, the guidance only echoes the choice text; once edited it is the author's own direction for the ideas.
    message: ideasPrompt(
      guidance === null ? ctx : { ...ctx, choiceLabel: null },
      settings.contextTokens,
      guidance ?? "",
      ideaPages.flat().map((i) => i.choice),
    ),
  });

  /** Ideas for a new branch from the chapter being continued; picking one fills in the form. */
  async function suggestIdeas() {
    setError(null);
    startBusy("ideas");
    try {
      const request = ideasRequest();
      const text = await completeChat(settings, {
        system: request.system,
        messages: [{ role: "user", content: request.message }],
        role: "cheap",
      model: suggestModel,
        maxTokens: 800,
      });
      const found = parseIdeas(text);
      if (found.length === 0) throw new Error("The AI didn't suggest anything I could read. Try again.");
      setDraft((d) => (d ? { ...d, ideaPages: [...(d.ideaPages ?? []), found], ideaPage: d.ideaPages?.length ?? 0 } : d));
      setPromoting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Adds the idea, with the text the author settled on, as an unwritten choice on the chapter being continued. */
  async function promoteIdea(key: string, parentChapterId: string) {
    const label = promoting?.key === key ? promoting.text.trim() : "";
    if (!label) return;
    setPromoteBusy(true);
    setPromoteError(null);
    try {
      const res = await fetch(`/api/chapters/${parentChapterId}/choices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setDraft((d) => (d ? { ...d, promoted: { ...d.promoted, [key]: label } } : d));
      setPromoting(null);
      // Reloads the choices that already exist, so the next ideas steer clear of this one.
      router.refresh();
    } catch (e) {
      setPromoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setPromoteBusy(false);
    }
  }

  /** `chapter` is the text to suggest for when it isn't in the draft yet (just written). */
  const choicesRequest = (chapter?: { title: string; body: string }): PromptParts => ({
    system: SYSTEM_CHOICES,
    message: choicesPrompt(
      ctx,
      chapter ?? { title: draft.title, body: draft.body },
      draft.choices.filter((c) => c.trim()),
      settings.contextTokens,
    ),
  });

  /** `chapter` is the text to suggest for when it isn't in the draft yet (just written); `quiet` leaves a failure unreported. */
  async function suggestChoices(chapter?: { title: string; body: string }, quiet = false) {
    if (!draft) return;
    setError(null);
    startBusy("choices");
    try {
      const request = choicesRequest(chapter);
      const text = await completeChat(settings, {
        system: request.system,
        messages: [{ role: "user", content: request.message }],
        role: "cheap",
      model: suggestModel,
        maxTokens: 400,
      });
      const found = parseChoices(text);
      patch({ suggestions: found });
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function addChoice(label: string) {
    if (!draft) return;
    const existing = draft.choices.map((c) => c.trim()).filter(Boolean);
    if (existing.length >= maxNew) return;
    patch({ choices: [...existing, label, ""].slice(0, maxNew), suggestions: suggestions.filter((x) => x !== label) });
  }

  function undo() {
    if (!draft || draft.undo.length === 0) return;
    const prev = draft.undo[draft.undo.length - 1];
    patch({ title: prev.title, body: prev.body, undo: draft.undo.slice(0, -1) });
  }

  const finalChoices = draft.choices.map((c) => c.trim()).filter(Boolean);
  // `field` is the id of the part of the form that fixes it.
  const problems: { text: string; field: string }[] = [];
  if ((target.kind === "new" || target.kind === "fill") && !draft.newChoiceLabel.trim()) {
    problems.push({ text: "Add the choice text for the previous chapter.", field: "field-choice" });
  }
  if (!draft.title.trim()) problems.push({ text: "Add a chapter title.", field: "field-title" });
  if (!draft.body.trim()) problems.push({ text: "Write the chapter text.", field: "field-body" });
  if (target.kind === "edit" && target.incomingLabel !== null && !(draft.incomingLabel ?? "").trim()) {
    problems.push({ text: "The choice that leads here needs some text.", field: "field-incomingLabel" });
  }

  /** Scrolls to a part of the form and, if it has a field, focuses it. */
  function goTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  }
  const existingChoices =
    target.kind === "edit"
      ? target.existingChoices.map((c) => ({
          ...c,
          original: c.label,
          label: draft.choiceEdits?.[c.id]?.label ?? c.label,
          removed: draft.choiceEdits?.[c.id]?.removed ?? false,
        }))
      : [];
  const setChoiceEdit = (id: string, change: Partial<{ label: string; removed: boolean }>) => {
    const cur = existingChoices.find((c) => c.id === id);
    if (!cur) return;
    patch({
      choiceEdits: { ...draft.choiceEdits, [id]: { label: cur.label, removed: cur.removed, ...change } },
    });
  };
  const keptExisting = existingChoices.filter((c) => !c.removed).length;
  const maxNew = Math.max(0, LIMITS.choices - (target.kind === "edit" ? keptExisting : 0));

  /**
   * Summary of this chapter and of the story through it, using the cheaper model. `own` is the
   * author's summary: kept as-is, with only the story-so-far generated around it.
   */
  async function makeSummaries(signal: AbortSignal, own?: string): Promise<Summaries> {
    if (!draft) throw new Error("Nothing to summarize");
    let path = ctx.path;
    const parent = path.length - 1;
    // The new chapter's rolling summary builds on its parent's, which may need to exist first.
    if (parent >= 0 && !path[parent].path_summary) {
      const made = await ensurePathSummaries(settings, path, parent, {
        story: storyInfo,
        signal,
        onProgress: (done, total) => setStatus(`Summarizing the story so far (${Math.min(done + 1, total)} of ${total})…`),
      });
      const all = { ...madeSummaries, ...made };
      setMadeSummaries(all);
      path = withSummaries(path, all);
    }
    setStatus("Summarizing this chapter…");
    return summarizeChapter(settings, {
      story: storyInfo,
      previous: parent >= 0 ? path[parent].path_summary : null,
      chapter: { title: draft.title, body: draft.body },
      summary: own,
      signal,
    });
  }

  async function summarize() {
    if (!draft) return;
    setError(null);
    startBusy("summary");
    const ctl = new AbortController();
    abortRef.current = ctl;
    const body = draft.body;
    try {
      const s = await makeSummaries(ctl.signal);
      patch({ summary: s.summary, aiSummary: { ...s, body } });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setBusy(null);
    }
  }

  // A generated summary is out of date once the chapter changes (unless the author has rewritten it).
  const ownSummary = (draft.summary ?? "").trim();
  const summaryStale = !!draft.aiSummary && ownSummary === draft.aiSummary.summary && draft.aiSummary.body !== draft.body;
  // When editing, the chapter's summaries are left as they are unless the author changes the summary
  // or, after changing the text, asks for a new one.
  const sameSummary = target.kind === "edit" && ownSummary === (target.initialSummary ?? "").trim() && !summaryStale;
  const keptSummary = sameSummary && !!ownSummary;
  const textChanged = target.kind === "edit" && draft.body !== target.initialBody;
  // The text changed but the summary didn't: only the author knows whether it still describes the chapter.
  const needsSummaryChoice = keptSummary && textChanged && !(draft.aiSummary && draft.aiSummary.body === draft.body);

  /** Save; changed text with an unchanged summary asks first, whether to keep the summary or write a new one. */
  function requestPost() {
    if (needsSummaryChoice) setAskSummary(true);
    else void post();
  }

  async function post(resummarize = false) {
    if (!draft) return;
    setAskSummary(false);
    startBusy("post");
    setError(null);

    // A failed summary never blocks posting; it can be generated later from the chapter's Summary page.
    let summaries: Partial<Summaries> | null = null;
    let summaryError: string | null = null;
    const ai = draft.aiSummary;
    const own = ownSummary;
    if (ai && ai.body === draft.body && ai.summary === own) {
      summaries = { summary: ai.summary, path_summary: ai.path_summary };
    } else if (target.kind === "edit" && sameSummary && !(resummarize && textChanged) && (own || !textChanged)) {
      // Nothing to redo: a new title or choices don't change the summaries, and neither does text
      // the author chose to keep the summary for.
      summaries = {
        ...(own ? { summary: own } : {}),
        ...(target.initialPathSummary ? { path_summary: target.initialPathSummary } : {}),
      };
    } else {
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        summaries = await makeSummaries(ctl.signal, resummarize && textChanged ? undefined : own || undefined);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setBusy(null);
          return;
        }
        // The author's own summary is still posted; the story-so-far can be made later.
        if (own) summaries = { summary: own };
        else summaryError = e instanceof Error ? e.message : String(e);
      } finally {
        setStatus(null);
      }
    }
    try {
    const summaryFields = summaries ?? {};

    const chapter ={ title: draft.title, body: draft.body, choices: finalChoices, ...summaryFields };
    // Saved with the chapter and anchored at it. Entries created in the draft get their real id from the server.
    const codex_changes = codexChanges.map((c) => (isDraftEntry(c.entry_id) ? { ...c, entry_id: undefined } : c));
    let url: string;
    let method = "POST";
    let payload: unknown;
    if (target.kind === "edit") {
      url = `/api/chapters/${target.chapterId}`;
      method = "PATCH";
      payload = {
        base_revision: draft.baseRevision ?? target.baseRevision,
        title: draft.title,
        body: draft.body,
        ...summaryFields,
        edit_note: draft.editNote ?? "",
        incoming_label: target.incomingLabel !== null ? draft.incomingLabel : undefined,
        rename_choices: existingChoices.filter((c) => !c.removed && c.label.trim() !== c.original).map((c) => ({ id: c.id, label: c.label.trim() })),
        remove_choices: existingChoices.filter((c) => c.removed).map((c) => c.id),
        add_choices: finalChoices,
        codex_changes,
      };
    } else if (target.kind === "first") {
      url = `/api/stories/${target.storyId}/first-chapter`;
      payload = chapter;
    } else if (target.kind === "fill" && draft.newChoiceLabel.trim() === target.label.trim()) {
      url = "/api/chapters";
      payload = { ...chapter, choice_id: target.choiceId, codex_changes };
    } else {
      // A new choice on the parent chapter. For "fill" this means the author changed the text, so the
      // choice they started from is left as it was.
      url = "/api/chapters";
      payload = { ...chapter, parent_chapter_id: target.parentChapterId, new_choice_label: draft.newChoiceLabel, codex_changes };
    }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      loadedRef.current = false; // stop autosave from re-creating the draft
      await saveChainRef.current;
      await deleteDraft(draftKey).catch(() => {});
      const id = target.kind === "edit" ? target.chapterId : data.chapter_id;
      if (summaryError) router.push(`/c/${id}/summary?failed=${encodeURIComponent(summaryError)}`);
      else router.push(target.kind === "edit" ? `/c/${id}` : `/c/${id}?posted=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const versionCount = draft.versions?.length ?? 0;
  const versionIndex = draft.versionIndex ?? versionCount - 1;
  const working = busy === "generate" || busy === "refine";
  const words = countWords(draft.body);
  const hasBody = draft.body.trim() !== "";
  const brainstormOpen = brainstormPref ?? !hasBody;
  const targetWords = LENGTH_WORDS[length];
  const picked = currentSelection(draft.body);
  const pickedWords = picked ? countWords(picked.text) : 0;
  // A chapter with no choices ends its branch.
  const endsBranch = finalChoices.length === 0 && (target.kind !== "edit" || keptExisting === 0);

  const statusFor = (...kinds: (typeof busy)[]) => status && kinds.includes(busy) && <p className="meta">{status}</p>;
  const errorFor = (...kinds: (typeof busy)[]) => error && kinds.includes(lastAction) && <p className="error">{error}</p>;
  const posting = busy === "post";
  const openCodex = (editing: string | null) => {
    setCodexStart((s) => ({ editing, n: s.n + 1 }));
    setCodexOpen(true);
  };
  // For a new branch, ideas fill in the choice text until the author has some; after that they follow it.
  const ideaSetsChoice = (target.kind === "new" || target.kind === "fill") && !draft.newChoiceLabel.trim();
  // Ideas can become choices on the chapter being continued (the one that led to this page).
  const ideaParent = target.kind === "new" || target.kind === "fill" ? target.parentChapterId : null;

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <div className="editor-grid">
        <div className="editor-side">
          <details
            className="ai-panel fold"
            open={brainstormOpen}
            onToggle={(e) => {
              if (e.currentTarget.open !== brainstormOpen) setBrainstormPref(e.currentTarget.open);
            }}
          >
            <summary>
              Brainstorm
              {ideaPages.length > 0 && <span className="meta">{ideaPages.flat().length} ideas</span>}
            </summary>
            <label>
              Guidance <small>(optional; starts as the choice text, and editing it won&apos;t change the choice)</small>
              <AutoTextarea
                style={{ minHeight: "3rem", fontFamily: "inherit" }}
                value={guidanceText}
                onChange={(e) => patch({ guidance: e.target.value })}
              />
            </label>
            <div className="row">
              <button type="button" className="secondary" onClick={suggestIdeas} disabled={busy !== null}>
                {busy === "ideas" ? "Thinking…" : ideaPages.length ? "Suggest more" : "Suggest ideas"}
              </button>
              <PromptButton label="Suggest ideas" note={suggestNote} build={ideasRequest} />
              {suggestPicker}
              {ideaPages.length > 1 && (
                <>
                  <button type="button" className="secondary" onClick={() => patch({ ideaPage: ideaPage - 1 })} disabled={ideaPage === 0} aria-label="Previous ideas">
                    &lt;
                  </button>
                  <span className="meta">
                    Page {ideaPage + 1} of {ideaPages.length}
                  </span>
                  <button type="button" className="secondary" onClick={() => patch({ ideaPage: ideaPage + 1 })} disabled={ideaPage === ideaPages.length - 1} aria-label="Next ideas">
                    &gt;
                  </button>
                </>
              )}
            </div>
            <p className="meta">
              {ideaSetsChoice ? "Pick one to fill in the choice text and what should happen." : "Pick one to fill in what should happen."}
              {ideaParent && " “Add as choice” puts it on the previous chapter for you to write later."}
            </p>
            {errorFor("ideas")}
            {ideaPages[ideaPage] && (
              <ul className="codex-picks">
                {ideaPages[ideaPage].map((idea, i) => {
                  const key = `${ideaPage}:${i}`;
                  const editing = promoting?.key === key;
                  return (
                    <li key={key} className="codex-pick" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.4rem" }}>
                      <span>
                        <strong>{idea.choice}</strong>
                        {idea.direction && <span className="meta"> — {idea.direction}</span>}
                      </span>
                      {!editing && (
                        <span className="row" style={{ flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              patch(ideaSetsChoice ? { newChoiceLabel: idea.choice.slice(0, LIMITS.label), prompt: idea.direction } : { prompt: idea.direction })
                            }
                          >
                            Use this
                          </button>
                          {ideaParent &&
                            (promoted[key] ? (
                              <span className="meta" title={promoted[key]}>
                                Added as choice
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                  setPromoteError(null);
                                  setPromoting({ key, text: idea.choice.slice(0, LIMITS.label) });
                                }}
                              >
                                Add as choice
                              </button>
                            ))}
                        </span>
                      )}
                      {editing && ideaParent && (
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          <label>
                            Choice text <small>(added to the previous chapter as it reads here)</small>
                            <input
                              value={promoting.text}
                              maxLength={LIMITS.label}
                              autoFocus
                              onChange={(e) => setPromoting({ key, text: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                  e.preventDefault();
                                  void promoteIdea(key, ideaParent);
                                }
                              }}
                            />
                          </label>
                          <div className="row">
                            <button type="button" onClick={() => promoteIdea(key, ideaParent)} disabled={promoteBusy || !promoting.text.trim()}>
                              {promoteBusy ? "Adding…" : "Add choice"}
                            </button>
                            <button type="button" className="secondary" onClick={() => setPromoting(null)} disabled={promoteBusy}>
                              Cancel
                            </button>
                          </div>
                          {promoteError && <p className="error">{promoteError}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </details>

          {storyId && (
            <p className="meta">
              Style notes: {style.trim() ? snippet(style) : "none"} · <Link href={`/s/${storyId}/details`}>Edit story details</Link>
            </p>
          )}

          <div className="ai-panel">
            <CodexPreview
              ctx={ctx}
              direction={draft.prompt}
              contextTokens={settings.contextTokens}
              overrides={codexOverrides}
              onChange={(next) => patch({ codexOverrides: next })}
              onEdit={codexPanel ? (id) => openCodex(id) : undefined}
              onNew={codexPanel ? () => openCodex("new") : undefined}
              held={codexChanges.map((c) => c.entry_id)}
            />
          </div>
        </div>

        <div className="editor-main">
          {conflict && (
            <div className="notice" role="alert">
              <p>
                {conflict.current
                  ? `This draft was changed in another tab or browser (saved ${new Date(conflict.current.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}). Changes here aren't being saved until you pick one.`
                  : "This draft was posted or deleted in another tab or browser. Changes here aren't being saved."}
              </p>
              <div className="row">
                {conflict.current && (
                  <button
                    type="button"
                    onClick={() => {
                      const current = conflict.current!;
                      conflictRef.current = false;
                      setConflict(null);
                      showStored(current);
                    }}
                  >
                    Load that version
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    baseRef.current = conflict.current?.updatedAt ?? 0;
                    conflictRef.current = false;
                    setConflict(null);
                    queueSave(draft);
                  }}
                >
                  {conflict.current ? "Keep this one" : "Save it again"}
                </button>
              </div>
            </div>
          )}
          {target.kind === "edit" && target.descendantCount > 0 && (
            <p className="notice">
              {target.descendantCount} chapter{target.descendantCount === 1 ? " continues" : "s continue"} from this one.
              Keep the facts they rely on consistent, since they won&apos;t change automatically.
            </p>
          )}

          {target.kind === "edit" && target.incomingLabel !== null && (
            <section className="ai-panel">
              <label id="field-incomingLabel">
                Choice text <small>(the button readers click on the previous chapter to reach this one)</small>
                <span className="row">
                  <input
                    value={draft.incomingLabel ?? ""}
                    maxLength={LIMITS.label}
                    onChange={(e) => patch({ incomingLabel: e.target.value })}
                  />
                  {choiceTextButton("incomingLabel")}
                </span>
                {errorFor("label")}
              </label>
            </section>
          )}

          {(target.kind === "new" || target.kind === "fill") && (
            <section className="ai-panel">
              <label id="field-choice">
                Choice text <small>(the button readers click on the previous chapter; change it to add a new choice there instead)</small>
                <span className="row">
                  <input
                    value={draft.newChoiceLabel}
                    maxLength={LIMITS.label}
                    onChange={(e) => patch({ newChoiceLabel: e.target.value })}
                  />
                  {choiceTextButton("newChoiceLabel")}
                </span>
                {errorFor("label")}
              </label>
            </section>
          )}

          <section className="ai-panel">
            <h2>Direction</h2>
            <label>
              <span>
                What should happen? <small>(optional; [square brackets] hold extra instructions)</small>
              </span>
              <AutoTextarea
                style={{ minHeight: "5.5rem", fontFamily: "inherit" }}
                value={draft.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
            </label>
            <div className="row">
              <select value={length} onChange={(e) => patch({ length: e.target.value as Length })} style={{ width: "auto" }}>
                <option value="short">Short (~300 words)</option>
                <option value="medium">Medium (~600 words)</option>
                <option value="long">Long (~1000 words)</option>
              </select>
              <button type="button" onClick={() => runAi("generate")} disabled={busy !== null}>
                {busy === "generate" ? (generating?.state === "waiting" ? "Waiting…" : "Writing…") : draft.body ? "Generate a new draft" : "Generate chapter"}
              </button>
              <PromptButton
                label="Generate chapter"
                note={`Sent to ${modelName(writeModel, "main")}. If earlier chapters need summarizing first, that happens before sending, so the story-so-far part may differ slightly.`}
                build={() => chapterRequest("generate", ctx, null)}
              />
              {writePicker}
              {(working || generating) && (
                <button type="button" className="secondary" onClick={stopWork}>
                  Stop
                </button>
              )}
            </div>
            {generating?.state === "waiting" && (
              <p className="meta" role="status">
                {generating.note ?? "Waiting its turn…"}
              </p>
            )}
            {hasBody && busy === null && (
              <p className="meta">This adds a new draft; the current text is kept, and you can switch between drafts under Chapter.</p>
            )}
            {statusFor("generate", "refine")}
            {errorFor("generate", "refine")}
            {autoGenerate && !autoDone && !draft.body && (
              <AutoStart
                run={() => {
                  setAutoDone(true);
                  void runAi("generate");
                }}
              />
            )}
          </section>

          <section className="ai-panel">
            <h2>Chapter</h2>
            <div id="field-title">
              <label htmlFor="chapter-title">Title</label>
              <div className="row">
                <input
                  id="chapter-title"
                  aria-label="Chapter title"
                  style={{ flex: 1, minWidth: 0 }}
                  value={draft.title}
                  maxLength={LIMITS.title}
                  onChange={(e) => patch({ title: e.target.value })}
                />
                {versionCount > 1 && (
                  <div className="row draft-nav" role="group" aria-label="Draft versions">
                    <button type="button" className="secondary" onClick={() => showVersion(versionIndex - 1)} disabled={busy !== null || versionIndex === 0} aria-label="Previous draft">
                      &lt;
                    </button>
                    <span className="meta" aria-label={`Draft ${versionIndex + 1} of ${versionCount}`}>
                      {versionIndex + 1}/{versionCount}
                    </span>
                    <button type="button" className="secondary" onClick={() => showVersion(versionIndex + 1)} disabled={busy !== null || versionIndex === versionCount - 1} aria-label="Next draft">
                      &gt;
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="row body-head">
              <label htmlFor="chapter-body">Chapter text</label>
              <span className="meta word-count" aria-live="polite">
                {busy === "generate"
                  ? `Writing (${words.toLocaleString()}/~${targetWords.toLocaleString()} words)`
                  : `${working ? "Writing… " : ""}${words.toLocaleString()} word${words === 1 ? "" : "s"}`}
              </span>
            </div>

            <div id="field-body">
              {working || reading ? (
                <div>
                  <Prose text={draft.body} />
                  {!working && (
                    <button type="button" className="secondary" onClick={() => setReading(false)}>
                      Edit text
                    </button>
                  )}
                </div>
              ) : (
                <AutoTextarea
                  id="chapter-body"
                  value={draft.body}
                  maxLength={LIMITS.body}
                  onChange={(e) => patch({ body: e.target.value })}
                  onSelect={(e) => {
                    const { selectionStart: start, selectionEnd: end, value } = e.currentTarget;
                    const text = value.slice(start, end);
                    setSelection(text.trim() ? { start, end, text } : null);
                  }}
                />
              )}
            </div>

            <div className="row">
              <input
                placeholder={
                  hasBody
                    ? picked
                      ? "How should the selected passage change?"
                      : "Ask the AI to change it: “make it tenser”, “shorter”, “add dialogue”…"
                    : "Write or generate the chapter first, then ask the AI to change it"
                }
                aria-label="Instruction for the AI"
                value={instruction}
                disabled={!hasBody}
                onChange={(e) => patch({ instruction: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (busy === null && instruction.trim()) void runAi("refine");
                }}
              />
              <button type="button" onClick={() => runAi("refine")} disabled={busy !== null || !hasBody || !instruction.trim()}>
                {busy === "refine" ? "Revising…" : picked ? "Revise selection" : "Revise"}
              </button>
              <PromptButton
                label={picked ? "Revise selection" : "Revise"}
                note={`Sent to ${modelName(writeModel, "main")}. If earlier chapters need summarizing first, that happens before sending, so the story-so-far part may differ slightly.`}
                disabled={!hasBody}
                build={() => chapterRequest("refine", ctx, picked)}
              />
              {writePicker}
              <button type="button" className="secondary" onClick={undo} disabled={busy !== null || draft.undo.length === 0}>
                Undo
              </button>
            </div>
            {picked ? (
              <p className="meta">
                Only the selected passage ({pickedWords.toLocaleString()} word{pickedWords === 1 ? "" : "s"}) will change.
              </p>
            ) : (
              hasBody && <p className="meta">To change just one passage, select it in the text first{reading ? " (click Edit text)" : ""}.</p>
            )}
            {saved && (
              <div className={`meta save-state${"failed" in saved ? " error" : ""}`}>
                {"failed" in saved
                  ? "Couldn't save this draft"
                  : `Draft saved · ${new Date(saved.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
              </div>
            )}
          </section>

          <section className="ai-panel">
            <h2>Finish</h2>
            <label id="field-summary">
              Summary{" "}
              <small>(what happens in this chapter; later chapters use it to stay consistent)</small>
              <AutoTextarea
                style={{ minHeight: "6rem", fontFamily: "inherit" }}
                value={draft.summary ?? ""}
                maxLength={LIMITS.summary}
                onChange={(e) => patch({ summary: e.target.value })}
              />
            </label>
            <div className="row">
              <button type="button" className="secondary" onClick={summarize} disabled={busy !== null || !draft.body.trim()}>
                {busy === "summary" ? "Summarizing…" : ownSummary ? "Summarize again" : "Summarize chapter"}
              </button>
              <PromptButton
                label="Summarize chapter"
                note="Sent to your cheaper (summary) model. If the previous chapter has no story-so-far summary yet, that is made first."
                disabled={!draft.body.trim()}
                build={() =>
                  summaryRequest(settings.contextTokens, {
                    story: storyInfo,
                    previous: ctx.path.at(-1)?.path_summary ?? null,
                    chapter: { title: draft.title, body: draft.body },
                  })
                }
              />
              {busy === "summary" && (
                <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              )}
            </div>
            {!ownSummary && <p className="meta">Optional: if you leave this empty, a summary is written when you post.</p>}
            {statusFor("summary")}
            {errorFor("summary")}
            {summaryStale && (
              <p className="notice">The chapter has changed since this summary was made. Summarize it again or edit it, otherwise it will be posted as it is.</p>
            )}
            {needsSummaryChoice && (
              <p className="meta">
                You&apos;ve changed the text. When you save, you&apos;ll be asked whether this summary still fits or should be
                written again. You can also update it or summarize the chapter again now.
              </p>
            )}

            {target.kind === "edit" && existingChoices.length > 0 && (
              <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
                <legend style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  Current choices{" "}
                  <small style={{ fontWeight: 400 }}>(you can rename any; only ones nobody has written yet can be removed)</small>
                </legend>
                {existingChoices.map((c) => (
                  <div className="row" key={c.id}>
                    <input
                      value={c.label}
                      disabled={c.removed}
                      maxLength={LIMITS.label}
                      aria-label="Existing choice"
                      style={c.removed ? { textDecoration: "line-through" } : undefined}
                      onChange={(e) => setChoiceEdit(c.id, { label: e.target.value })}
                    />
                    {c.hasChild ? (
                      <span className="meta" style={{ whiteSpace: "nowrap" }}>
                        has a chapter
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setChoiceEdit(c.id, { removed: !c.removed })}
                      >
                        {c.removed ? "Keep" : "Remove"}
                      </button>
                    )}
                  </div>
                ))}
              </fieldset>
            )}

            <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
              <legend style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                {target.kind === "edit" ? "Add choices" : "Choices"}{" "}
                <small style={{ fontWeight: 400 }}>
                  {target.kind === "edit" ? "(new ones start out unwritten)" : "(leave empty to end the branch; others can add choices and continue it later)"}
                </small>
              </legend>
              {draft.choices.map((c, i) => (
                <div className="row" key={i}>
                  <input
                    value={c}
                    placeholder={`Choice ${i + 1}`}
                    maxLength={LIMITS.label}
                    onChange={(e) => patch({ choices: draft.choices.map((v, j) => (j === i ? e.target.value : v)) })}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => patch({ choices: draft.choices.filter((_, j) => j !== i) })}
                    aria-label={`Remove choice ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="row">
                {draft.choices.length < maxNew && (
                  <button type="button" className="secondary" onClick={() => patch({ choices: [...draft.choices, ""] })}>
                    + Add choice
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => suggestChoices()}
                  disabled={busy !== null || !draft.body.trim()}
                >
                  {busy === "choices" ? "Thinking…" : "Suggest choices"}
                </button>
                <PromptButton
                  label="Suggest choices"
                  note={suggestNote}
                  disabled={!draft.body.trim()}
                  build={() => choicesRequest()}
                />
                {suggestPicker}
              </div>
              {suggestions.length > 0 && (
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => addChoice(s)}>
                      + {s}
                    </button>
                  ))}
                </div>
              )}
              {errorFor("choices")}
              {endsBranch && (
                <p className="notice">
                  {target.kind === "edit"
                    ? "This chapter has no choices, so the story ends here unless someone adds some later."
                    : "No choices yet: posting now ends this branch. Add a choice to let the story continue (others can also add one later)."}
                </p>
              )}
            </fieldset>

            {target.kind === "edit" && (
              <label>
                What did you change? <small>(optional note shown in the chapter&apos;s history)</small>
                <input
                  value={draft.editNote ?? ""}
                  maxLength={LIMITS.label}
                  onChange={(e) => patch({ editNote: e.target.value })}
                />
              </label>
            )}
            {codexChanges.length > 0 && (
              <p className="meta">
                {codexChanges.length} codex change{codexChanges.length === 1 ? "" : "s"} will be saved with this chapter
                ({codexChanges.map((c) => c.name).join(", ")}).
              </p>
            )}
            <p className="meta">
              {target.kind === "edit"
                ? "The current version is kept in the chapter's history."
                : "You can edit it later, and every earlier version is kept."}{" "}
              Until then, your draft is saved as you go; open it from Drafts in any browser.
            </p>
          </section>
        </div>
      </div>

      <div className="action-bar">
        <div className="action-bar-info" aria-live="polite">
          {statusFor("post")}
          {errorFor("post")}
          {askSummary && needsSummaryChoice && busy === null ? (
            <p>
              <strong className="ask">You changed the chapter text.</strong> Does the existing summary still fit, or should
              it be written again from the new text? Re-summarizing also refreshes the story-so-far for the chapters after it.
            </p>
          ) : problems.length > 0 ? (
            <p>
              <strong>{target.kind === "edit" ? "Can't save yet:" : "Can't post yet:"}</strong>{" "}
              {problems.map((p, i) => (
                <span key={p.text}>
                  {i > 0 && " · "}
                  <button type="button" className="linkish" onClick={() => goTo(p.field)}>
                    {p.text}
                  </button>
                </span>
              ))}
            </p>
          ) : (
            <p className="meta">
              {words.toLocaleString()} word{words === 1 ? "" : "s"} · ready to {target.kind === "edit" ? "save" : "post"}            </p>
          )}
        </div>
        {posting && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        )}
        {askSummary && needsSummaryChoice && busy === null ? (
          <>
            <button type="button" className="secondary" onClick={() => setAskSummary(false)}>
              Cancel
            </button>
            <button type="button" className="secondary" onClick={() => void post(false)}>
              Keep the summary
            </button>
            <button type="button" onClick={() => void post(true)}>
              Re-summarize
            </button>
          </>
        ) : (
          <button type="button" onClick={requestPost} disabled={busy !== null || problems.length > 0}>
            {posting ? "Saving…" : target.kind === "edit" ? "Save changes" : "Post chapter"}
          </button>
        )}
      </div>

      {codexPanel && (
        <>
          <PageMenu onCodex={() => openCodex(null)} />
          {/* Rendered outside the form: the codex panel has forms of its own. */}
          {codexOpen &&
            createPortal(
              <aside className="codex-drawer" aria-label="Codex">
                <div className="codex-drawer-head">
                  <h2>Codex</h2>
                  <button type="button" className="secondary" onClick={() => setCodexOpen(false)}>
                    Close
                  </button>
                </div>
                <CodexPanel
                  key={codexStart.n}
                  embedded
                  startEditing={codexStart.editing}
                  draft={{ changes: codexChanges, onChange: (next) => patch({ codexChanges: next }) }}
                  story={{ title: context.storyTitle, premise: context.premise }}
                  chapterId={codexPanel.chapterId}
                  path={codexPanel.path}
                  ops={codexPanel.ops}
                />
              </aside>,
              document.body,
            )}
        </>
      )}
    </form>
  );
}
