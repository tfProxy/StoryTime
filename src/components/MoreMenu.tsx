"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A small "⋯" dropdown for a row of actions: closes when an entry is picked or when clicking elsewhere.
export default function MoreMenu({ label = "More", children }: { label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);
  return (
    <details className="more-menu" ref={ref}>
      <summary aria-label={label} title={label}>
        ⋯
      </summary>
      <div className="more-menu-items" onClick={(e) => (e.target as Element).closest("a") && ref.current && (ref.current.open = false)}>
        {children}
      </div>
    </details>
  );
}
