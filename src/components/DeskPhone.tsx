"use client";

import { useSyncExternalStore } from "react";
import { FORM_ASPECT, TYPE_LABELS, type CodexEntry, type LiveFact } from "@/lib/codex";
import { AiText } from "./CodexEntryPage";

/** The app's phone width (as the chapter picker's sheet): the desk shows only the chapter's box, and a bottom bar. */
export const PHONE = "(max-width: 640px)";

const subscribe = (onChange: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
};

/** True at phone width. False on the server and while hydrating, so the first render matches the server's. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
}

/** What a phone shows over the chapter's box. Illustrate is the desk's Illustrate mode, so it isn't one of these. */
export type PhoneSheet = "path" | "codex" | "next";

const TITLES: Record<PhoneSheet, string> = { path: "The path so far", codex: "Codex", next: "What happens next?" };

/**
 * The desk on a phone: the bar along the bottom (Path, Write, Codex, Illustrate, Next), the head of the panel open
 * over the box (its name and ×), and the codex entry a row opens there, to read. The panels themselves are the desk's
 * own parts (the path, the codex list, "What happens next?", Illustrate mode), shown full screen by the CSS for
 * `.desk-phone-<sheet>`, so what they hold, and the box under them, stays as it was while they open and close.
 * Rendered only at phone width (`usePhone`).
 */
export default function DeskPhone({
  sheet,
  onSheet,
  illus,
  canIllustrate,
  onIllustrate,
  pathCount,
  choices,
  entry,
  asOf,
  onCloseEntry,
}: {
  sheet: PhoneSheet | null;
  onSheet: (s: PhoneSheet | null) => void;
  /** The desk is in Illustrate mode: it is the panel open. */
  illus: boolean;
  /** False on a chapter not posted yet. */
  canIllustrate: boolean;
  onIllustrate: (on: boolean) => void;
  /** The earlier chapters on the path. */
  pathCount: number;
  /** The chapter's choices; null on a chapter not posted yet. */
  choices: number | null;
  /** The codex entry open, shown over the codex list. */
  entry?: CodexEntry;
  /** "as of “<chapter>”", or "as of the new chapter". */
  asOf: string;
  onCloseEntry: () => void;
}) {
  const open = (s: PhoneSheet | null) => {
    if (illus) onIllustrate(false);
    onSheet(sheet === s ? null : s);
  };
  const title = illus ? "Illustrate" : sheet ? TITLES[sheet] : null;
  const reading = sheet === "codex" && entry;
  const tab = (label: string, on: boolean, onClick: () => void, off?: string) => (
    <button type="button" className={on ? "on" : undefined} aria-pressed={on} disabled={!!off} title={off} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <>
      {title && (
        <div className="desk-sheet-head">
          {reading ? (
            <button type="button" className="secondary desk-sheet-back" onClick={onCloseEntry}>
              ‹ Codex
            </button>
          ) : (
            <h2>{title}</h2>
          )}
          <button
            type="button"
            className="secondary desk-close"
            aria-label="Close"
            title="Close"
            onClick={() => (illus ? onIllustrate(false) : onSheet(null))}
          >
            ×
          </button>
        </div>
      )}
      {reading && <EntryToRead entry={entry} asOf={asOf} />}
      <nav className="desk-tabbar" aria-label="The desk">
        {tab("Path", sheet === "path", () => open("path"), pathCount === 0 ? "This is the story's first chapter" : undefined)}
        {tab("Write", !sheet && !illus, () => open(null))}
        {tab("Codex", sheet === "codex", () => open("codex"))}
        {tab(
          "Illustrate",
          illus,
          () => {
            onSheet(null);
            onIllustrate(!illus);
          },
          canIllustrate ? undefined : "Post the chapter first",
        )}
        {tab(choices === null ? "Next" : `Next ${choices}`, sheet === "next", () => open("next"), choices === null ? "Post the chapter first" : undefined)}
      </nav>
    </>
  );
}

/**
 * A codex entry on a phone, to read: what the AI is told (the Preview tab's text) and its facts. Changing it is for a
 * wide screen, where the entry column has the forms.
 */
function EntryToRead({ entry, asOf }: { entry: CodexEntry; asOf: string }) {
  const facts = entry.facts.filter((f) => f.aspect.trim().toLowerCase() !== FORM_ASPECT);
  const now = facts.filter((f) => !f.form || f.form === entry.form?.name);
  const other = facts.filter((f) => !now.includes(f));
  const list = (fs: LiveFact[]) => (
    <dl className="desk-read-facts">
      {fs.map((f) => (
        <div key={f.fact_id}>
          <dt>
            {f.aspect}
            {f.form && <small> · {f.form}</small>}
          </dt>
          <dd>{f.text}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section className="desk-phone-entry" aria-label={`Codex entry: ${entry.name}`}>
      <h2 className="desk-entry-name-text">{entry.name}</h2>
      <p className="meta">
        {TYPE_LABELS[entry.type]} · {asOf}{entry.form ? ` · ${entry.form.name}` : ""}
      </p>
      <h3>What the AI is told</h3>
      <AiText entry={entry} />
      <p className="meta">
        Sent with the prompt when {entry.name} is named or a keyword appears nearby{entry.always_include ? " (always, here)" : ""}.
      </p>
      <h3>Facts</h3>
      {now.length === 0 ? <p className="meta">No facts yet.</p> : list(now)}
      {other.length > 0 && (
        <details>
          <summary>Other forms ({other.length})</summary>
          {list(other)}
        </details>
      )}
      <p className="meta">Facts are changed on a wider screen.</p>
    </section>
  );
}
