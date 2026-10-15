"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The hamburger menu in the header. Pages add their own entries through <PageMenu>, which are
// shown above the Codex link and the always-present Drafts / Settings links.
export default function SiteMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  // Close after navigating, and when clicking anywhere else.
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);

  return (
    <details className="site-menu" ref={ref}>
      <summary aria-label="Menu" title="Menu">
        ☰
      </summary>
      <div className="site-menu-items">
        <div id="page-menu-slot" className="menu-group" />
        <div id="page-menu-codex-slot" className="menu-group" />
        <div className="menu-group">
          <Link href="/drafts">Drafts</Link>
          <Link href="/settings">Settings</Link>
        </div>
      </div>
    </details>
  );
}

// Put entries (links) into the header menu. `codexHref` adds the Codex link in its own group.
export function PageMenu({ codexHref, children }: { codexHref?: string; children?: ReactNode }) {
  const [slots, setSlots] = useState<{ page: HTMLElement; codex: HTMLElement } | null>(null);
  useEffect(() => {
    const page = document.getElementById("page-menu-slot");
    const codex = document.getElementById("page-menu-codex-slot");
    if (page && codex) setSlots({ page, codex });
  }, []);
  if (!slots) return null;
  return (
    <>
      {children && createPortal(children, slots.page)}
      {codexHref && createPortal(<Link href={codexHref}>Codex</Link>, slots.codex)}
    </>
  );
}
