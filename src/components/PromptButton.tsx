"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PromptParts } from "@/lib/ai/prompts";
import { copyText } from "@/lib/copyText";

type Props = {
  /** Builds the request the neighbouring button would send. May throw to explain why there isn't one yet. */
  build: () => PromptParts;
  /** What the button is for, e.g. "Generate chapter"; used in its tooltip and as the window's title. */
  label: string;
  /** Anything worth knowing about how the real request differs from this one. */
  note?: string;
  disabled?: boolean;
};

type Shown = { parts: PromptParts } | { error: string };

/** The system prompt and message as one block of text, for pasting into a chat. */
const asText = (p: PromptParts) => (p.system ? `${p.system}\n\n${p.message}` : p.message);

/** A small eye icon next to a button that sends a prompt; opens a window showing that prompt, with a button to copy it. */
export default function PromptButton({ build, label, note, disabled }: Props) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  function open() {
    setCopied(null);
    try {
      setShown({ parts: build() });
    } catch (e) {
      setShown({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  function close() {
    setShown(null);
    opener.current?.focus();
  }

  useEffect(() => {
    if (!shown) return;
    windowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown]);

  async function copy(parts: PromptParts) {
    setCopied(await copyText(asText(parts)));
  }

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="secondary icon-button"
        onClick={open}
        disabled={disabled}
        title={`View the prompt: ${label}`}
        // The name stays short and the same on every page; the tooltip (also read as its description) says which button it goes with.
        aria-label="View prompt"
      >
        <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {shown &&
        // Rendered outside the page's forms, which would otherwise submit or nest.
        createPortal(
          <div className="prompt-backdrop" onClick={close}>
            <div
              ref={windowRef}
              className="prompt-window"
              role="dialog"
              aria-label={`Prompt: ${label}`}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="prompt-window-head">
                <h2>Prompt: {label}</h2>
                {"parts" in shown && (
                  <button type="button" onClick={() => copy(shown.parts)}>
                    Copy prompt
                  </button>
                )}
                <button type="button" className="secondary" onClick={close}>
                  Close
                </button>
              </div>
              <div className="prompt-window-body">
                {copied !== null && (
                  <p className={copied ? "ok" : "error"} role="status">
                    {copied ? "Copied to the clipboard." : "Couldn't copy. Select the text and copy it by hand."}
                  </p>
                )}
                {"error" in shown ? (
                  <p className="notice">{shown.error}</p>
                ) : (
                  <>
                    {note && <p className="meta">{note}</p>}
                    {shown.parts.system && (
                      <>
                        <h3>System</h3>
                        <pre className="sample">{shown.parts.system}</pre>
                      </>
                    )}
                    <h3>Message</h3>
                    <pre className="sample">{shown.parts.message}</pre>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
