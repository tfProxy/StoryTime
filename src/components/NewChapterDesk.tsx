"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import ChapterEditor from "./ChapterEditor";
import { DeskBar } from "./WritingDesk";

/**
 * The writing desk for a chapter not posted yet (a choice's, or a story's first): the chapter's box with Post chapter,
 * and the codex column waiting for a later step (holding codex changes in the draft).
 */
export default function NewChapterDesk({ bar, editor }: { bar: ReactNode; editor: Omit<ComponentProps<typeof ChapterEditor>, "desk"> }) {
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <DeskBar bar={bar} note={note} onSlot={setMenuSlot} />
      <div className="desk">
        <aside className="desk-side" aria-label="Codex">
          <p className="meta">Codex changes for a new chapter come in a later step.</p>
        </aside>
        <div className="desk-story">
          <h1 className="visually-hidden">New chapter</h1>
          <ChapterEditor {...editor} desk={{ onText: () => {}, menuSlot, onNote: setNote }} />
        </div>
      </div>
    </>
  );
}
