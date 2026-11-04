"use client";

import type { ReactNode } from "react";

/** A section of a codex entry's page that folds: a heading in the summary, the body when open. */
export default function EntryFold({
  title,
  note,
  id,
  open,
  onToggle,
  className,
  children,
}: {
  title: string;
  /** Small text after the heading (a count). */
  note?: ReactNode;
  id?: string;
  /** Open when first shown, or, with `onToggle`, whether it is open now (so a menu can open it). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      className={["entry-section", "entry-fold", className].filter(Boolean).join(" ")}
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary>
        <h2>{title}</h2>
        {note && <span className="meta">{note}</span>}
      </summary>
      <div className="entry-fold-body">{children}</div>
    </details>
  );
}
