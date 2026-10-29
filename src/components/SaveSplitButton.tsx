"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * How the page saves. The edit page: just the edit; the edit and the chapters below go to the trash; or only the move to
 * the trash. A new chapter's page: post it, or discard the draft.
 */
export type SaveMode = "save" | "replace" | "trash" | "discard";

type Mode = { id: SaveMode; label: string; button: string; hint: string };

const EDIT_MODES: Mode[] = [
  { id: "save", label: "Save changes", button: "Save changes", hint: "Saves your edit." },
  { id: "replace", label: "Replace branch…", button: "Replace branch", hint: "Saves your edit and moves the chapters below this one to the trash; their choices stay, unwritten." },
  { id: "trash", label: "Move to trash…", button: "Move to trash", hint: "Moves this chapter and everything below it to the trash. Your edits here are not saved." },
];

const POST_MODES: Mode[] = [
  { id: "save", label: "Post chapter", button: "Post chapter", hint: "Adds the chapter to the story." },
  { id: "discard", label: "Discard draft…", button: "Discard draft", hint: "Deletes this draft and everything saved with it. This can't be undone." },
];

// [ Save changes | ▾ ] for the edit page, [ Post chapter | ▾ ] for a new chapter. The ▾ opens a menu of modes; picking
// one changes the main button's label and colour, and the main button then does that mode (the caller asks "are you
// sure" for the ones that move chapters or discard the draft).
export default function SaveSplitButton({
  variant = "edit",
  mode,
  onMode,
  canReplace = false,
  canTrash = false,
  busyLabel,
  disabled,
  onMain,
}: {
  /** "edit" for the edit page; "post" for a new chapter's draft. */
  variant?: "edit" | "post";
  mode: SaveMode;
  onMode: (mode: SaveMode) => void;
  /** The chapter has written chapters below it. */
  canReplace?: boolean;
  /** Not the story's first chapter. */
  canTrash?: boolean;
  /** Shown on the main button instead of its label while it works; null when idle. */
  busyLabel: string | null;
  disabled: boolean;
  onMain: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const modes =
    variant === "post" ? POST_MODES : EDIT_MODES.filter((m) => m.id === "save" || (m.id === "replace" ? canReplace : canTrash));
  const verb = variant === "post" ? "post" : "save";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      more.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Arrow keys move between the menu's items.
  function onMenuKey(e: ReactKeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const style = mode === "trash" || mode === "discard" ? "danger" : mode === "replace" ? "warning" : undefined;
  return (
    <div className="split-button" ref={wrap}>
      <button type="button" className={style} onClick={onMain} disabled={disabled}>
        {busyLabel ?? (modes.find((m) => m.id === mode) ?? modes[0]).button}
      </button>
      <button
        ref={more}
        type="button"
        className={`split-more ${style ?? ""}`}
        aria-label={`More ways to ${verb}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={busyLabel !== null}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="split-menu" role="menu" aria-label={`Ways to ${verb}`}onKeyDown={onMenuKey}>
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={mode === m.id}
              onClick={() => {
                onMode(m.id);
                setOpen(false);
                more.current?.focus();
              }}
            >
              {m.label}
              <small>{m.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
