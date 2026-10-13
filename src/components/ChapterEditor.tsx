"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/lib/limits";
import { saveSettings, useSettings } from "@/lib/settings";
import { newEditKey, saveEditKey } from "@/lib/keys";
import { completeChat, streamChat } from "@/lib/ai/client";
import { ensurePathSummaries, neededSummaryIndex, summarizeChapter, type Summaries } from "@/lib/ai/summaries";
import {
  choicesPrompt,
  generatePrompt,
  parseChapterOutput,
  parseChoices,
  refinePrompt,
  SYSTEM_CHAPTER,
  SYSTEM_CHOICES,
  type Length,
  type StoryContext,
} from "@/lib/ai/prompts";
import { deleteDraft, emptyDraft, getDraft, putDraft, type Draft } from "@/lib/drafts";
import Prose from "./Prose";

export type Target =
  | { kind: "story" }
  | { kind: "fill"; choiceId: string; label: string }
  | { kind: "new"; parentChapterId: string }
  | {
      kind: "edit";
      chapterId: string;
      editKey: string;
      baseRevision: number;
      /** How many chapters continue from this one. */
      descendantCount: number;
      initialTitle: string;
      initialBody: string;
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
};

const MAX_UNDO = 20;

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
      !d.choices.some((c) => c.trim()) &&
      Object.keys(d.choiceEdits ?? {}).length === 0 &&
      (d.incomingLabel ?? target.incomingLabel) === target.incomingLabel
    );
  }
  return !(d.storyTitle || d.premise || d.newChoiceLabel || d.title || d.body || d.prompt || d.choices.some((c) => c.trim()));
}

export default function ChapterEditor({ target, context, draftKey, resumeHref, draftLabel, autoGenerate }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  // The author name is the default from Settings; editing it here updates that default.
  const author = settings.authorName;
  const [length, setLength] = useState<Length>("medium");
  const [instruction, setInstruction] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | "generate" | "refine" | "choices" | "post">(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Story summaries generated during this session, by chapter id (also saved to the server).
  const [madeSummaries, setMadeSummaries] = useState<Record<string, Summaries>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [autoDone, setAutoDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);

  // Load any saved draft for this spot.
  useEffect(() => {
    let cancelled = false;
    const fresh = (): Draft => {
      const d = emptyDraft(draftKey, resumeHref, draftLabel);
      if (target.kind !== "edit") return d;
      return {
        ...d,
        title: target.initialTitle,
        body: target.initialBody,
        choices: [],
        baseRevision: target.baseRevision,
        incomingLabel: target.incomingLabel ?? undefined,
        choiceEdits: {},
      };
    };
    getDraft(draftKey)
      .then((d) => !cancelled && setDraft(d ?? fresh()))
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
      if (loadedRef.current) putDraft(draft).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) return <p className="meta">Loading draft…</p>;

  // For a brand-new story the title and premise are still being typed in this form.
  const withSummaries = (path: StoryContext["path"], made: Record<string, Summaries>) =>
    path.map((c) => (c.id && made[c.id] ? { ...c, summary: made[c.id].summary, path_summary: made[c.id].path_summary } : c));
  const storyInfo =
    target.kind === "story"
      ? { title: draft.storyTitle, premise: draft.premise }
      : { title: context.storyTitle, premise: context.premise };
  const ctx: StoryContext = {
    ...context,
    storyTitle: storyInfo.title,
    premise: storyInfo.premise,
    path: withSummaries(context.path, madeSummaries),
  };

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

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function pushUndo(d: Draft): Draft["undo"] {
    if (!d.title && !d.body) return d.undo;
    return [...d.undo, { title: d.title, body: d.body }].slice(-MAX_UNDO);
  }

  async function runAi(kind: "generate" | "refine") {
    if (!draft) return;
    setError(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(kind);
    let text = "";
    try {
      const ready = await prepareContext(ctl.signal);
      const message =
        kind === "generate"
          ? generatePrompt(ready, draft.prompt, length, settings.contextTokens)
          : refinePrompt(ready, { title: draft.title, body: draft.body }, instruction, settings.contextTokens);
      // Keep the text we're replacing so the rewrite can be undone.
      setDraft((d) => (d ? { ...d, undo: pushUndo(d) } : d));
      for await (const piece of streamChat(settings, {
        system: SYSTEM_CHAPTER,
        messages: [{ role: "user", content: message }],
        signal: ctl.signal,
      })) {
        text += piece;
        const { title, body } = parseChapterOutput(text);
        setDraft((d) => (d ? { ...d, ...(title !== null ? { title } : {}), body } : d));
      }
      if (kind === "refine") setInstruction("");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function suggestChoices() {
    if (!draft) return;
    setError(null);
    setBusy("choices");
    try {
      const text = await completeChat(settings, {
        system: SYSTEM_CHOICES,
        messages: [
          {
            role: "user",
            content: choicesPrompt(
              ctx,
              { title: draft.title, body: draft.body },
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
      setError(e instanceof Error ? e.message : String(e));
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
  const problems: string[] = [];
  if (target.kind === "story" && !draft.storyTitle.trim()) problems.push("Add a story title.");
  if (target.kind === "new" && !draft.newChoiceLabel.trim()) problems.push("Add the choice text for the previous chapter.");
  if (!draft.title.trim()) problems.push("Add a chapter title.");
  if (!draft.body.trim()) problems.push("Write the chapter text.");
  if (target.kind === "edit" && target.incomingLabel !== null && !(draft.incomingLabel ?? "").trim()) {
    problems.push("The choice that leads here needs some text.");
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

  /** Summary of this chapter and of the story through it, using the cheaper model. */
  async function makeSummaries(signal: AbortSignal): Promise<Summaries> {
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
      signal,
    });
  }

  async function post() {
    if (!draft) return;
    setBusy("post");
    setError(null);

    // A failed summary never blocks posting; it can be generated later from the chapter's Summary page.
    let summaries: Summaries | null = null;
    let summaryError: string | null = null;
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      summaries = await makeSummaries(ctl.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setBusy(null);
        return;
      }
      summaryError = e instanceof Error ? e.message : String(e);
    } finally {
      setStatus(null);
    }
    const summaryFields = summaries ? { summary: summaries.summary, path_summary: summaries.path_summary } : {};

    // New chapters get a fresh edit key; it is stored in this browser after a successful post.
    const editKey = target.kind === "edit" ? target.editKey : newEditKey();
    const chapter = { title: draft.title, body: draft.body, author_name: author, choices: finalChoices, edit_key: editKey, ...summaryFields };
    let url: string;
    let method = "POST";
    let payload: unknown;
    if (target.kind === "edit") {
      url = `/api/chapters/${target.chapterId}`;
      method = "PATCH";
      payload = {
        edit_key: target.editKey,
        base_revision: draft.baseRevision ?? target.baseRevision,
        title: draft.title,
        body: draft.body,
        ...summaryFields,
        edited_by: author,
        edit_note: draft.editNote ?? "",
        incoming_label: target.incomingLabel !== null ? draft.incomingLabel : undefined,
        rename_choices: existingChoices.filter((c) => !c.removed && c.label.trim() !== c.original).map((c) => ({ id: c.id, label: c.label.trim() })),
        remove_choices: existingChoices.filter((c) => c.removed).map((c) => c.id),
        add_choices: finalChoices,
      };
    } else if (target.kind === "story") {
      url = "/api/stories";
      payload = { title: draft.storyTitle, premise: draft.premise, author_name: author, chapter };
    } else if (target.kind === "fill") {
      url = "/api/chapters";
      payload = { ...chapter, choice_id: target.choiceId };
    } else {
      url = "/api/chapters";
      payload = { ...chapter, parent_chapter_id: target.parentChapterId, new_choice_label: draft.newChoiceLabel };
    }

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      loadedRef.current = false; // stop autosave from re-creating the draft
      if (target.kind !== "edit") saveEditKey(data.chapter_id, editKey);
      await deleteDraft(draftKey).catch(() => {});
      const id = target.kind === "edit" ? target.chapterId : data.chapter_id;
      if (summaryError) router.push(`/c/${id}/summary?failed=${encodeURIComponent(summaryError)}`);
      else router.push(target.kind === "edit" ? `/c/${id}` : `/c/${id}?posted=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const working = busy === "generate" || busy === "refine";
  // Rough target: ~6 characters per word of the chosen length (refining keeps about the same length).
  const targetChars = { short: 300, medium: 600, long: 1000 }[length] * 6;

  if (previewing) {
    return (
      <div style={{ display: "grid", gap: "1rem" }}>
        <p className="notice">
          {target.kind === "edit"
            ? "This is how the chapter will look after your changes. The current version is kept in its history."
            : "This is exactly what will be posted. You can edit it later from this browser, and every earlier version is kept."}
        </p>
        {target.kind === "edit" && (draft.editNote ?? "").trim() && (
          <p className="meta">
            Edit note: <em>{draft.editNote}</em>
          </p>
        )}
        {target.kind === "edit" && target.incomingLabel !== null && (draft.incomingLabel ?? "").trim() !== target.incomingLabel && (
          <p className="meta">
            The choice leading here changes to: <strong>{draft.incomingLabel}</strong>
          </p>
        )}
        {target.kind === "story" && (
          <p className="meta">
            New story: <strong>{draft.storyTitle}</strong>
            {draft.premise && <> — {draft.premise}</>}
          </p>
        )}
        {target.kind === "new" && (
          <p className="meta">
            New choice on the previous chapter: <strong>{draft.newChoiceLabel}</strong>
          </p>
        )}
        {target.kind === "fill" && (
          <p className="meta">
            Fills the choice: <strong>{target.label}</strong>
          </p>
        )}
        <div>
          <h1>{draft.title}</h1>
          <p className="meta">by {author || "Anonymous"}</p>
          <Prose text={draft.body} />
        </div>
        <div>
          <h2>Choices</h2>
          {target.kind === "edit" &&
            existingChoices
              .filter((c) => !c.removed)
              .map((c) => (
                <div key={c.id} className={c.hasChild ? "card" : "card choice-unwritten"}>
                  {c.label.trim()} {!c.hasChild && <span className="tag">· not written yet</span>}
                </div>
              ))}
          {finalChoices.map((c) => (
            <div key={c} className="card choice-unwritten">
              {c} <span className="tag">· not written yet{target.kind === "edit" ? " · new" : ""}</span>
            </div>
          ))}
          {finalChoices.length === 0 && (target.kind !== "edit" || keptExisting === 0) && (
            <p className="meta">None. This branch ends here, and others can&apos;t continue it.</p>
          )}
        </div>
        {status && <p className="meta">{status}</p>}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" className="secondary" onClick={() => setPreviewing(false)} disabled={busy === "post"}>
            Back to editing
          </button>
          <button type="button" onClick={post} disabled={busy === "post" || problems.length > 0}>
            {busy === "post" ? "Saving…" : target.kind === "edit" ? "Save changes" : "Post chapter"}
          </button>
        </div>
        {problems.length > 0 && <p className="error">{problems.join(" ")}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <label>
        Your name <small>(shown as the author; anyone can use any name)</small>
        <input value={author} maxLength={LIMITS.author} onChange={(e) => saveSettings({ ...settings, authorName: e.target.value.slice(0, LIMITS.author) })} />
      </label>

      {target.kind === "edit" && target.descendantCount > 0 && (
        <p className="notice">
          {target.descendantCount} chapter{target.descendantCount === 1 ? " continues" : "s continue"} from this one.
          Keep the facts they rely on consistent, since they won&apos;t change automatically.
        </p>
      )}

      {target.kind === "edit" && target.incomingLabel !== null && (
        <label>
          Choice text <small>(the button readers click on the previous chapter to reach this one)</small>
          <input
            value={draft.incomingLabel ?? ""}
            maxLength={LIMITS.label}
            onChange={(e) => patch({ incomingLabel: e.target.value })}
          />
        </label>
      )}

      {target.kind === "story" && (
        <>
          <label>
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
        </>
      )}

      {target.kind === "new" && (
        <label>
          Choice text <small>(the button readers click on the previous chapter)</small>
          <input
            value={draft.newChoiceLabel}
            maxLength={LIMITS.label}
            onChange={(e) => patch({ newChoiceLabel: e.target.value })}
          />
        </label>
      )}

      <section className="ai-panel">
        <h2>Draft with AI</h2>
        <label>
          What should happen? <small>(optional; leave blank to let the AI decide)</small>
          <textarea
            style={{ minHeight: "4rem", fontFamily: "inherit" }}
            value={draft.prompt}
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </label>
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
          <Link href="/settings" className="meta">
            AI settings
          </Link>
        </div>
        {status && <p className="meta">{status}</p>}
        {autoGenerate && !autoDone && !draft.body && (
          <AutoStart
            run={() => {
              setAutoDone(true);
              void runAi("generate");
            }}
          />
        )}
      </section>

      <label>
        Chapter title
        <input value={draft.title} maxLength={LIMITS.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>

      {working ? (
        <div aria-live="polite">
          <p className="meta">
            Writing… {draft.body.length.toLocaleString()} characters
            {busy === "generate" && <> (aiming for about {targetChars.toLocaleString()})</>}
          </p>
          <Prose text={draft.body} />
        </div>
      ) : (
        <label>
          Chapter text <small>({draft.body.length.toLocaleString()} characters)</small>
          <textarea value={draft.body} maxLength={LIMITS.body} onChange={(e) => patch({ body: e.target.value })} />
        </label>
      )}

      {draft.body.trim() && (
        <div className="row">
          <input
            placeholder="Ask the AI to change it: “make it tenser”, “shorter”, “add dialogue”…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <button type="button" onClick={() => runAi("refine")} disabled={busy !== null || !instruction.trim()}>
            {busy === "refine" ? "Revising…" : "Revise"}
          </button>
          <button type="button" className="secondary" onClick={undo} disabled={busy !== null || draft.undo.length === 0}>
            Undo
          </button>
        </div>
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
            {target.kind === "edit" ? "(new ones start out unwritten)" : "(leave empty to end the branch; others can write the paths later)"}
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
            onClick={suggestChoices}
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

      {error && <p className="error">{error}</p>}
      <div>
        <button type="button" onClick={() => setPreviewing(true)} disabled={busy !== null || problems.length > 0}>
          {target.kind === "edit" ? "Review changes…" : "Review and post…"}
        </button>
        {problems.length > 0 && <span className="meta"> {problems[0]}</span>}
      </div>
      <p className="meta">
        Your draft is saved in this browser only, until you {target.kind === "edit" ? "save" : "post"}.
      </p>
    </form>
  );
}
