"use client";

import { useState } from "react";
import type { AiRun, ExpandTask } from "@/lib/aiRuns/types";
import AiRunProgress from "./AiRunProgress";
import { INBOX_CHANGED } from "./CodexInbox";

/**
 * "Flesh out" under an entry's card: the AI proposes new facts for the entry, which arrive as cards in the codex inbox
 * for the owner to accept, edit or dismiss. By default it invents new details that fit the story; "stay close" only
 * elaborates on what the chapters already show. The facts take effect from the chapter the codex is shown at.
 */
export default function FleshOutEntry({ storyId, chapterId, entryId, name }: { storyId: string; chapterId: string; entryId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [close, setClose] = useState(false);
  const [hint, setHint] = useState("");
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function start() {
    setMessage(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/stories/${storyId}/flesh-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter_id: chapterId, entry_id: entryId, mode: close ? "close" : "invent", ...(hint.trim() && { hint: hint.trim() }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't start (${res.status})`);
      if (typeof data.run_id !== "string") setMessage({ ok: false, text: "That entry isn't in the codex at this chapter." });
      else {
        setRunId(data.run_id);
        setOpen(false);
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }

  function finished(run: AiRun) {
    const tasks = run.tasks.filter((t): t is ExpandTask => t.kind === "expand");
    const failed = tasks.some((t) => t.status === "failed");
    const skipped = tasks.find((t) => t.status === "skipped");
    const found = tasks.reduce((sum, t) => sum + (t.found ?? 0), 0);
    setRunId(null);
    if (failed) setMessage({ ok: false, text: "The AI couldn't do that. Try again." });
    else if (skipped) setMessage({ ok: false, text: skipped.error ?? "Skipped." });
    else setMessage({ ok: true, text: found === 0 ? "The AI had nothing new to add." : `The AI suggested ${found} fact${found === 1 ? "" : "s"}: see Suggested facts below.` });
    window.dispatchEvent(new Event(INBOX_CHANGED));
  }

  return (
    <div className="flesh-out">
      {!open && !runId && (
        <button type="button" className="secondary" onClick={() => setOpen(true)} aria-label={`Flesh out ${name} with AI`}>
          Flesh out
        </button>
      )}
      {open && (
        <form
          className="fact-form"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <p className="meta" style={{ margin: 0 }}>
            The AI suggests new facts for {name}. Nothing is added until you accept them in the codex inbox.
          </p>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} style={{ width: "auto" }} />
            <span>
              Stay close to the story <small>(only details the chapters show; otherwise it adds new ones of its own)</small>
            </span>
          </label>
          <label>
            Focus (optional)
            <input value={hint} maxLength={200} onChange={(e) => setHint(e.target.value)} placeholder="her family, how she talks…" />
          </label>
          <div className="row">
            <button type="submit" disabled={starting}>
              {starting ? "Starting…" : "Suggest facts"}
            </button>
            <button type="button" className="secondary" disabled={starting} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {runId && <AiRunProgress key={runId} runId={runId} onFinished={finished} />}
      {message && (
        <p className={message.ok ? "ok" : "error"} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
