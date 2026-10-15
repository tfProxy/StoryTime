"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
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
    // Picking an entry closes the menu. A native listener, because entries added through
    // PageMenu are portals and their clicks don't bubble through this component in React.
    const picked = (e: MouseEvent) => {
      if (ref.current && (e.target as Element).closest("a, button")) ref.current.open = false;
    };
    const items = ref.current?.querySelector(".site-menu-items");
    document.addEventListener("click", away);
    items?.addEventListener("click", picked as EventListener);
    return () => {
      document.removeEventListener("click", away);
      items?.removeEventListener("click", picked as EventListener);
    };
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

// Put entries into the header menu. `codexHref` (a link) or `onCodex` (a button) adds Codex in its own group.
export function PageMenu({ codexHref, onCodex, children }: { codexHref?: string; onCodex?: () => void; children?: ReactNode }) {
  // False while rendering on the server and hydrating; the header's slots only exist in the browser.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const page = mounted ? document.getElementById("page-menu-slot") : null;
  const codex = mounted ? document.getElementById("page-menu-codex-slot") : null;
  if (!page || !codex) return null;
  const slots = { page, codex };
  return (
    <>
      {children && createPortal(children, slots.page)}
      {codexHref && createPortal(<Link href={codexHref}>Codex</Link>, slots.codex)}
      {onCodex &&
        createPortal(
          <button type="button" className="menu-item" onClick={onCodex}>
            Codex
          </button>,
          slots.codex,
        )}
    </>
  );
}
