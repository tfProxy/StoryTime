"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import { useSettings } from "@/lib/settings";
import { completeChat, streamChat } from "@/lib/ai/client";
import { ensurePathSummaries, neededSummaryIndex, summarizeChapter, type Summaries } from "@/lib/ai/summaries";
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
  type StoryContext,
} from "@/lib/ai/prompts";
import type { PathChapter } from "@/lib/ai/codexAi";
import { draftOps, foldCodex, isDraftEntry, type CodexOp } from "@/lib/codex";
import { deleteDraft, emptyDraft, getDraft, putDraft, type Draft } from "@/lib/drafts";
import { diffWords } from "@/lib/diff";
import Prose from "./Prose";
import AutoTextarea from "./AutoTextarea";
import CodexPanel from "./CodexPanel";
import { PageMenu } from "./SiteMenu";
import CodexPreview from "./CodexPreview";

export type Target =
  | { kind: "story" }
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
  draftKey: string;
  resumeHref: string;
  draftLabel: string;
  /** Start generating as soon as the (empty) draft loads. */
  autoGenerate?: boolean;
  /** The codex as of the chapter being continued; absent when there is no earlier chapter to anchor it to. */
  codexPanel?: { chapterId: string; path: PathChapter[]; ops: CodexOp[] };
};

const MAX_UNDO = 20;
const MAX_VERSIONS = 20;

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Mounts once and runs `run`; used to kick off generation after the draft has loaded.
function AutoStart({ run }: { run: () => void }) {
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Don't litter the drafts list with untouched forms.
function isBlank(d: Draft, target: Target): boolean {
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
    (d.newChoiceLabel && !(target.kind === "fill" && d.newChoiceLabel === target.label)) ||
    d.title ||
    d.body ||
    d.prompt ||
    d.summary ||
    d.codexChanges?.length ||
    d.choices.some((c) => c.trim())
  );
}

export default function ChapterEditor({ target, context, draftKey, resumeHref, draftLabel, autoGenerate, codexPanel }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [length, setLength] = useState<Length>("medium");
  const [instruction, setInstruction] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Guidance for "Suggest more"; null until edited, so it follows the choice text by default.
  const [guidance, setGuidance] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "generate" | "refine" | "choices" | "ideas" | "summary" | "label" | "post">(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
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
  const [showPrompt, setShowPrompt] = useState(false);
  // Brainstorm and Direction are open until there is a chapter, then fold away; null until the author toggles one.
  const [brainstormPref, setBrainstormPref] = useState<boolean | null>(null);
  const [directionPref, setDirectionPref] = useState<boolean | null>(null);
  // After the AI writes, keep showing the read-only text until the user chooses to edit it.
  const [reading, setReading] = useState(false);
  // Manual additions to / removals from the codex entries sent with each prompt.
  const [codexOverrides, setCodexOverrides] = useState<CodexOverrides>({ include: [], exclude: [] });
  // The part of the chapter text selected in the editor; "Revise" then changes only that.
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  // Comparing the draft being shown with another one: whether it's open, and which one.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  // When this browser last saved the draft, or that it couldn't.
  const [saved, setSaved] = useState<{ at: number } | { failed: true } | null>(null);
  // Saving changed text asks whether to keep the chapter's summary or write a new one.
  const [askSummary, setAskSummary] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);

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
    // An edit draft saved before summaries were carried into it has no summary field: start it from the chapter's.
    const upgraded = (d: Draft): Draft => {
      if (target.kind === "fill" && !d.newChoiceLabel) return { ...d, newChoiceLabel: target.label };
      return target.kind === "edit" && d.summary === undefined && target.initialSummary ? { ...d, summary: target.initialSummary } : d;
    };
    getDraft(draftKey)
      .then((d) => !cancelled && setDraft(d ? upgraded(d) : fresh()))
      .catch(() => !cancelled && setDraft(fresh()))
      .finally(() => {
        loadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
    // `target` is rebuilt by the server page on each navigation; the draft key identifies the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, resumeHref, draftLabel]);

  // Autosave (debounced) to this browser only.
  useEffect(() => {
    if (!draft || !loadedRef.current || isBlank(draft, target)) return;
    const t = setTimeout(() => {
      if (!loadedRef.current) return;
      putDraft(draft)
        .then(() => setSaved({ at: Date.now() }))
        .catch(() => setSaved({ failed: true }));
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Leaving or reloading while the AI is working would cut it off; ask first.
  useEffect(() => {
    if (busy === null) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  if (!draft) return <p className="meta">Loading draft…</p>;

  // For a brand-new story the title and premise are still being typed in this form.
  const withSummaries = (path: StoryContext["path"], made: Record<string, Summaries>) =>
    path.map((c) => (c.id && made[c.id] ? { ...c, summary: made[c.id].summary, path_summary: made[c.id].path_summary } : c));
  const storyInfo =
    target.kind === "story"
      ? { title: draft.storyTitle, premise: draft.premise }
      : { title: context.storyTitle, premise: context.premise };
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
  const ctx: StoryContext = {
    ...context,
    codex,
    storyTitle: storyInfo.title,
    premise: storyInfo.premise,
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

  /** A new generated or revised draft gets its own version; the text it started from is kept as the one before it. */
  function startVersion(d: Draft): Pick<Draft, "versions" | "versionIndex"> {
    if (!d.body.trim()) return {};
    const kept = [...(d.versions ?? [{ title: d.title, body: d.body }])];
    kept[d.versionIndex ?? kept.length - 1] = { title: d.title, body: d.body };
    const versions = [...kept, { title: "", body: "" }].slice(-MAX_VERSIONS);
    return { versions, versionIndex: versions.length - 1 };
  }

  function showVersion(j: number) {
    setDraft((d) => {
      if (!d?.versions?.[j]) return d;
      const versions = [...d.versions];
      versions[d.versionIndex ?? versions.length - 1] = { title: d.title, body: d.body };
      return { ...d, versions, versionIndex: j, title: versions[j].title, body: versions[j].body };
    });
  }

  function pushUndo(d: Draft): Draft["undo"] {
    if (!d.title && !d.body) return d.undo;
    return [...d.undo, { title: d.title, body: d.body }].slice(-MAX_UNDO);
  }

  /** The selected passage, unless the text has changed since it was selected. */
  function currentSelection(body: string) {
    return selection && selection.text.trim() && body.slice(selection.start, selection.end) === selection.text ? selection : null;
  }

  async function runAi(kind: "generate" | "refine") {
    if (!draft) return;
    setError(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    startBusy(kind);
    setReading(true);
    setCompareOpen(false);
    // With a passage selected, only that part of the text is rewritten; the rest and the title stay as they are.
    const picked = kind === "refine" ? currentSelection(draft.body) : null;
    const before = picked ? draft.body.slice(0, picked.start) : "";
    const passage = picked ? draft.body.slice(picked.start, picked.end) : "";
    const after = picked ? draft.body.slice(picked.end) : "";
    setSelection(null);
    let text = "";
    let suggestFor: { title: string; body: string } | null = null;
    try {
      const ready = await prepareContext(ctl.signal);
      const message = picked
        ? passageRefinePrompt(ready, { title: draft.title, before, passage, after }, instruction, settings.contextTokens)
        : kind === "generate"
          ? generatePrompt(ready, draft.prompt, length, settings.contextTokens)
          : refinePrompt(ready, { title: draft.title, body: draft.body }, instruction, settings.contextTokens);
      // Keep the text we're replacing, as the previous draft and so the rewrite can be undone.
      setDraft((d) => (d ? { ...d, undo: pushUndo(d), ...startVersion(d) } : d));
      const lead = passage.match(/^\s*/)?.[0] ?? "";
      const trail = passage.match(/\s*$/)?.[0] ?? "";
      for await (const piece of streamChat(settings, {
        system: picked ? SYSTEM_PASSAGE : SYSTEM_CHAPTER,
        messages: [{ role: "user", content: message }],
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
      if (kind === "refine") setInstruction("");
      // A new branch needs choice text; if the author hasn't written any, make it from the chapter.
      if (kind === "generate" && (target.kind === "new" || target.kind === "fill") && !draft.newChoiceLabel.trim()) {
        const chapter = parseChapterOutput(text);
        if (chapter.body.trim()) await fillChoiceText({ title: chapter.title ?? "", body: chapter.body }, ready, ctl.signal);
      }
      // With the setting on, offer choices for the ending too, unless the author has already written some.
      if (kind === "generate" && settings.autoSuggestChoices && !draft.choices.some((c) => c.trim())) {
        const chapter = parseChapterOutput(text);
        if (chapter.body.trim()) suggestFor = { title: chapter.title ?? "", body: chapter.body };
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(null);
    }
    if (suggestFor) await suggestChoices(suggestFor, true);
  }

  /** One sentence of choice text, written by the cheaper model: from the chapter, or from the previous chapter alone when there is no draft. */
  async function askChoiceLabel(chapter: { title: string; body: string } | null, ready: StoryContext, signal?: AbortSignal) {
    const reply = await completeChat(settings, {
      system: SYSTEM_CHOICE_LABEL,
      messages: [{ role: "user", content: choiceLabelPrompt({ ...ready, choiceLabel: null }, chapter, settings.contextTokens) }],
      useSummaryModel: true,
      maxTokens: 60,
      signal,
    });
    return parseChoiceLabel(reply).slice(0, LIMITS.label);
  }

  /** Best effort: a failure just leaves the choice text for the author to write. */
  async function fillChoiceText(chapter: { title: string; body: string }, ready: StoryContext, signal: AbortSignal) {
    try {
      const label = await askChoiceLabel(chapter, ready, signal);
      if (label) setDraft((d) => (d && !d.newChoiceLabel.trim() ? { ...d, newChoiceLabel: label } : d));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
    }
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
    <button
      type="button"
      className="secondary"
      onClick={() => regenerateChoiceText(field)}
      disabled={busy !== null}
      title={draft.body.trim() ? "Write one sentence of choice text from this chapter" : "Suggest a choice based on the previous chapter"}
    >
      {busy === "label" ? "Thinking…" : "Regenerate"}
    </button>
  );

  /** Ideas for a new branch from the chapter being continued; picking one fills in the form. */
  async function suggestIdeas() {
    setError(null);
    startBusy("ideas");
    try {
      const text = await completeChat(settings, {
        system: SYSTEM_IDEAS,
        messages: [
          {
            role: "user",
            // Untouched, the guidance only echoes the choice text; once edited it is the author's own direction for the ideas.
            content: ideasPrompt(guidance === null ? ctx : { ...ctx, choiceLabel: null }, settings.contextTokens, guidance ?? ""),
          },
        ],
        useSummaryModel: true,
        maxTokens: 800,
      });
      const found = parseIdeas(text);
      if (found.length === 0) throw new Error("The AI didn't suggest anything I could read. Try again.");
      setIdeas(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** `chapter` is the text to suggest for when it isn't in the draft yet (just written); `quiet` leaves a failure unreported. */
  async function suggestChoices(chapter?: { title: string; body: string }, quiet = false) {
    if (!draft) return;
    setError(null);
    startBusy("choices");
    try {
      const text = await completeChat(settings, {
        system: SYSTEM_CHOICES,
        messages: [
          {
            role: "user",
            content: choicesPrompt(
              ctx,
              chapter ?? { title: draft.title, body: draft.body },
              draft.choices.filter((c) => c.trim()),
              settings.contextTokens,
            ),
          },
        ],
        useSummaryModel: true,
        maxTokens: 400,
      });
      setSuggestions(parseChoices(text));
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
    patch({ choices: [...existing, label, ""].slice(0, maxNew) });
    setSuggestions((s) => s.filter((x) => x !== label));
  }

  function undo() {
    if (!draft || draft.undo.length === 0) return;
    const prev = draft.undo[draft.undo.length - 1];
    patch({ title: prev.title, body: prev.body, undo: draft.undo.slice(0, -1) });
  }

  const finalChoices = draft.choices.map((c) => c.trim()).filter(Boolean);
  // `field` is the id of the part of the form that fixes it.
  const problems: { text: string; field: string }[] = [];
  if (target.kind === "story" && !draft.storyTitle.trim()) problems.push({ text: "Add a story title.", field: "field-storyTitle" });
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
    } else if (target.kind === "story") {
      url = "/api/stories";
      payload = { title: draft.storyTitle, premise: draft.premise, chapter };
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
  const directionOpen = directionPref ?? !hasBody;
  const directionText = draft.prompt.trim().replace(/\s+/g, " ");
  const directionSnippet = directionText ? (directionText.length > 70 ? `${directionText.slice(0, 70)}…` : directionText) : "the AI decides";
  const targetWords = LENGTH_WORDS[length];
  const picked = currentSelection(draft.body);
  const pickedWords = picked ? countWords(picked.text) : 0;
  // Comparing shows what changed from another draft to this one, in place of the text.
  const otherDraft =
    compareWith !== null && compareWith !== versionIndex && draft.versions?.[compareWith]
      ? compareWith
      : versionIndex > 0
        ? versionIndex - 1
        : versionIndex + 1;
  const comparing = compareOpen && versionCount > 1 && busy === null;
  const diff = comparing ? diffWords(draft.versions?.[otherDraft]?.body ?? "", draft.body) : [];
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
              {ideas.length > 0 && <span className="meta">{ideas.length} ideas</span>}
            </summary>
            <label>
              Guidance <small>(optional; starts as the choice text, and editing it won&apos;t change the choice)</small>
              <AutoTextarea
                style={{ minHeight: "3rem", fontFamily: "inherit" }}
                value={guidanceText}
                onChange={(e) => setGuidance(e.target.value)}
              />
            </label>
            <div className="row">
              <button type="button" className="secondary" onClick={suggestIdeas} disabled={busy !== null}>
                {busy === "ideas" ? "Thinking…" : ideas.length ? "Suggest more" : "Suggest ideas"}
              </button>
              <span className="meta">
                {ideaSetsChoice ? "Pick one to fill in the choice text and what should happen." : "Pick one to fill in what should happen."}
              </span>
            </div>
            {errorFor("ideas")}
            {ideas.length > 0 && (
              <ul className="codex-picks">
                {ideas.map((idea) => (
                  <li key={idea.choice} className="codex-pick">
                    <span>
                      <strong>{idea.choice}</strong>
                      {idea.direction && <span className="meta"> — {idea.direction}</span>}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        patch(ideaSetsChoice ? { newChoiceLabel: idea.choice.slice(0, LIMITS.label), prompt: idea.direction } : { prompt: idea.direction })
                      }
                    >
                      Use this
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>

          <div className="ai-panel">
            <CodexPreview
              ctx={ctx}
              direction={draft.prompt}
              contextTokens={settings.contextTokens}
              overrides={codexOverrides}
              onChange={setCodexOverrides}
              onEdit={codexPanel ? (id) => openCodex(id) : undefined}
              onNew={codexPanel ? () => openCodex("new") : undefined}
              held={codexChanges.map((c) => c.entry_id)}
            />
          </div>

          <details className="ai-panel fold" onToggle={(e) => setShowPrompt(e.currentTarget.open)}>
            <summary>Preview the prompt</summary>
            {showPrompt && (
              <div>
                <p className="meta">
                  This is what &quot;Generate&quot; will send. If earlier chapters need summarizing first, that happens
                  before sending, so the story-so-far part may differ slightly.
                </p>
                <h3>System</h3>
                <pre className="sample">{SYSTEM_CHAPTER}</pre>
                <h3>Message</h3>
                <pre className="sample">{generatePrompt(ctx, draft.prompt, length, settings.contextTokens)}</pre>
              </div>
            )}
          </details>
        </div>

        <div className="editor-main">
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

          {target.kind === "story" && (
            <section className="ai-panel">
              <label id="field-storyTitle">
                Story title
                <input
                  value={draft.storyTitle}
                  maxLength={LIMITS.title}
                  onChange={(e) => patch({ storyTitle: e.target.value })}
                />
              </label>
              <label>
                Premise <small>(optional blurb shown on the story page; the AI also sees it)</small>
                <textarea
                  style={{ minHeight: "6rem" }}
                  value={draft.premise}
                  maxLength={LIMITS.premise}
                  onChange={(e) => patch({ premise: e.target.value })}
                />
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
            <details
              className="fold"
              open={directionOpen}
              onToggle={(e) => {
                if (e.currentTarget.open !== directionOpen) setDirectionPref(e.currentTarget.open);
              }}
            >
              <summary>
                Direction
                {!directionOpen && <span className="meta">{directionSnippet}</span>}
              </summary>
              <label>
                What should happen? <small>(optional; leave blank to let the AI decide)</small>
                <AutoTextarea
                  style={{ minHeight: "5.5rem", fontFamily: "inherit" }}
                  value={draft.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                />
              </label>
            </details>
            <div className="row">
              <select value={length} onChange={(e) => setLength(e.target.value as Length)} style={{ width: "auto" }}>
                <option value="short">Short (~300 words)</option>
                <option value="medium">Medium (~600 words)</option>
                <option value="long">Long (~1000 words)</option>
              </select>
              <button type="button" onClick={() => runAi("generate")} disabled={busy !== null}>
                {busy === "generate" ? "Writing…" : draft.body ? "Generate a new draft" : "Generate chapter"}
              </button>
              {working && (
                <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              )}
            </div>
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
            <div className="row" aria-label="Draft versions">
              {versionCount > 1 && (
                <>
                  <button type="button" className="secondary" onClick={() => showVersion(versionIndex - 1)} disabled={busy !== null || versionIndex === 0} aria-label="Previous draft">
                    &lt;
                  </button>
                  <span className="meta">
                    Draft {versionIndex + 1} of {versionCount}
                  </span>
                  <button type="button" className="secondary" onClick={() => showVersion(versionIndex + 1)} disabled={busy !== null || versionIndex === versionCount - 1} aria-label="Next draft">
                    &gt;
                  </button>
                  <button type="button" className="secondary" onClick={() => setCompareOpen((o) => !o)} disabled={busy !== null} aria-pressed={comparing}>
                    Compare
                  </button>
                </>
              )}
              <span className="meta" aria-live="polite">
                {working ? "Writing… " : ""}
                {words.toLocaleString()} word{words === 1 ? "" : "s"}
                {busy === "generate" && <> (aiming for about {targetWords.toLocaleString()})</>}
              </span>
              {saved && (
                <span className={`meta save-state${"failed" in saved ? " error" : ""}`}>
                  {"failed" in saved
                    ? "Couldn't save this draft in this browser"
                    : `Saved in this browser · ${new Date(saved.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                </span>
              )}
            </div>

            {comparing && (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <label className="inline-label">
                  Compare with
                  <select value={otherDraft} onChange={(e) => setCompareWith(Number(e.target.value))} style={{ width: "auto" }}>
                    {(draft.versions ?? []).map((_, j) =>
                      j === versionIndex ? null : (
                        <option key={j} value={j}>
                          Draft {j + 1}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!window.confirm(`Keep only draft ${versionIndex + 1} and discard the other ${versionCount - 1}?`)) return;
                    patch({ versions: [{ title: draft.title, body: draft.body }], versionIndex: 0 });
                    setCompareOpen(false);
                  }}
                >
                  Keep only this draft
                </button>
                {versionCount >= MAX_VERSIONS && <span className="meta">Only the latest {MAX_VERSIONS} drafts are kept.</span>}
              </div>
            )}

            <label id="field-title">
              Chapter title
              <input value={draft.title} maxLength={LIMITS.title} onChange={(e) => patch({ title: e.target.value })} />
            </label>

            <div id="field-body">
              {comparing ? (
                <div>
                  <p className="meta">
                    Changes from draft {otherDraft + 1} to draft {versionIndex + 1}: <del className="diff-del">removed</del>{" "}
                    <ins className="diff-add">added</ins>
                  </p>
                  <p className="diff">
                    {diff.map((part, i) =>
                      part.type === "same" ? (
                        part.text
                      ) : part.type === "add" ? (
                        <ins key={i} className="diff-add">
                          {part.text}
                        </ins>
                      ) : (
                        <del key={i} className="diff-del">
                          {part.text}
                        </del>
                      ),
                    )}
                  </p>
                  <button type="button" className="secondary" onClick={() => setCompareOpen(false)}>
                    Back to editing
                  </button>
                </div>
              ) : working || reading ? (
                <div>
                  <Prose text={draft.body} />
                  {!working && (
                    <button type="button" className="secondary" onClick={() => setReading(false)}>
                      Edit text
                    </button>
                  )}
                </div>
              ) : (
                <label>
                  Chapter text
                  <AutoTextarea
                    value={draft.body}
                    maxLength={LIMITS.body}
                    onChange={(e) => patch({ body: e.target.value })}
                    onSelect={(e) => {
                      const { selectionStart: start, selectionEnd: end, value } = e.currentTarget;
                      const text = value.slice(start, end);
                      setSelection(text.trim() ? { start, end, text } : null);
                    }}
                  />
                </label>
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
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (busy === null && instruction.trim()) void runAi("refine");
                }}
              />
              <button type="button" onClick={() => runAi("refine")} disabled={busy !== null || !hasBody || !instruction.trim()}>
                {busy === "refine" ? "Revising…" : picked ? "Revise selection" : "Revise"}
              </button>
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
                : "You can edit it later from this browser, and every earlier version is kept."}{" "}
              Until then, your draft is saved in this browser only.
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
              {words.toLocaleString()} word{words === 1 ? "" : "s"} · ready to {target.kind === "edit" ? "save" : "post"}
              {endsBranch && " · ends the branch"}
            </p>
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
