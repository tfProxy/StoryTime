"use client";

// What a Generate is doing, under the Generate button: the current step with how long it has taken, and the model's
// thinking (for models that think before they write) in a fold. The thinking is shown only; it is not saved.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { activeCalls, subscribeActivity, type AiCallActivity } from "@/lib/ai/activity";

const NONE: AiCallActivity[] = [];

/** The AI calls this tab is making now (all of them, or those with one of `labels` as their source label). */
export function useAiCalls(labels?: string[]): AiCallActivity[] {
  const calls = useSyncExternalStore(subscribeActivity, activeCalls, () => NONE);
  return labels ? calls.filter((c) => labels.includes(c.label)) : calls;
}

/**
 * Under a button that calls the AI from this page: what its newest call is doing, and the thinking in a fold. Shows
 * nothing while no such call is going. `labels` are the source labels of the calls the button makes.
 */
export function AiCallProgress({ labels }: { labels?: string[] }) {
  const call = useAiCalls(labels).at(-1);
  if (!call) return null;
  return (
    <div className="ai-call-progress">
      <GenerateStep key={`${call.id}:${call.step}`} text={call.step} since={call.since} />
      {call.thinking && <ThinkingFold text={call.thinking} live />}
    </div>
  );
}

/** "0:42", "12:05". */
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Steps that are usually a long wait, with a word on why. */
const HINTS: Record<string, string> = {
  "Waiting for the model…": "It may be loading, or reading the prompt.",
};

/** "about 3 min left", "under a minute left". */
function timeLeft(ms: number) {
  if (ms < 60_000) return "under a minute left";
  return `about ${Math.round(ms / 60_000)} min left`;
}

/**
 * One step and how long it has taken. With `words` (the words written so far and the length asked for), the speed
 * since the step began and the time left, once there is enough to judge by.
 */
export function GenerateStep({ text, since: given, words }: { text: string; since?: number; words?: { done: number; target: number } }) {
  const [now, setNow] = useState(() => Date.now());
  // Without `since`, the step is timed from when this line appeared.
  const [shownAt] = useState(() => Date.now());
  const since = given ?? shownAt;
  // The words there were when this step began (a continued draft has some already). The parent remounts it per step.
  const [startWords] = useState(() => words?.done ?? 0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const took = now - since;
  const added = words ? words.done - startWords : 0;
  const perMinute = took >= 10_000 && added >= 20 ? added / (took / 60_000) : null;
  const left = words && perMinute ? ((words.target - words.done) / perMinute) * 60_000 : null;
  return (
    <p className="meta generate-step" role="status">
      {text}
      {took >= 3000 && <span className="generate-step-time"> {clock(took)}</span>}
      {perMinute !== null && <span className="generate-step-speed"> · {Math.round(perMinute).toLocaleString()} words/min</span>}
      {left !== null && left > 0 && <span className="generate-step-left"> · {timeLeft(left)}</span>}
      {HINTS[text] && took >= 5000 && <span className="generate-step-hint"> {HINTS[text]}</span>}
    </p>
  );
}

export function ThinkingFold({ text, live }: { text: string; live: boolean }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const box = useRef<HTMLDivElement>(null);
  // While it comes in, the newest thinking stays in view.
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, live]);
  return (
    <details className="thinking-fold">
      <summary>
        {live ? "The model’s thinking" : "What the model thought"} <span className="meta">({words.toLocaleString()} word{words === 1 ? "" : "s"})</span>
      </summary>
      <div className="thinking-text" ref={box}>{text}</div>
    </details>
  );
}
