"use client";

import { useState } from "react";
import { FACT_LIMITS, type CodexEntry } from "@/lib/codex";
import type { CodexSuggestion } from "@/lib/codexSuggestions";
import type { AiRun, CodexTask, ExpandTask } from "@/lib/aiRuns/types";
import AiRunProgress from "./AiRunProgress";
import { KeepFrom, type Chapter } from "./CodexEntryPage";
import { INBOX_CHANGED, useCodexInbox } from "./CodexInbox";

type Inbox = ReturnType<typeof useCodexInbox>;
type Source = "chapter" | "path" | "invent";

/** A suggestion the AI made up (Flesh out's "invent", no quote from the story). */
const invented = (s: CodexSuggestion) => s.source === "expand" && !s.quote;

/**
 * The writing desk's Suggestions tab for one entry: "Waiting for you", every open suggestion for it on the way to this
 * chapter (from the codex check, or asked for here), each kept, edited or dismissed; and "Ask the AI for more".
 */
export default function DeskSuggestions({
  entry,
  storyId,
  chapterId,
  path,
  start,
  inbox,
  askOff = null,
}: {
  entry: CodexEntry;
  storyId: string;
  chapterId: string;
  /** The chapters from the story's first to `chapterId`. */
  path: Chapter[];
  /** Where the entry first appears on this path. */
  start: Chapter;
  inbox: Inbox;
  /** Why "Ask the AI for more" is greyed out (on a chapter not posted yet, it has no text to read). */
  askOff?: string | null;
}) {
  const list = inbox.shown.filter((s) => s.entry_id === entry.entry_id);
  const open = list.filter((s) => s.status === "open");
  return (
    <div className="desk-suggestions">
      <h3 className="desk-label">Waiting for you{open.length > 0 ? ` (${open.length})` : ""}</h3>
      {inbox.loadError && <p className="error">{inbox.loadError}</p>}
      {list.length === 0 ? (
        <p className="meta">No suggestions waiting for {entry.name}.</p>
      ) : (
        <ul className="desk-sug-list">
          {list.map((s) => (
            <SuggestionRow key={s.id} s={s} entry={entry} path={path} start={start} inbox={inbox} />
          ))}
        </ul>
      )}
      {askOff ? (
        <div className="desk-ask">
          <h3 className="desk-label">Ask the AI for more</h3>
          <p className="meta">{askOff}</p>
        </div>
      ) : (
        <AskForMore entry={entry} storyId={storyId} chapterId={chapterId} path={path} />
      )}
    </div>
  );
}

function SuggestionRow({ s, entry, path, start, inbox }: { s: CodexSuggestion; entry: CodexEntry; path: Chapter[]; start: Chapter; inbox: Inbox }) {
  const [editing, setEditing] = useState(false);
  const [aspect, setAspect] = useState(s.kind === "form" ? s.form : s.aspect);
  const [text, setText] = useState(s.after);
  // Where a kept fact takes effect from: the suggestion's chapter, or an earlier one on its path from where the entry
  // first appears. An idea the AI made up asks the entry page's question: where the entry first appears, or its chapter.
  const from = path.findIndex((c) => c.id === start.id);
  const to = path.findIndex((c) => c.id === s.chapter_id);
  const choices = from >= 0 && to >= from ? path.slice(from, to + 1) : [{ id: s.chapter_id, title: s.chapter_title }];
  const [anchor, setAnchor] = useState(s.chapter_id);
  const [atStart, setAtStart] = useState(true);
  const busy = inbox.busy.has(s.id);
  const label = s.kind === "form" ? "Form" : s.aspect || "General";

  if (s.status === "accepted") {
    return (
      <li className="desk-sug done">
        Kept: <strong>{label}</strong>
      </li>
    );
  }
  if (s.status === "dismissed") {
    return (
      <li className="desk-sug done">
        <span>
          Dismissed: <strong>{label}</strong>
        </span>
        <button type="button" className="link-button" disabled={busy} onClick={() => void inbox.reopen(s)}>
          Undo
        </button>
      </li>
    );
  }

  const idea = invented(s);
  const keepAt = idea ? (atStart && start.id !== s.chapter_id ? start.id : s.chapter_id) : anchor;
  const what = s.kind === "form" ? [s.form, s.after].filter(Boolean).join(", ") : s.kind === "retire" ? "remove it" : s.after;
  function keep() {
    const edits = editing ? (s.kind === "form" ? { form: aspect.trim(), text: text.trim() } : { aspect: aspect.trim(), text: text.trim() }) : {};
    void inbox.accept(s, { ...edits, ...(keepAt !== s.chapter_id ? { anchor_chapter_id: keepAt } : {}) });
  }

  return (
    <li className="desk-sug" id={`desk-sug-${s.id}`}>
      <div className="desk-sug-text">
        {s.new_category && <span className="desk-chip" title="This category isn't on your list in Settings › Codex. Keeping it adds it to this entry.">New category</span>} <strong>{label}</strong>
        {s.kind === "conflict" ? " · the text contradicts the codex: " : " · "}
        {what}
      </div>
      <div className="meta desk-sug-source">
        {s.quote ? (
          <>
            From “{s.chapter_title}”: “{s.quote}”
          </>
        ) : idea ? (
          "The AI's own idea. Nothing in the story says this."
        ) : (
          <>From “{s.chapter_title}”</>
        )}
      </div>
      {editing && (
        <div className="fact-form">
          <label>
            {s.kind === "form" ? "Form" : "Aspect"}
            <input aria-label={s.kind === "form" ? "Form" : "Aspect"} value={aspect} maxLength={FACT_LIMITS.aspect} onChange={(e) => setAspect(e.target.value)} />
          </label>
          <label>
            Text
            <textarea aria-label="Fact" rows={2} value={text} maxLength={FACT_LIMITS.text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
      )}
      {idea && start.id !== s.chapter_id ? (
        <KeepFrom legend="Takes effect from" s={s} entryName={entry.name} start={start} atStart={atStart} onChange={setAtStart} />
      ) : (
        <label className="desk-sug-from">
          <span className="meta">Takes effect from</span>
          <select aria-label="Takes effect from" value={anchor} disabled={choices.length < 2} onChange={(e) => setAnchor(e.target.value)}>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                “{c.title}”{c.id === start.id && c.id !== s.chapter_id ? ` (where ${entry.name} first appears)` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <button type="button" disabled={busy || (editing && !text.trim())} onClick={keep}>
          Keep
        </button>
        {(s.kind === "set" || s.kind === "form") && (
          <button type="button" className="secondary" disabled={busy} aria-pressed={editing} onClick={() => setEditing(!editing)}>
            {editing ? "Don't edit" : "Edit"}
          </button>
        )}
        <button type="button" className="secondary" disabled={busy} onClick={() => void inbox.dismiss(s)}>
          Dismiss
        </button>
      </div>
      {inbox.errors[s.id] && <p className="error">{inbox.errors[s.id]}</p>}
    </li>
  );
}

/**
 * "Ask the AI for more": read this chapter, read the story so far (each fact dated to the chapter that shows it, as
 * "Update from the story" does), or invent new details; with an optional focus. What it finds joins the list above.
 */
function AskForMore({ entry, storyId, chapterId, path }: { entry: CodexEntry; storyId: string; chapterId: string; path: Chapter[] }) {
  const [source, setSource] = useState<Source>("chapter");
  const [hint, setHint] = useState("");
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const here = path.find((c) => c.id === chapterId)?.title ?? "this chapter";
  const options: { id: Source; label: string; about: string }[] = [
    { id: "chapter", label: "Read this chapter", about: `what “${here}” says about ${entry.name}` },
    { id: "path", label: "Read the story so far", about: `${path.length === 1 ? "this chapter" : `chapters 1–${path.length}`}; each fact is dated to the chapter that shows it` },
    { id: "invent", label: "Invent new details", about: "made up to fit; you decide what stays" },
  ];

  async function start() {
    setMessage(null);
    setStarting(true);
    const focus = hint.trim() ? { hint: hint.trim() } : {};
    try {
      const res =
        source === "invent"
          ? await fetch(`/api/stories/${storyId}/flesh-out`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chapter_id: chapterId, entry_id: entry.entry_id, mode: "invent", ...focus }),
            })
          : await fetch(`/api/stories/${storyId}/update-entry`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chapter_id: chapterId, entry_id: entry.entry_id, scope: source, ...focus }),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't start (${res.status})`);
      if (typeof data.run_id !== "string") setMessage({ ok: false, text: `${entry.name} isn't in the codex at this chapter.` });
      else setRunId(data.run_id);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }

  function finished(run: AiRun) {
    const tasks = run.tasks.filter((t): t is CodexTask | ExpandTask => t.kind === "codex" || t.kind === "expand");
    const failed = tasks.filter((t) => t.status === "failed").length;
    const skipped = tasks.find((t) => t.status === "skipped");
    const found = tasks.reduce((sum, t) => sum + (t.found ?? 0), 0);
    setRunId(null);
    if (tasks.length > 0 && failed === tasks.length) setMessage({ ok: false, text: "The AI couldn't do that. Try again." });
    else if (skipped && found === 0) setMessage({ ok: false, text: skipped.error ?? "Skipped." });
    else setMessage({ ok: true, text: found === 0 ? `The AI had nothing new for ${entry.name}.` : `The AI suggested ${found} fact${found === 1 ? "" : "s"}: they are in the list above.` });
    window.dispatchEvent(new Event(INBOX_CHANGED));
  }

  return (
    <form
      className="desk-ask"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <h3 className="desk-label">Ask the AI for more</h3>
      <fieldset className="desk-ask-pick">
        <legend className="visually-hidden">What the AI does</legend>
        {options.map((o) => (
          <label key={o.id} className={source === o.id ? "desk-pick on" : "desk-pick"}>
            <input type="radio" name={`desk-ask-${entry.entry_id}`} checked={source === o.id} onChange={() => setSource(o.id)} />
            <span>
              <strong>{o.label}</strong>
              <small>{o.about}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Focus (optional)
        <input value={hint} maxLength={200} onChange={(e) => setHint(e.target.value)} placeholder="her family, how she talks…" />
      </label>
      <div className="row">
        <button type="submit" disabled={starting || runId !== null}>
          {starting ? "Starting…" : "Suggest facts"}
        </button>
      </div>
      {runId && <AiRunProgress key={runId} runId={runId} onFinished={finished} />}
      {message && (
        <p className={message.ok ? "ok" : "error"} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}
