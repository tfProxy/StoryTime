"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LIMITS } from "@/lib/limits";
import { usableRef, useSettings, type ModelRef } from "@/lib/settings";
import { LENGTH_WORDS, parseChapterOutput, type CodexOverrides, type Length, type StoryContext } from "@/lib/ai/prompts";
import type { PathChapter } from "@/lib/ai/codexAi";
import type { ChapterWriting } from "@/lib/chapterWriting";
import { foldWithDraft, isDraftEntry, isDraftFact, type CodexChange, type CodexOp, type FactChange, type FactOp } from "@/lib/codex";
import { markDeskMove } from "@/lib/deskMove";
import { deleteDraft, DraftConflict, emptyDraft, getDraft, saveDraft, type Draft } from "@/lib/drafts";
import { applyAfterGenerate, applyGenerated, isBegun, keptVersions, restore, snapshot } from "@/lib/generatedDraft";
import { useWorkQueue, type GenerateItem } from "./WorkQueue";
import Prose from "./Prose";
import { GenerateStep, ThinkingFold } from "./GenerateProgress";
import AutoTextarea from "./AutoTextarea";
import DeskVia from "./DeskVia";
import { usePhone } from "./DeskPhone";
import ModelPicker from "./ModelPicker";
import MoreMenu from "./MoreMenu";

export type Target =
  /** The first chapter of a story that has none yet. */
  | { kind: "first"; storyId: string }
  | { kind: "fill"; choiceId: string; label: string; parentChapterId: string }
  /** `label`: the new choice's text, when the page was opened with it (the desk's `?new=`). */
  | { kind: "new"; parentChapterId: string; label?: string }
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
      /** That choice and the chapter it is on: the writing desk renames it at once (its "→ …" line). */
      incomingChoice?: { id: string; parentChapterId: string } | null;
      /** The chapter currently has an AI mark, so it can be declared the author's own. */
      aiMarked?: boolean;
      /** The owner made the summary theirs on the desk, so Update leaves it alone. */
      summaryMine?: boolean;
      /** How the chapter was written (kept when it was posted), so the edit starts with its prompt and versions. */
      writing?: EditWriting | null;
    };

/** What an edit starts with from the chapter's kept writing; `versions` already include the chapter as posted. */
export type EditWriting = ChapterWriting & { versionIndex: number };

type Props = {
  target: Target;
  context: StoryContext;
  draftKey: string;
  resumeHref: string;
  draftLabel: string;
  /** Start generating as soon as the (empty) draft loads. */
  autoGenerate?: boolean;
  /**
   * The codex as of the chapter being continued, which the AI is sent with the changes held in the draft folded in;
   * absent when there is no earlier chapter to anchor it to. (`editing`: the last chapter of `path` is the one edited.)
   */
  codexPanel?: { chapterId: string; editing?: boolean; path: PathChapter[]; ops: CodexOp[]; facts?: FactOp[] };
  /** The writing desk around the box (see Desk). */
  desk: Desk;
};

/**
 * The writing desk, whose own columns show the codex, around the chapter's box (title; "Prompt and drafts"; the text;
 * "Summary"; Post or Update). `onText` hears the draft's title, prompt and text as they change (the desk's "In this
 * chapter"); `menuSlot` is where the top bar's ⋯ menu goes; `onNote` shows a line in the top bar (after an Update, say).
 */
export type Desk = {
  /** `text`: the title, prompt and text together; `body`: the chapter's text alone (the names listed under it). */
  onText: (text: string, body: string) => void;
  /** The text selected in the chapter's text box ("" when nothing is): the desk offers "Add as a fact…" for it. */
  onSelection?: (selected: string) => void;
  /** Shown right under the chapter's text: the desk's names found in it, and "Add as a fact…". */
  belowText?: ReactNode;
  menuSlot?: HTMLElement | null;
  onNote?: (note: string) => void;
  /**
   * A new chapter's codex changes held in its draft (null while the draft loads), with a way to change them: the desk's
   * codex columns hold their changes there, and Post saves them at the new chapter.
   */
  onHeld?: (held: HeldCodex | null) => void;
  /**
   * The draft's hand-picked codex entries for the prompt (pinned in, or left out), null while the draft loads, with a
   * way to change them: the desk's codex rows.
   */
  onOverrides?: (o: DeskOverrides | null) => void;
};

/** A draft's codex overrides for the prompt, and how to change them. */
export type DeskOverrides = { value: CodexOverrides; set: (next: CodexOverrides) => void };

/** Codex changes held in a draft (entries and facts), and how to change them. */
export type HeldCodex = {
  changes: CodexChange[];
  facts: FactChange[];
  update: (fn: (h: { changes: CodexChange[]; facts: FactChange[] }) => { changes: CodexChange[]; facts: FactChange[] }) => void;
};

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Mounts once and runs `run`; used to kick off generation after the draft has loaded.
function AutoStart({ run }: { run: () => void }) {
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Saves how the chapter was written (see chapterWriting.ts). Nothing is saved when nothing was generated or asked for. */
async function keepWriting(chapterId: string, d: Draft): Promise<void> {
  // The version being viewed is only refreshed in `versions` on leaving it: it takes the text, keeping its prompt.
  const versions = (d.versions ? keptVersions(d) : []).filter((v) => v.body.trim());
  if (!versions.length && !d.prompt.trim() && !d.ai?.length) return;
  const writing: ChapterWriting = { prompt: d.prompt, versions, ai: d.ai, length: d.length, models: d.models, codexOverrides: d.codexOverrides };
  const res = await fetch(`/api/chapters/${chapterId}/writing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(writing),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

// Ideas cost an AI call.
const hasWorkingState = (d: Draft) => !!(d.ideaPages?.length || d.guidance?.trim());

// Don't litter the drafts list with untouched forms.
function isBlank(d: Draft, target: Target): boolean {
  if (hasWorkingState(d)) return false;
  if (target.kind === "edit") {
    return (
      d.title === target.initialTitle &&
      d.body === target.initialBody &&
      d.prompt === (target.writing?.prompt ?? "") &&
      (d.versions?.length ?? 0) === (target.writing?.versions.length ?? 0) &&
      !d.editNote &&
      (d.summary ?? "") === (target.initialSummary ?? "") &&
      !d.choices.some((c) => c.trim()) &&
      !d.codexChanges?.length &&
      !d.codexFactChanges?.length &&
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
    d.codexFactChanges?.length ||
    d.choices.some((c) => c.trim())
  );
}

export default function ChapterEditor({ target, context, draftKey, resumeHref, draftLabel, autoGenerate, codexPanel, desk }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [localBusy, setBusy] = useState<null | "generate" | "choices" | "summary" | "post">(null);
  // A Generate lives in the work queue (so it goes on if the author leaves the page): the page is busy while that item is.
  const { items: queued, generate, stopGenerate, listenDraft } = useWorkQueue();
  const generating = queued.find((i): i is GenerateItem => i.type === "generate" && i.draftKey === draftKey && (i.state === "waiting" || i.state === "working"));
  const busy = localBusy ?? (generating ? "generate" : null);
  const [error, setError] = useState<string | null>(null);
  // The last action started, so its error shows in the section it came from.
  const [lastAction, setLastAction] = useState<typeof busy>(null);
  // The Generate's current step and the model's thinking, as the server tells them. The thinking stays shown after
  // the Generate ends, until the next one.
  const [genStep, setGenStep] = useState<{ text: string; since: number } | null>(null);
  const [thinking, setThinking] = useState("");
  // Words the Generate has written (its own text, not the draft's, which may have text from before).
  const [genWords, setGenWords] = useState(0);
  const [autoDone, setAutoDone] = useState(false);
  // After the AI writes, keep showing the read-only text until the user chooses to edit it.
  const [reading, setReading] = useState(false);
  // When the draft was last saved, or that it couldn't be.
  const [saved, setSaved] = useState<{ at: number } | { failed: true } | null>(null);
  // A save was refused because the draft was saved from another tab or browser first.
  const [conflict, setConflict] = useState<{ current: Draft | null } | null>(null);
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
  // The prompt of the Generate this page started, kept with the draft it makes (the box may change while it writes).
  const genPromptRef = useRef<string | null>(null);
  // The box: "Prompt and drafts" starts folded on a posted chapter and unfolded on a new one, or on a phone
  // (where the desk is for writing: the prompt and Generate come first); "Summary" folded. Null until it is toggled.
  const phone = usePhone();
  const [promptFold, setPromptOpen] = useState<boolean | null>(null);
  const promptOpen = promptFold ?? (target.kind !== "edit" || phone);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // A posted chapter's summary on the desk is the chapter's own (saved to it at once, not to the draft).
  const [chapterSummary, setChapterSummary] = useState({
    text: target.kind === "edit" ? (target.initialSummary ?? "") : "",
    mine: target.kind === "edit" && !!target.summaryMine,
    saved: true,
  });
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [markRemoved, setMarkRemoved] = useState(false);

  /** Shows a draft as stored on the server. */
  function showStored(d: Draft) {
    baseRef.current = d.updatedAt;
    skipSaveRef.current = true;
    // A draft saved by the old Edit and Write pages kept their address: its next save keeps the desk's instead.
    setDraft(upgraded({ ...d, href: resumeHref }));
  }

  /**
   * A Generate has ended and the server has the text in the draft: what the Generate makes is taken from the server's
   * draft, and anything else the author changed on the page meanwhile (the model picked, the choices typed) is kept
   * and saved on top of it.
   */
  function showGenerated(d: Draft) {
    // Read twice for one Generate (its end event and the queue list): the later read may be older than a save made since.
    if (d.updatedAt <= baseRef.current) return;
    baseRef.current = d.updatedAt;
    setDraft((cur) =>
      cur
        ? {
            ...cur,
            updatedAt: d.updatedAt,
            title: d.title,
            body: d.body,
            undo: d.undo,
            versions: d.versions,
            versionIndex: d.versionIndex,
            // the choice text the Generate made, unless the author has written their own meanwhile
            newChoiceLabel: cur.newChoiceLabel.trim() ? cur.newChoiceLabel : d.newChoiceLabel,
          }
        : upgraded(d),
    );
  }

  // An edit draft saved before summaries were carried into it has no summary field: start it from the chapter's.
  function upgraded(d: Draft): Draft {
    if (target.kind === "fill") {
      // A box left as the slot's text (or empty, or from a draft saved before slotLabel existed) shows the slot's current
      // text, which may have been renamed since the draft was saved. Text the author changed on purpose is kept.
      const untouched = !d.newChoiceLabel.trim() || d.slotLabel === undefined || d.newChoiceLabel === d.slotLabel;
      return untouched ? { ...d, newChoiceLabel: target.label, slotLabel: target.label } : d;
    }
    return target.kind === "edit" && d.summary === undefined && target.initialSummary ? { ...d, summary: target.initialSummary } : d;
  }

  // Load any saved draft for this spot.
  useEffect(() => {
    let cancelled = false;
    const fresh = (): Draft => {
      const d = emptyDraft(draftKey, resumeHref, draftLabel);
      // Filling in an existing choice starts with its text in the choice box; changing it makes a new choice instead.
      if (target.kind === "fill") return { ...d, newChoiceLabel: target.label, slotLabel: target.label };
      if (target.kind === "new" && target.label) return { ...d, newChoiceLabel: target.label };
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
        ...(target.writing ?? {}),
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

  // A change still waiting for the autosave when the editor goes (the writing desk moving to another chapter, say) is
  // saved then, so leaving keeps the draft as it was typed. (Declared before the autosave, so it is cleaned up first.)
  const pendingRef = useRef<Draft | null>(null);
  useEffect(
    () => () => {
      if (pendingRef.current) queueSave(pendingRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Autosave (debounced) to the server.
  useEffect(() => {
    pendingRef.current = null;
    if (!draft || !loadedRef.current) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    // While its Generate is in the queue the server saves the draft itself (D11); saving from here too would fight it.
    if (conflict || generating || isBlank(draft, target)) return;
    let fired = false;
    const unsaved = unsavedRef;
    unsaved.current++;
    pendingRef.current = draft;
    const t = setTimeout(() => {
      fired = true;
      pendingRef.current = null;
      unsaved.current--;
      queueSave(draft);
    }, 500);
    return () => {
      clearTimeout(t);
      if (!fired) unsaved.current--;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, conflict, !!generating]);

  useEffect(() => {
    busyRef.current = busy !== null;
  }, [busy]);

  // When its Generate ends (done, failed or stopped) the draft is read again from the server, which has the text.
  // This also brings the page's base up to the server's version, without which its next save is refused as a conflict.
  function rereadGenerated() {
    if (!loadedRef.current) return;
    getDraft(draftKey)
      .then((d) => {
        if (d) showGenerated(d);
      })
      .catch(() => {});
  }
  const wasGenerating = useRef(false);
  useEffect(() => {
    const now = !!generating;
    if (wasGenerating.current && !now) rereadGenerated();
    wasGenerating.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!generating, draftKey]);

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
  const generatingRef = useRef(false);
  useEffect(() => {
    generatingRef.current = !!generating;
  }, [generating]);
  const draftReady = draft !== null;
  useEffect(() => {
    if (!draftReady) return;
    // A page that opens while its Generate is going shows the text as it comes (reading mode). One that started the Generate
    // is in reading mode already; the author may switch to editing, and the pieces that follow do not switch it back.
    if (generatingRef.current) setReading(true);
    return listenDraft(draftKey, {
      onText: (text, base, ai) => {
        setDraft((d) => (d ? applyGenerated(d, parseChapterOutput(text), { continued: isBegun(d, base), ai, prompt: genPromptRef.current ?? undefined }) : d));
        setGenWords(countWords(parseChapterOutput(text).body));
      },
      onStep: (text, since) => setGenStep({ text, since }),
      onThinking: setThinking,
      // A quick Generate can start and end between two updates of the queue list, so the page never sees it going;
      // its end event is the sure sign, so the draft is read again here too.
      onDone: (after) => {
        setGenStep(null);
        setDraft((d) => (d ? applyAfterGenerate(d, after) : d));
        rereadGenerated();
      },
      onError: (message) => {
        setGenStep(null);
        setError(message);
        rereadGenerated();
      },
    });
    // rereadGenerated reads only refs and the draft key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, draftReady, listenDraft]);

  // The writing desk's codex columns show (and change) the codex changes held in a new chapter's draft.
  const onHeld = desk.onHeld;
  const heldChanges = draft?.codexChanges;
  const heldFacts = draft?.codexFactChanges;
  useEffect(() => {
    if (!onHeld) return;
    if (!draftReady) return onHeld(null);
    onHeld({
      changes: heldChanges ?? [],
      facts: heldFacts ?? [],
      update: (fn) =>
        setDraft((d) => {
          if (!d) return d;
          const next = fn({ changes: d.codexChanges ?? [], facts: d.codexFactChanges ?? [] });
          return { ...d, codexChanges: next.changes, codexFactChanges: next.facts };
        }),
    });
  }, [onHeld, draftReady, heldChanges, heldFacts]);

  // The writing desk's codex rows pin entries to the prompt, or leave them out, in the draft.
  const onOverrides = desk.onOverrides;
  const overrides = draft?.codexOverrides;
  useEffect(() => {
    if (!onOverrides) return;
    if (!draftReady) return onOverrides(null);
    onOverrides({ value: overrides ?? { include: [], exclude: [] }, set: (next) => setDraft((d) => (d ? { ...d, codexOverrides: next } : d)) });
  }, [onOverrides, draftReady, overrides]);

  // The writing desk reads the draft's words to list the codex entries named in it.
  const deskText = draft ? [draft.title, draft.prompt, draft.body].join("\n") : null;
  const deskBody = draft?.body ?? "";
  const onDeskText = desk.onText;
  useEffect(() => {
    if (deskText !== null) onDeskText?.(deskText, deskBody);
  }, [deskText, deskBody, onDeskText]);

  if (!draft) return <p className="meta">Loading draft…</p>;

  // Working state kept in the draft, so it survives a reload.
  const length: Length = draft.length ?? "medium";
  // Models picked for this draft; null means the default from Settings (also when the picked one's connection is gone).
  const writeModel = usableRef(settings, draft.models?.write);
  const suggestModel = usableRef(settings, draft.models?.suggest);
  const setModel = (job: "write" | "suggest", ref: ModelRef | null) =>
    setDraft((d) => (d ? { ...d, models: { ...d.models, [job]: ref ?? undefined } } : d));
  const writePicker = (
    <ModelPicker label="Model for writing" role="main" use="write" value={writeModel} onChange={(r) => setModel("write", r)} />
  );
  // Manual additions to / removals from the codex entries sent with each prompt.
  const codexOverrides: CodexOverrides = draft.codexOverrides ?? { include: [], exclude: [] };

  // Codex changes held in this draft apply to the chapter being written.
  const codexChanges = draft.codexChanges ?? [];
  const factChanges = draft.codexFactChanges ?? [];
  const draftDepth = (codexPanel?.path.at(-1)?.depth ?? -1) + 1;
  const codex =
    codexPanel && (codexChanges.length > 0 || factChanges.length > 0)
      ? foldWithDraft(codexPanel.ops, codexPanel.facts ?? [], codexChanges, factChanges, draftDepth, {
          recentAnchor: codexPanel.path.at(-1)?.id,
        }).map((e) => ({
          id: e.entry_id,
          name: e.name,
          type: e.type,
          aliases: e.aliases,
          content: e.description,
          always_include: e.always_include,
        }))
      : context.codex;
  const ctx: StoryContext = {
    ...context,
    codex,
    // The story's style notes are edited on its details page.
    style: context.style ?? "",
    // The choice text being typed here (a new branch, or a renamed one) is what the reader will have picked.
    choiceLabel:
      target.kind === "new" || target.kind === "fill"
        ? draft.newChoiceLabel.trim() || null
        : target.kind === "edit" && target.incomingLabel !== null
          ? (draft.incomingLabel ?? "").trim() || target.incomingLabel
          : context.choiceLabel,
    codexOverrides,
  };

  function startBusy(kind: NonNullable<typeof busy>) {
    setBusy(kind);
    setLastAction(kind);
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function showVersion(j: number) {
    setDraft((d) => {
      if (!d?.versions?.[j]) return d;
      const versions = keptVersions(d);
      return { ...d, versions, versionIndex: j, ...restore(versions[j]) };
    });
  }

  /** Generate goes to the work queue, which finishes it into this draft wherever the author goes. */
  function startGenerate() {
    if (!draft) return;
    setError(null);
    setLastAction("generate");
    setGenStep(null);
    setThinking("");
    setGenWords(0);
    setReading(true);
    genPromptRef.current = draft.prompt;
    // What is typed on the page is saved first, so the server builds on it (the page stops saving while it generates).
    if (!conflictRef.current && !isBlank(draft, target)) queueSave(draft);
    void saveChainRef.current.then(() => generate({
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
      },
      base: { title: draft.title, body: draft.body },
      draft,
    }));
  }

  /** Stops the draft's Generate in the queue. */
  function stopWork() {
    if (generating) stopGenerate(draftKey);
  }

  // Choices typed into a draft saved by the old Edit and Write pages go with its Post or Update.
  const finalChoices = draft.choices.map((c) => c.trim()).filter(Boolean);
  const existingChoices =
    target.kind === "edit"
      ? target.existingChoices.map((c) => ({
          ...c,
          original: c.label,
          label: draft.choiceEdits?.[c.id]?.label ?? c.label,
          removed: draft.choiceEdits?.[c.id]?.removed ?? false,
        }))
      : [];

  // The ⋯ menu's actions only exist when they make sense: replacing needs chapters below, and the first chapter can't go.
  const canReplace = target.kind === "edit" && target.existingChoices.some((c) => c.hasChild);
  const canTrash = target.kind === "edit" && target.incomingLabel !== null;
  const below = target.kind === "edit" ? target.descendantCount : 0;
  const belowText = `${below} chapter${below === 1 ? "" : "s"}`;

  /** Move to trash: the chapter and everything below it; the edits on the page are not saved, and the draft goes. */
  async function trashBranch() {
    if (target.kind !== "edit") return;
    const what = below > 0 ? `and the ${belowText} below it ` : "";
    if (!window.confirm(`Move “${target.initialTitle}” ${what}to the trash?`)) return;
    startBusy("post");
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${target.chapterId}/trash`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      loadedRef.current = false; // stop autosave from re-creating the draft
      await saveChainRef.current;
      await deleteDraft(draftKey).catch(() => {});
      router.push(`/c/${data.parent_chapter_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  /** Discard draft: deletes the draft and everything saved with it, then goes back to where the chapter would have hung. */
  async function discardDraft() {
    if (target.kind === "edit") return;
    if (!window.confirm("Discard this draft? Its text, choices and everything else saved with it are deleted. This can't be undone.")) return;
    startBusy("post");
    setError(null);
    try {
      loadedRef.current = false; // stop autosave from re-creating the draft
      await saveChainRef.current;
      await deleteDraft(draftKey);
      router.push(target.kind === "first" ? `/s/${target.storyId}` : `/c/${target.parentChapterId}`);
    } catch (e) {
      loadedRef.current = true;
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  /**
   * The codex changes held in the draft, saved with the chapter and anchored at it. Entries created in the draft get
   * their real id from the server, which matches their facts to them by the draft id; facts new in the draft get theirs too.
   */
  function codexPayload() {
    const newEntries = new Set(codexChanges.filter((c) => c.op === "create").map((c) => c.entry_id));
    const retiredEntries = new Set(codexChanges.filter((c) => c.op === "retire").map((c) => c.entry_id));
    const codex_fact_changes = factChanges
      .filter((f) => (!isDraftEntry(f.entry_id) || newEntries.has(f.entry_id)) && !retiredEntries.has(f.entry_id))
      .map((f) => (isDraftFact(f.fact_id) ? { ...f, fact_id: undefined } : f));
    return { codex_changes: codexChanges, codex_fact_changes };
  }

  const working = busy === "generate";
  const words = countWords(draft.body);
  const hasBody = draft.body.trim() !== "";
  const targetWords = LENGTH_WORDS[length];

  const errorFor = (...kinds: (typeof busy)[]) => error && kinds.includes(lastAction) && <p className="error">{error}</p>;
  const posting = busy === "post";

  // ---- the box's pieces ----
  const conflictNotice = conflict && (
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
  );
  const genProgress = (
    <>
      {generating?.state === "waiting" && (
        <p className="meta" role="status">
          {generating.note ?? "Waiting its turn…"}
        </p>
      )}
      {generating?.state === "working" && genStep && (
        <GenerateStep
          key={genStep.text}
          text={genStep.text}
          since={genStep.since}
          words={genStep.text === "Writing the chapter…" ? { done: genWords, target: targetWords } : undefined}
        />
      )}
      {thinking && <ThinkingFold text={thinking} live={generating?.state === "working"} />}
    </>
  );
  const autoStart = autoGenerate && !autoDone && !draft.body && (
    <AutoStart
      run={() => {
        setAutoDone(true);
        startGenerate();
      }}
    />
  );
  const bodyField = (
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
          aria-label="Chapter text"
          placeholder="Generate, or write here yourself."
          value={draft.body}
          maxLength={LIMITS.body}
          onChange={(e) => patch({ body: e.target.value })}
          onSelect={
            desk.onSelection
              ? (e) => {
                  const t = e.currentTarget;
                  desk.onSelection?.(t.value.slice(t.selectionStart, t.selectionEnd));
                }
              : undefined
          }
        />
      )}
    </div>
  );
  const saveState = saved && (
    <div className={`meta save-state${"failed" in saved ? " error" : ""}`}>
      {"failed" in saved
        ? "Couldn't save this draft"
        : `Draft saved · ${new Date(saved.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
    </div>
  );

  // ---- the drafts ----
  // The drafts: the versions, or the draft's text as its only one (a draft with no Generate yet).
  const deskDrafts = draft.versions ?? (draft.title || draft.body ? [snapshot(draft)] : []);
  const deskAt = Math.max(0, Math.min(draft.versionIndex ?? deskDrafts.length - 1, deskDrafts.length - 1));
  const isChapterText = (v: { title: string; body: string }) => target.kind === "edit" && v.title === target.initialTitle && v.body === target.initialBody;
  const showingIsChapter = isChapterText(draft);
  // The draft the chapter reads as (✓): its text is the chapter's. The one showing keeps its ✓ while it is typed in.
  const readsAs = deskDrafts.findIndex((v, i) => isChapterText(v) || (i === deskAt && showingIsChapter));
  // An older draft shows the prompt that made it, to put back in the box.
  const showingPrompt = deskAt < deskDrafts.length - 1 ? deskDrafts[deskAt]?.prompt : undefined;
  // A new chapter with no title is posted with its choice's text (a first chapter: the story's title).
  const choiceTitle = target.kind === "fill" ? target.label : target.kind === "new" ? draft.newChoiceLabel.trim() : target.kind === "first" ? context.storyTitle : "";
  const canUpdate = target.kind === "edit" && !showingIsChapter && hasBody && !!draft.title.trim();
  const canPost = target.kind !== "edit" && hasBody && (target.kind !== "new" || !!draft.newChoiceLabel.trim());
  const summaryText = target.kind === "edit" ? chapterSummary.text : (draft.summary ?? "");
  const summaryMine = target.kind === "edit" ? chapterSummary.mine : !!summaryText.trim();

  async function saveChapterSummary(body: { summary?: string; mine: boolean }) {
    if (target.kind !== "edit") return;
    try {
      const res = await fetch(`/api/chapters/${target.chapterId}/summary`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setChapterSummary((s) => ({ ...s, mine: data.mine, saved: true }));
    } catch (e) {
      setLastAction("summary");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Typing in Summary: a posted chapter's summary is saved to it (as the owner's) a moment after typing stops. */
  function typeSummary(text: string) {
    if (target.kind !== "edit") return patch({ summary: text });
    setChapterSummary((s) => ({ ...s, text, mine: text.trim() !== "", saved: false }));
    if (summaryTimer.current) clearTimeout(summaryTimer.current);
    summaryTimer.current = setTimeout(() => {
      summaryTimer.current = null;
      void saveChapterSummary({ summary: text.trim(), mine: true });
    }, 700);
  }

  async function flushSummary() {
    if (!summaryTimer.current) return;
    clearTimeout(summaryTimer.current);
    summaryTimer.current = null;
    await saveChapterSummary({ summary: chapterSummary.text.trim(), mine: true });
  }

  /** Unfolding Summary reads a posted chapter's summary again: the queue may have rewritten it since the desk opened. */
  function openSummary() {
    setSummaryOpen((o) => !o);
    if (summaryOpen || target.kind !== "edit" || !chapterSummary.saved || summaryTimer.current) return;
    fetch(`/api/chapters/${target.chapterId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const text = data?.chapter?.summary;
        if (typeof text === "string" || text === null) setChapterSummary((s) => (s.saved && !summaryTimer.current ? { ...s, text: text ?? "" } : s));
      })
      .catch(() => {});
  }

  /** "Let the AI rewrite it": the next Update (or the Post) has the AI write the summary again. */
  function handBackSummary() {
    if (target.kind !== "edit") return patch({ summary: "" });
    if (summaryTimer.current) clearTimeout(summaryTimer.current);
    summaryTimer.current = null;
    setChapterSummary((s) => ({ ...s, mine: false }));
    void saveChapterSummary({ summary: chapterSummary.text.trim(), mine: false });
  }

  const afterNote = (what: string) => `${what} · ${summaryMine ? "your summary is kept" : "rewriting its summary"}${settings.autoCodex ? " and checking the codex" : ""}`;

  /** Update chapter: the chapter's text becomes the draft showing; the old text goes to History. The drafts are kept with it. */
  async function deskUpdate(replaceBranch = false) {
    if (target.kind !== "edit" || !draft) return;
    if (replaceBranch && !window.confirm(`Update “${target.initialTitle}” with the draft showing and move the ${belowText} below it to the trash? Their choices stay, unwritten.`)) return;
    await flushSummary();
    startBusy("post");
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${target.chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_revision: draft.baseRevision ?? target.baseRevision,
          title: draft.title.trim(),
          body: draft.body,
          // The summaries stay as they are until the queue rewrites them.
          summary: chapterSummary.text.trim() || null,
          path_summary: target.initialPathSummary,
          // Changes to the choices held in a draft from the old Edit page go with it.
          incoming_label: target.incomingLabel !== null ? draft.incomingLabel?.trim() || undefined : undefined,
          rename_choices: existingChoices.filter((c) => !c.removed && c.label.trim() && c.label.trim() !== c.original).map((c) => ({ id: c.id, label: c.label.trim() })),
          remove_choices: existingChoices.filter((c) => c.removed).map((c) => c.id),
          add_choices: finalChoices,
          replace_branch: replaceBranch || undefined,
          ...codexPayload(),
          rewrite_summary: true,
          summary_model: suggestModel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      loadedRef.current = false; // stop autosave from re-creating the draft
      await saveChainRef.current;
      // The drafts and their prompts are kept with the chapter; the desk starts again from them.
      await keepWriting(target.chapterId, draft).catch(() => {});
      await deleteDraft(draftKey).catch(() => {});
      desk.onNote?.(afterNote("Updated"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  /** Post chapter: the draft becomes the chapter (choices are added after posting), and the desk stays on it. */
  async function deskPost() {
    if (target.kind === "edit" || !draft) return;
    startBusy("post");
    setError(null);
    const own = (draft.summary ?? "").trim();
    const chapter = {
      title: (draft.title.trim() || choiceTitle || "Untitled chapter").slice(0, LIMITS.title),
      body: draft.body,
      choices: finalChoices,
      ...(own ? { summary: own, summary_mine: true } : {}),
      rewrite_summary: true,
      summary_model: suggestModel,
    };
    let url = "/api/chapters";
    let payload: unknown;
    if (target.kind === "first") {
      // The desk holds codex entries for a first chapter too; they are saved at it.
      url = `/api/stories/${target.storyId}/first-chapter`;
      payload = { ...chapter, ...codexPayload() };
    } else if (target.kind === "fill" && draft.newChoiceLabel.trim() === target.label.trim()) {
      payload = { ...chapter, choice_id: target.choiceId, ...codexPayload() };
    } else {
      payload = { ...chapter, parent_chapter_id: target.parentChapterId, new_choice_label: draft.newChoiceLabel.trim(), ...codexPayload() };
    }
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      loadedRef.current = false;
      await saveChainRef.current;
      await keepWriting(data.chapter_id, draft).catch(() => {});
      await deleteDraft(draftKey).catch(() => {});
      // Still on the desk: the path keeps its fold states.
      markDeskMove(`/c/${data.chapter_id}/desk?posted=1`);
      router.push(`/c/${data.chapter_id}/desk?posted=1`, { scroll: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  /**
   * The desk's "→ …" line: on a new chapter it is the draft's choice text (for an existing choice, changing it makes a
   * new choice when posted). On a posted chapter the choice is renamed at once (choice text has no revisions); a draft
   * that still had the old text (one saved by the old Edit page) takes the new one, so its Update doesn't put the old
   * text back.
   */
  async function renameIncoming(label: string): Promise<string | null> {
    if (target.kind === "fill" || target.kind === "new") {
      patch({ newChoiceLabel: label });
      return null;
    }
    if (target.kind !== "edit" || !target.incomingChoice) return null;
    try {
      const { id, parentChapterId } = target.incomingChoice;
      const res = await fetch(`/api/chapters/${parentChapterId}/choices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error ?? `Request failed (${res.status})`;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    const was = target.incomingLabel;
    if (draft && (draft.incomingLabel ?? was) === was) {
      const next = { ...draft, incomingLabel: label };
      if (isBlank(next, { ...target, incomingLabel: label })) skipSaveRef.current = true;
      setDraft(next);
    }
    desk.onNote?.("Choice renamed");
    router.refresh();
    return null;
  }

  async function removeAiMark() {
    if (target.kind !== "edit") return;
    try {
      const res = await fetch(`/api/chapters/${target.chapterId}/owned`, { method: "POST" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setMarkRemoved(true);
      desk.onNote?.("The AI mark is removed");
      router.refresh();
    } catch (e) {
      setLastAction("post");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const n = deskDrafts.length;
  const updateNote = !hasBody
    ? "Write the chapter text to update the chapter."
    : !draft.title.trim()
      ? "Add a title to update the chapter."
      : showingIsChapter
        ? "The chapter reads as this draft."
        : deskAt === readsAs
          ? "You changed the chapter's draft. Update chapter to use your changes."
          : readsAs >= 0
            ? null // Which draft this is shows in the drafts line, at the top and at the foot.
            : "This draft differs from the chapter. Update chapter to use it.";
  // "draft 6 of 7 · 1,000 words": in the drafts row, and again at the foot of the box, where the reading ends.
  const draftsNote = n > 0 ? `${deskAt === readsAs && showingIsChapter ? "the chapter's text" : `draft ${deskAt + 1} of ${n}`} · ${words.toLocaleString()} word${words === 1 ? "" : "s"}` : null;
  const menu =
    desk.menuSlot &&
    createPortal(
      <MoreMenu label="More for this chapter">
        <label className="desk-menu-model">
          <span>Summary model</span>
          <ModelPicker label="Summary model" role="cheap" use="suggest" value={suggestModel} onChange={(r) => setModel("suggest", r)} />
        </label>
        {target.kind === "edit" ? (
          <>
            <Link href={`/c/${target.chapterId}/history`}>History</Link>
            <Link href={`/c/${target.chapterId}/write-ahead`}>Write ahead…</Link>
            <Link href={`/c/${target.chapterId}`}>Open the reading page</Link>
            {target.aiMarked && !markRemoved && (
              <button type="button" onClick={() => void removeAiMark()}>
                Remove the AI mark
              </button>
            )}
            <button
              type="button"
              className="danger"
              disabled={!canReplace || busy !== null}
              title={canReplace ? `Update the chapter with the draft showing, and move the ${belowText} below it to the trash.` : "No chapter is written below this one."}
              onClick={() => void deskUpdate(true)}
            >
              Replace branch…
            </button>
            <button
              type="button"
              className="danger"
              disabled={!canTrash || busy !== null}
              title={canTrash ? "Move this chapter and everything below it to the trash." : "The story's first chapter can't go to the trash."}
              onClick={() => void trashBranch()}
            >
              Move to trash…
            </button>
          </>
        ) : (
          <button type="button" className="danger" disabled={busy !== null} onClick={() => void discardDraft()}>
            Discard draft…
          </button>
        )}
      </MoreMenu>,
      desk.menuSlot,
    );
  return (
    <form className="desk-box-form" onSubmit={(e) => e.preventDefault()}>
      {conflictNotice}
      {/* The choice that leads here, above the box (none for a story's first chapter). */}
      {target.kind === "edit" ? (
        target.incomingLabel !== null && <DeskVia key={target.incomingLabel} label={target.incomingLabel} onSave={target.incomingChoice ? renameIncoming : undefined} />
      ) : target.kind !== "first" ? (
        <DeskVia
          key={draftKey}
          label={draft.newChoiceLabel}
          placeholder="The choice that leads here (needed to post)"
          note={
            target.kind === "fill" && draft.newChoiceLabel.trim() && draft.newChoiceLabel.trim() !== target.label.trim()
              ? `Post adds this as a new choice; “${target.label}” stays unwritten.`
              : null
          }
          onSave={renameIncoming}
        />
      ) : null}
      <section className="desk-box" aria-label="The chapter">
        <input
          id="chapter-title"
          className="desk-box-title"
          aria-label="Chapter title"
          placeholder={choiceTitle || "Untitled chapter"}
          value={draft.title}
          maxLength={LIMITS.title}
          onChange={(e) => patch({ title: e.target.value })}
        />

        <button type="button" className="desk-fold" aria-expanded={promptOpen} onClick={() => setPromptOpen(!promptOpen)}>
          {promptOpen ? "▾" : "▸"} Prompt and drafts ({n})
        </button>
        {promptOpen && (
          <div className="desk-prompt">
            <AutoTextarea
              aria-label="Prompt"
              className="desk-prompt-box"
              placeholder="Describe the chapter. [Square brackets] hold extra instructions."
              value={draft.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
            />
            <div className="row desk-gen-row">
              <select aria-label="Length" value={length} onChange={(e) => patch({ length: e.target.value as Length })} style={{ width: "auto" }}>
                <option value="short">Short (~300 words)</option>
                <option value="medium">Medium (~600 words)</option>
                <option value="long">Long (~1000 words)</option>
              </select>
              {writePicker}
              <span className="desk-spacer" />
              {(working || generating) && (
                <button type="button" className="secondary" onClick={stopWork}>
                  Stop
                </button>
              )}
              <button type="button" onClick={startGenerate} disabled={busy !== null}>
                {busy === "generate" ? (generating?.state === "waiting" ? "Waiting…" : "Writing…") : hasBody ? "Generate again" : "Generate"}
              </button>
            </div>
            {genProgress}
            {errorFor("generate")}
            {autoStart}
            <div className="row desk-drafts" role="group" aria-label="Drafts">
              <span className="desk-label">{n > 0 ? "Drafts" : "No drafts yet"}</span>
              {deskDrafts.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={i === deskAt ? "desk-draft on" : "desk-draft"}
                  aria-pressed={i === deskAt}
                  aria-label={`Draft ${i + 1}${i === readsAs ? ", the chapter's text" : ""}`}
                  disabled={busy !== null && i !== deskAt}
                  onClick={() => i !== deskAt && showVersion(i)}
                >
                  {i + 1}
                  {i === readsAs && " ✓"}
                </button>
              ))}
              {draftsNote && <span className="meta desk-drafts-note">{draftsNote}</span>}
            </div>
            {showingPrompt !== undefined && (
              <div className="desk-draft-prompt">
                <span className="meta">The prompt that made draft {deskAt + 1}:</span>
                <p className="desk-draft-prompt-text">{showingPrompt.trim() || "(none: the AI wrote it from the story so far)"}</p>
                <div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={showingPrompt === draft.prompt}
                    title={showingPrompt === draft.prompt ? "It is the prompt in the box already." : "Put this prompt back in the box."}
                    onClick={() => patch({ prompt: showingPrompt })}
                  >
                    Use this prompt
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {busy === "generate" && (
          <span className="meta word-count" aria-live="polite">
            Writing ({words.toLocaleString()}/~{targetWords.toLocaleString()} words)
          </span>
        )}
        {bodyField}
        {desk.belowText}
        {saveState}

        <button type="button" className="desk-fold" aria-expanded={summaryOpen} onClick={openSummary}>
          {summaryOpen ? "▾" : "▸"} Summary
          {summaryMine && <span className="desk-chip">yours · not rewritten</span>}
        </button>
        {summaryOpen && (
          <div className="desk-summary">
            <AutoTextarea
              aria-label="Summary"
              style={{ minHeight: "4rem", fontFamily: "inherit" }}
              placeholder={target.kind === "edit" ? "No summary yet. One is written when the chapter is updated." : "None yet. One is written when the chapter is posted."}
              value={summaryText}
              maxLength={LIMITS.summary}
              onChange={(e) => typeSummary(e.target.value)}
              onBlur={() => void flushSummary()}
            />
            {summaryMine ? (
              <div className="row desk-summary-mine">
                <span>You edited this summary, so {target.kind === "edit" ? "Update" : "Post"} leaves it alone.</span>
                <span className="desk-spacer" />
                <button type="button" className="secondary" onClick={handBackSummary}>
                  Let the AI rewrite it
                </button>
              </div>
            ) : (
              <span className="meta">
                {target.kind === "edit"
                  ? "Written by the AI and rewritten each time you update the chapter. Edit it here to keep your own."
                  : "Written by the AI when you post the chapter. Write your own here to keep it."}
              </span>
            )}
            {errorFor("summary")}
          </div>
        )}

        <div className="row desk-box-foot">
          {draftsNote && <span className="meta desk-foot-drafts">{draftsNote}</span>}
          <span className="meta">
            {target.kind === "edit" ? updateNote : canPost ? "A draft: nobody can read it yet. Choices are added after posting." : "Post chapter turns on once there is text."}
          </span>
          <span className="desk-spacer" />
          {/* Generate again where the reading ends, so a draft that doesn't work can be redone without scrolling up. */}
          {hasBody && (
            <button
              type="button"
              className="secondary desk-try-again"
              aria-label="Try again: a new draft from the prompt"
              title="Try again: a new draft from the prompt (as Generate again does)"
              disabled={busy !== null}
              onClick={startGenerate}
            >
              <span aria-hidden="true">↻</span>
            </button>
          )}
          {target.kind === "edit" ? (
            <button type="button" disabled={!canUpdate || busy !== null} onClick={() => void deskUpdate()}>
              {posting ? "Updating…" : "Update chapter"}
            </button>
          ) : (
            <button type="button" disabled={!canPost || busy !== null} onClick={() => void deskPost()}>
              {posting ? "Posting…" : "Post chapter"}
            </button>
          )}
        </div>
        {errorFor("post")}
      </section>
      {menu}
    </form>
  );
}
