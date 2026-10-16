"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Summaries in the outline: each chapter has its own toggle, and one button shows or hides them all.
// `n` counts how often "all" was pressed, so a chapter opened or closed by hand follows the next press.
const Ctx = createContext<{ open: boolean; n: number; setAll: (open: boolean) => void }>({ open: false, n: 0, setAll: () => {} });

export function SummaryProvider({ children }: { children: ReactNode }) {
  const [all, setAll] = useState({ open: false, n: 0 });
  return (
    <Ctx.Provider value={{ ...all, setAll: (open) => setAll((a) => ({ open, n: a.n + 1 })) }}>{children}</Ctx.Provider>
  );
}

export function ToggleAllSummaries() {
  const { open, setAll } = useContext(Ctx);
  return (
    <button type="button" className="secondary" onClick={() => setAll(!open)}>
      {open ? "Hide all summaries" : "Show all summaries"}
    </button>
  );
}

// Sits inside the chapter's row, which is the <summary> of its branch, so clicks must not fold the branch.
// `children` (the 'read to here' link) sit right after the button. `via` is the choice that was taken to reach the chapter; it is shown ahead of the summary.
export function NodeSummary({ summary, via, children }: { summary: string | null; via: string | null; children?: ReactNode }) {
  const { open: allOpen, n } = useContext(Ctx);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (n > 0) setOpen(allOpen);
  }, [allOpen, n]);
  return (
    <>
      <span className="meta outline-actions">
        [
        <button
          type="button"
          className="outline-action"
          aria-expanded={open}
          title={open ? "Hide this chapter's summary" : "Show this chapter's summary"}
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          summary
        </button>
        {", "}
        {children}
        ]
      </span>
      {open && (
        <span className="outline-summary" onClick={(e) => e.preventDefault()}>
          {via && <strong className="outline-via">{via}</strong>}
          {summary?.trim() || "No summary yet."}
        </span>
      )}
    </>
  );
}
