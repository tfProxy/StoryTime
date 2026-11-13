"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cameFromDesk, clearDeskMove, readFolds, writeFolds } from "@/lib/deskMove";
import DeskLink from "./DeskLink";
import DeskVia from "./DeskVia";
import Prose from "./Prose";

/** An earlier chapter on the path to the one on the desk. */
export type PathBlock = {
  id: string;
  title: string;
  body: string;
  summary: string | null;
  /** The choice that leads to it; null for the story's first chapter. */
  via: string | null;
  /** It has a draft not used (draftMarks.ts). */
  unused: boolean;
};

/**
 * The path above the chapter's box: each earlier chapter is a block that folds. Folded, it shows its number, title and
 * summary; unfolded, its title and text only. ✎ makes it the chapter on the desk. Opened from outside, every block
 * starts unfolded; after a move within the desk they are folded as they were (see deskMove.ts). "Unfold all" or
 * "Fold all" at the top.
 */
export default function DeskPath({ storyId, blocks, onQuote }: { storyId: string; blocks: PathBlock[]; onQuote?: (words: string) => void }) {
  // Words selected in an unfolded block's text, and the block: "Add as a fact…" shows under that block's text.
  const [picked, setPicked] = useState<{ id: string; words: string } | null>(null);
  const quoting = !!onQuote;
  useEffect(() => {
    if (!quoting) return;
    const onChange = () => {
      const sel = document.getSelection();
      const words = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      const at = (n: Node | null | undefined) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>(".desk-block-text[data-block]");
      const from = at(sel?.anchorNode);
      const id = words && from && from === at(sel?.focusNode) ? from.dataset.block! : null;
      setPicked((p) => (id ? (p?.id === id && p.words === words ? p : { id, words }) : null));
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [quoting]);
  const pathname = usePathname();
  const query = useSearchParams().toString();
  // On the server (a full load is always from outside) and on arriving from outside: all unfolded.
  const [folds, setFolds] = useState<Record<string, boolean>>(() => {
    const all = Object.fromEntries(blocks.map((b) => [b.id, true]));
    if (typeof window === "undefined" || !cameFromDesk(query ? `${pathname}?${query}` : pathname)) return all;
    const kept = readFolds(storyId);
    // A chapter the desk hasn't shown as a block before (the one just left, going down) starts folded.
    return Object.fromEntries(blocks.map((b) => [b.id, kept[b.id] === true]));
  });
  useEffect(() => {
    clearDeskMove();
    writeFolds(storyId, { ...readFolds(storyId), ...folds });
    // Only on arriving: later changes are written as they are made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (blocks.length === 0) return null;
  const set = (next: Record<string, boolean>) => {
    setFolds(next);
    writeFolds(storyId, { ...readFolds(storyId), ...next });
  };
  const anyOpen = blocks.some((b) => folds[b.id]);
  return (
    <section className="desk-path" aria-label="The path so far">
      <div className="row desk-path-head">
        <span className="desk-spacer" />
        <button type="button" className="secondary" onClick={() => set(Object.fromEntries(blocks.map((b) => [b.id, !anyOpen])))}>
          {anyOpen ? "Fold all" : "Unfold all"}
        </button>
      </div>
      {blocks.map((b, i) => {
        const open = !!folds[b.id];
        return (
          <Fragment key={b.id}>
            {b.via && <DeskVia label={b.via} />}
            <article className={open ? "desk-block open" : "desk-block"} aria-label={`Chapter ${i + 1}: ${b.title}`}>
              <div className="desk-block-head">
                <button type="button" className="desk-block-fold" aria-expanded={open} onClick={() => set({ ...folds, [b.id]: !open })}>
                  <strong>
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span> {i + 1} · {b.title}
                  </strong>
                  {!open && <small>{b.summary?.trim() || "No summary yet"}</small>}
                </button>
                {b.unused && <span className="desk-chip draft-mark">Draft not used</span>}
                <DeskLink href={`/c/${b.id}/desk`} className="desk-block-edit" aria-label={`Edit “${b.title}”`} title="Edit this chapter here">
                  ✎
                </DeskLink>
              </div>
              {open && (
                <div className="desk-block-text" data-block={b.id}>
                  <Prose text={b.body} />
                  {onQuote && picked?.id === b.id && (
                    <div className="row desk-block-quote">
                      {/* Pressing it keeps the selection (the focus would clear it). */}
                      <button type="button" className="secondary desk-add-fact" onMouseDown={(e) => e.preventDefault()} onClick={() => onQuote(picked.words)}>
                        Add as a fact…
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
          </Fragment>
        );
      })}
    </section>
  );
}
