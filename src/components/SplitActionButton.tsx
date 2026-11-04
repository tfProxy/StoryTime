"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type SplitMode = { id: string; label: string; hint: string };

/**
 * [ main action | ▾ ]: the same combo button as the "Post chapter" one (see SaveSplitButton). The ▾ opens a menu of
 * actions; picking one changes the main button's label, and the main button then does that action.
 */
export default function SplitActionButton({
  modes,
  mode,
  onMode,
  onMain,
  busyLabel = null,
  disabled = false,
  secondary = false,
  verb,
  startAligned = false,
}: {
  modes: SplitMode[];
  mode: string;
  onMode: (id: string) => void;
  onMain: () => void;
  /** Shown on the main button instead of its label while it works; null when idle. */
  busyLabel?: string | null;
  disabled?: boolean;
  /** The quieter button style. */
  secondary?: boolean;
  /** What the menu is for, for screen readers: "continue" gives "More ways to continue". */
  verb: string;
  /** At the left of its row, with the menu opening below it (the default is the right, with the menu above). */
  startAligned?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);

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

  const style = secondary ? "secondary" : "";
  return (
    <div className={`split-button${startAligned ? " split-start" : ""}`} ref={wrap}>
      <button type="button" className={style} onClick={onMain} disabled={disabled}>
        {busyLabel ?? (modes.find((m) => m.id === mode) ?? modes[0]).label}
      </button>
      <button
        ref={more}
        type="button"
        className={`split-more ${style}`}
        aria-label={`More ways to ${verb}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={busyLabel !== null}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="split-menu" role="menu" aria-label={`Ways to ${verb}`} onKeyDown={onMenuKey}>
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
