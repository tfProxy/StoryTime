"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** How the edit page saves: just the edit; the edit and the chapters below go to the trash; or only the move to the trash. */
export type SaveMode = "save" | "replace" | "trash";

const MODES: { id: SaveMode; label: string; hint: string }[] = [
  { id: "save", label: "Save changes", hint: "Saves your edit." },
  { id: "replace", label: "Replace branch…", hint: "Saves your edit and moves the chapters below this one to the trash; their choices stay, unwritten." },
  { id: "trash", label: "Move to trash…", hint: "Moves this chapter and everything below it to the trash. Your edits here are not saved." },
];

const BUTTON_LABEL: Record<SaveMode, string> = { save: "Save changes", replace: "Replace branch", trash: "Move to trash" };

// [ Save changes | ▾ ] for the edit page. The ▾ opens a menu of modes; picking one changes the main button's label and
// colour, and the main button then does that mode (the caller asks "are you sure" for the two that move chapters).
export default function SaveSplitButton({
  mode,
  onMode,
  canReplace,
  canTrash,
  busyLabel,
  disabled,
  onMain,
}: {
  mode: SaveMode;
  onMode: (mode: SaveMode) => void;
  /** The chapter has written chapters below it. */
  canReplace: boolean;
  /** Not the story's first chapter. */
  canTrash: boolean;
  /** Shown on the main button instead of its label while it works; null when idle. */
  busyLabel: string | null;
  disabled: boolean;
  onMain: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const modes = MODES.filter((m) => m.id === "save" || (m.id === "replace" ? canReplace : canTrash));

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

  const style = mode === "trash" ? "danger" : mode === "replace" ? "warning" : undefined;
  return (
    <div className="split-button" ref={wrap}>
      <button type="button" className={style} onClick={onMain} disabled={disabled}>
        {busyLabel ?? BUTTON_LABEL[mode]}
      </button>
      <button
        ref={more}
        type="button"
        className={`split-more ${style ?? ""}`}
        aria-label="More ways to save"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={busyLabel !== null}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="split-menu" role="menu" aria-label="Ways to save" onKeyDown={onMenuKey}>
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
