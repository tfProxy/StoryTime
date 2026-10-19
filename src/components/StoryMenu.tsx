"use client";

import { useRef, type ReactNode } from "react";

// The ☰ menu on a story in the list. Opens below the button and is nudged sideways if it would
// run off the edge of the window (stories at the edge of the grid are narrower than the menu).
export default function StoryMenu({ label, children }: { label: string; children: ReactNode }) {
  const items = useRef<HTMLDivElement>(null);
  return (
    <details
      className="story-menu"
      onToggle={(e) => {
        const el = items.current;
        if (!el || !e.currentTarget.open) return;
        el.style.transform = "";
        const { left, right } = el.getBoundingClientRect();
        const edge = 8;
        const shift = left < edge ? edge - left : right > window.innerWidth - edge ? window.innerWidth - edge - right : 0;
        if (shift) el.style.transform = `translateX(${shift}px)`;
      }}
    >
      <summary aria-label={label}>☰</summary>
      <div className="story-menu-items" ref={items}>
        {children}
      </div>
    </details>
  );
}
