"use client";

import type { ReactNode } from "react";
import { LIMITS } from "@/lib/limits";
import { copyText } from "@/lib/copyText";
import AutoTextarea from "./AutoTextarea";
import { CopyIcon } from "./PictureIcons";

/** A line shown under the prompt boxes: `ok` is green, otherwise it is an error. */
export type PromptStatus = { ok: boolean; text: string };

type Props = {
  prompt: string;
  negative: string;
  onPrompt: (text: string) => void;
  onNegative: (text: string) => void;
  /** The story's art style, shown under the prompt; empty to show none. */
  artStyle?: string;
  /** The drawing preset's prompt and negative prompt, shown under their boxes when there are any. */
  presetPrompt: string;
  presetNegative: string;
  /** Shown between the Prompt and the Negative prompt boxes. */
  children?: ReactNode;
  /** The status line under the boxes (copying, loading, writing). */
  status: PromptStatus | null;
  /** Called with the result of Copy, for the status line. */
  onStatus: (status: PromptStatus) => void;
  /** An error shown after the status line (the panel's own saving). */
  extraError?: string | null;
  /** The error from keeping the prompt for next time. */
  saveError: string | null;
};

/**
 * The prompt and negative prompt boxes of a picture page, each with a Copy button and the notes on what is
 * added to it, then the status and saving error lines.
 */
export default function PromptFields({ prompt, negative, onPrompt, onNegative, artStyle = "", presetPrompt, presetNegative, children, status, onStatus, extraError = null, saveError }: Props) {
  async function copy(text: string, what: string) {
    const done = await copyText(text);
    onStatus(done ? { ok: true, text: `${what} copied.` } : { ok: false, text: "Couldn't copy; select the text and copy it yourself." });
  }

  return (
    <>
      <div className="image-prompt-result">
        <div className="prompt-field">
          <div className="field-head">
            <label htmlFor="picture-prompt-text">Prompt</label>
            <button type="button" className="secondary icon-button" aria-label="Copy prompt" title="Copy the prompt" onClick={() => void copy(prompt, "Prompt")} disabled={!prompt}>
              <CopyIcon />
            </button>
          </div>
          <AutoTextarea
            id="picture-prompt-text"
            aria-label="Prompt"
            style={{ minHeight: "5rem", fontFamily: "inherit" }}
            maxLength={LIMITS.picturePrompt}
            value={prompt}
            onChange={(e) => onPrompt(e.target.value)}
          />
          {artStyle.trim() && (
            <span className="meta prompt-art-style" title="The story's art style, added to the end of every prompt">
              {artStyle.trim()}
            </span>
          )}
          {presetPrompt.trim() && (
            <span className="meta prompt-art-style" title="The drawing preset's prompt, added to every prompt">
              Preset: {presetPrompt.trim()}
            </span>
          )}
        </div>
        {children}
        <div className="prompt-field">
          <div className="field-head">
            <label htmlFor="picture-negative-text">Negative prompt</label>
            <button type="button" className="secondary icon-button" aria-label="Copy negative prompt" title="Copy the negative prompt" onClick={() => void copy(negative, "Negative prompt")} disabled={!negative}>
              <CopyIcon />
            </button>
          </div>
          <AutoTextarea
            id="picture-negative-text"
            aria-label="Negative prompt"
            style={{ minHeight: "2.6rem", fontFamily: "inherit" }}
            maxLength={LIMITS.picturePrompt}
            value={negative}
            onChange={(e) => onNegative(e.target.value)}
          />
          {presetNegative.trim() && (
            <span className="meta prompt-art-style" title="The drawing preset's negative prompt, added to every negative prompt">
              Preset: {presetNegative.trim()}
            </span>
          )}
        </div>
      </div>
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
      {extraError && <p className="error" style={{ margin: 0 }}>{extraError}</p>}
      {saveError && <p className="error" style={{ margin: 0 }}>Couldn&apos;t keep the prompt for next time: {saveError}</p>}
    </>
  );
}
