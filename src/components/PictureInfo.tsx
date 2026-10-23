"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/copyText";
import { pictureDetails, pictureMarkdown, type Picture, type StartRequest } from "./pictures";

type Props = {
  picture: Picture;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  onClose: () => void;
  /** Puts the picture's prompt and settings back in the prompt boxes. */
  onLoadPrompt?: () => void;
  /** Makes new pictures starting from this one: redrawn from the prompt, or edited by instruction. */
  onStart?: (mode: StartRequest) => void;
  /** Why it can't be edited by instruction now (no edit model installed), or null. */
  editBlocked?: string | null;
};

/**
 * Everything a picture was made with, to make it again here or elsewhere: its prompts and settings, with
 * buttons to copy the prompts, or all of it as Markdown. A modal <dialog>, also over the full-size viewer.
 */
export default function PictureInfo({ picture, titles, onClose, onLoadPrompt, onStart, editBlocked = null }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState<{ ok: boolean; text: string; what: string } | null>(null);
  // The button last copied from says so.
  const label = (what: string, text: string) => (copied?.ok && copied.what === what ? "Copied ✓" : text);
  const details = pictureDetails(picture, titles);

  // Closing it removes it rather than calling close(), so the focus is put back by hand (on ☰, usually).
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    // Without scrolling: Load prompt, Redraw from this and Edit this scroll up to the prompt as Info closes.
    return () => back?.focus({ preventScroll: true });
  }, []);

  async function copy(text: string, what: string) {
    const ok = await copyText(text, dialog.current ?? undefined);
    setCopied(ok ? { ok, what, text: `Copied ${what}.` } : { ok, what, text: "Couldn't copy. Select the text and copy it by hand." });
  }

  return (
    <dialog
      ref={dialog}
      className="picture-info"
      aria-labelledby="picture-info-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="picture-info-top">
        <h2 id="picture-info-title">Picture info</h2>
        <button type="button" className="secondary" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>
      {picture.instruction && (
        <div className="picture-info-field">
          <h3>Edit instruction</h3>
          <p className="picture-info-text">{picture.instruction}</p>
        </div>
      )}
      <div className="picture-info-field">
        <h3>Prompt</h3>
        <p className="picture-info-text">{picture.prompt}</p>
      </div>
      <div className="picture-info-field">
        <h3>Negative prompt</h3>
        <p className="picture-info-text">{picture.negative || <span className="meta">None</span>}</p>
      </div>
      <dl className="picture-info-details">
        {details.map((d) => (
          <div key={d.label}>
            <dt>{d.label}</dt>
            <dd>{d.value}</dd>
          </div>
        ))}
      </dl>
      <div className="row picture-info-actions">
        <button type="button" onClick={() => void copy(picture.prompt, "the prompt")}>
          {label("the prompt", "Copy prompt")}
        </button>
        {picture.negative && (
          <button type="button" className="secondary" onClick={() => void copy(picture.negative, "the negative prompt")}>
            {label("the negative prompt", "Copy negative prompt")}
          </button>
        )}
        <button type="button" className="secondary" onClick={() => void copy(pictureMarkdown(picture, titles), "everything as Markdown")}>
          {label("everything as Markdown", "Copy all as Markdown")}
        </button>
      </div>
      {/* Straight under the buttons, so it is in view on a phone too. */}
      {copied && (
        <p className={copied.ok ? "ok" : "error"} role="status" style={{ margin: 0 }}>
          {copied.text}
        </p>
      )}
      {(onLoadPrompt || onStart) && (
        <div className="row picture-info-actions">
          {onLoadPrompt && (
            <button type="button" className="secondary" onClick={onLoadPrompt} title="Put this picture's prompt and settings back in the prompt boxes">
              Load prompt
            </button>
          )}
          {onStart && (
            <>
              <button type="button" className="secondary" onClick={() => onStart("redraw")} title="Make new pictures from the prompt, starting from this one">
                Redraw from this
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => onStart("edit")}
                disabled={editBlocked !== null}
                title={editBlocked ?? "Change this picture by telling an edit model what to change"}
              >
                Edit this
              </button>
              <button type="button" className="secondary" onClick={() => onStart("refine")} title="Paint on this picture and mask the parts to change">
                Refine…
              </button>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
