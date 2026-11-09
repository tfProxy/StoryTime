"use client";

// What a Generate is doing, under the Generate button: the current step with how long it has taken, and the model's
// thinking (for models that think before they write) in a fold. The thinking is shown only; it is not saved.
import { useEffect, useRef, useState } from "react";

/** "0:42", "12:05". */
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Steps that are usually a long wait, with a word on why. */
const HINTS: Record<string, string> = {
  "Waiting for the model…": "It may be loading, or reading the prompt.",
};

export function GenerateStep({ text, since }: { text: string; since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const took = now - since;
  return (
    <p className="meta generate-step" role="status">
      {text}
      {took >= 3000 && <span className="generate-step-time"> {clock(took)}</span>}
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
