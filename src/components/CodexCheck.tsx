"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AiRun, CodexTask } from "@/lib/aiRuns/types";
import AiRunProgress from "./AiRunProgress";
import { INBOX_CHANGED } from "./CodexInbox";
import { useWorkQueue } from "./WorkQueue";

type Props = {
  storyId: string;
  /** The chapter to check, or the way to it; null on the Story Bible with no chapter chosen (then the whole story can be checked). */
  chapterId: string | null;
  /** Where the codex inbox is, when the page is not that already. */
  inboxHref?: string;
  defaultOpen?: boolean;
};

/**
 * The buttons that queue a codex check: a review run whose "codex" tasks read chapters and leave suggestions in the
 * codex inbox. A chapter that was read at its current revision is read again (`recheck`), as the owner asked.
 */
export default function CodexCheck({ storyId, chapterId, inboxHref, defaultOpen }: Props) {
  const router = useRouter();
  const { startRun } = useWorkQueue();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runGoing, setRunGoing] = useState(false);

  const finishedRun = useCallback(
    (run: AiRun) => {
      const tasks = run.tasks.filter((t): t is CodexTask => t.kind === "codex");
      const failed = tasks.filter((t) => t.status === "failed").length;
      const found = tasks.reduce((sum, t) => sum + (t.found ?? 0), 0);
      setRunGoing(false);
      if (failed > 0) setMessage({ ok: false, text: `${failed} chapter${failed === 1 ? "" : "s"} could not be read. Try again from the run's list.` });
      else setMessage({ ok: true, text: found === 0 ? "Nothing to suggest: the codex already matches what the chapter says." : `Left ${found} suggestion${found === 1 ? "" : "s"} in the codex inbox.` });
      window.dispatchEvent(new Event(INBOX_CHANGED));
      router.refresh();
    },
    [router],
  );

  async function start(scope: "chapter" | "path" | "story") {
    setMessage(null);
    setStarting(true);
    try {
      const res = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story_id: storyId,
          start_chapter_id: scope === "story" ? null : chapterId,
          mode: "review",
          options: { tagScope: scope, checks: ["codex"], recheck: true },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't start the check (${res.status})`);
      setRunId(data.id);
      setRunGoing(true);
      await startRun(data.id);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || runGoing;
  return (
    <details className="ai-panel" open={defaultOpen}>
      <summary>
        <strong>Check for codex changes</strong> <span className="meta">— the AI reads chapters and suggests fact changes</span>
      </summary>
      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
        <div className="row">
          {chapterId ? (
            <>
              <button type="button" onClick={() => start("chapter")} disabled={busy}>
                {busy ? "Checking…" : "Check this chapter"}
              </button>
              <button type="button" className="secondary" onClick={() => start("path")} disabled={busy}>
                Check every chapter on this branch
              </button>
            </>
          ) : (
            <button type="button" onClick={() => start("story")} disabled={busy}>
              {busy ? "Checking…" : "Check every chapter"}
            </button>
          )}
        </div>
        <p className="meta">
          One AI call for each chapter, using your cheaper model. Suggestions wait in the codex inbox until you accept or dismiss them.
          {inboxHref && (
            <>
              {" "}
              <Link href={inboxHref}>Open the codex inbox</Link>
            </>
          )}
        </p>
        {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
        {runId && <AiRunProgress key={runId} runId={runId} onFinished={finishedRun} />}
      </div>
    </details>
  );
}
