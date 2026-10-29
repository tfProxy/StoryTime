"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type PickerChapter = {
  id: string;
  title: string;
  /** The chapter this one continues from; null (or a chapter not in the list) for the first chapter. */
  parent_id: string | null;
  /** The label of the choice that leads here. */
  label?: string | null;
};

type Props = {
  /** Every chapter of the story, parents before children; siblings keep this order. */
  chapters: PickerChapter[];
  /** The chosen chapter's id; null or "" is the whole story (with `allowWhole`). */
  value: string | null;
  /** Called with the chosen chapter's id, or null for the whole story. Without it the picker keeps its own choice (for a plain form). */
  onChange?: (id: string | null) => void;
  /** Offer "The whole story" at the top of the panel. */
  allowWhole?: boolean;
  /** The button's id, for a `<label htmlFor>`. */
  id?: string;
  /** The id of the visible label, which names the button together with the chosen chapter. */
  labelledBy?: string;
  /** Adds a hidden input with this name holding the chosen id ("" for the whole story), for a plain form. */
  name?: string;
  /** With `name`: submit the input's form as soon as a chapter is picked. */
  submitOnPick?: boolean;
};

const SEP = " › ";
const FIRST = "The first chapter";

/** `text` with the first match of `query` in a <mark>. */
function highlight(text: string, query: string): ReactNode {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || !query) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * Chooses any chapter of a branching story: a button with the chapter's title and its path, which opens a panel with
 * the story as a tree (the chosen chapter's branch open, the others folded) and a search box. The panel sits under the
 * button; on a phone it is a bottom sheet.
 */
export default function ChapterTreePicker({ chapters, value, onChange, allowWhole = false, id, labelledBy, name, submitOnPick = false }: Props) {
  const [local, setLocal] = useState<string | null>(value || null);
  const current = (onChange ? value : local) || null;
  const [open, setOpen] = useState(false);
  // On a phone the panel is a bottom sheet, put on <body> so nothing on the page (a picture's menu button) sits above it.
  const [sheet, setSheet] = useState(false);
  const [query, setQuery] = useState("");
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { byId, kids, roots, size } = useMemo(() => {
    const byId = new Map(chapters.map((c) => [c.id, c]));
    const kids = new Map<string, PickerChapter[]>();
    const roots: PickerChapter[] = [];
    for (const c of chapters) {
      const parent = c.parent_id && byId.has(c.parent_id) ? c.parent_id : null;
      if (parent) kids.set(parent, [...(kids.get(parent) ?? []), c]);
      else roots.push(c);
    }
    // How many chapters are below each one.
    const size = new Map<string, number>();
    const count = (c: PickerChapter): number => {
      const n = (kids.get(c.id) ?? []).reduce((sum, k) => sum + 1 + count(k), 0);
      size.set(c.id, n);
      return n;
    };
    roots.forEach(count);
    return { byId, kids, roots, size };
  }, [chapters]);

  /** The chapters from the first one down to this one. */
  const lineTo = (chapterId: string | null) => {
    const line: PickerChapter[] = [];
    for (let c = chapterId ? byId.get(chapterId) : undefined; c && line.length <= chapters.length; c = c.parent_id ? byId.get(c.parent_id) : undefined) line.unshift(c);
    return line;
  };
  const pathText = (chapterId: string) => lineTo(chapterId).slice(0, -1).map((c) => c.title).join(SEP) || FIRST;
  const chosen = current ? (byId.get(current) ?? null) : null;
  const onPath = new Set(lineTo(current).map((c) => c.id));

  // The chosen chapter's branch, and the first chapter so its choices show.
  const branchOpen = () => new Set([...roots.map((r) => r.id), ...lineTo(current).map((c) => c.id)]);

  useEffect(() => {
    // Typing is for a mouse and keyboard; on a phone it would bring the keyboard up over the tree.
    if (open && window.matchMedia("(min-width: 641px)").matches) searchRef.current?.focus({ preventScroll: true });
    // A deep story scrolls to the chosen chapter.
    // (Only the tree scrolls, not the page.)
    const body = panelRef.current?.querySelector<HTMLElement>(".chapter-tree-body");
    const here = body?.querySelector<HTMLElement>('[aria-current="true"]');
    if (body && here) body.scrollTop = here.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - body.clientHeight / 2;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setQuery("");
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    buttonRef.current?.focus();
  }

  function toggle() {
    if (open) return close();
    setUnfolded(branchOpen());
    setSheet(window.matchMedia("(max-width: 640px)").matches);
    setOpen(true);
  }

  function pick(chapterId: string | null) {
    setLocal(chapterId);
    onChange?.(chapterId);
    setOpen(false);
    setQuery("");
    if (hiddenRef.current) {
      // Set now rather than at the next render: the form is submitted straight away.
      hiddenRef.current.value = chapterId ?? "";
      if (submitOnPick) hiddenRef.current.form?.requestSubmit();
    }
    buttonRef.current?.focus();
  }

  function fold(chapterId: string) {
    setUnfolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(chapterId)) next.add(chapterId);
      return next;
    });
  }

  const row = (c: PickerChapter): ReactNode => {
    const below = kids.get(c.id) ?? [];
    const isOpen = unfolded.has(c.id);
    return (
      <li key={c.id}>
        <div className="chapter-tree-node">
          {below.length > 0 ? (
            <button
              type="button"
              className="chapter-tree-fold"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Fold" : "Open"} “${c.title}”`}
              onClick={() => fold(c.id)}
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className="chapter-tree-fold" aria-hidden="true" />
          )}
          <button
            type="button"
            className="chapter-tree-chapter"
            data-on-path={onPath.has(c.id) ? "true" : undefined}
            aria-current={c.id === current ? "true" : undefined}
            onClick={() => pick(c.id)}
          >
            <span className="chapter-tree-title">{c.title}</span>
            {below.length > 0 && !isOpen && <span className="chapter-tree-more">{size.get(c.id)} more</span>}
            {c.label && <span className="chapter-tree-choice">“{c.label}”</span>}
          </button>
        </div>
        {below.length > 0 && isOpen && <ul>{below.map(row)}</ul>}
      </li>
    );
  };

  const q = query.trim();
  const matches = q ? chapters.filter((c) => c.title.toLowerCase().includes(q.toLowerCase())) : [];

  const panel = open && (
    <>
      <div className="chapter-tree-backdrop" onClick={close} aria-hidden="true" />
      <div ref={panelRef} className="chapter-tree-panel" role="dialog" aria-label="Choose a chapter">
        <div className="chapter-tree-head">
          <strong>Choose a chapter</strong>
          <button type="button" className="secondary" onClick={close}>
            Close
          </button>
        </div>
        <div className="chapter-tree-search">
          <input
            ref={searchRef}
            type="search"
            aria-label="Search chapter titles"
            placeholder="Search chapter titles…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chapter-tree-body">
          {q ? (
            matches.length === 0 ? (
              <p className="chapter-tree-empty">No chapter title has “{q}”.</p>
            ) : (
              <ul className="chapter-tree-results">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button type="button" aria-current={c.id === current ? "true" : undefined} onClick={() => pick(c.id)}>
                      <span className="chapter-tree-title">{highlight(c.title, q)}</span>
                      <span className="chapter-tree-path">{pathText(c.id)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Fragment>
              {allowWhole && (
                <button type="button" className="chapter-tree-whole" aria-current={current === null ? "true" : undefined} onClick={() => pick(null)}>
                  The whole story
                </button>
              )}
              <ul>{roots.map(row)}</ul>
            </Fragment>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="chapter-tree-picker">
      {name && <input ref={hiddenRef} type="hidden" name={name} defaultValue={current ?? ""} />}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="chapter-tree-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={labelledBy && id ? `${labelledBy} ${id}-title` : undefined}
        onClick={toggle}
      >
        <span id={id ? `${id}-title` : undefined} className="chapter-tree-button-title">
          {chosen ? chosen.title : "The whole story"}
        </span>
        {chosen && <span className="chapter-tree-button-path">{pathText(chosen.id)}</span>}
        <span className="chapter-tree-button-change">Change…</span>
      </button>
      {sheet && panel ? createPortal(panel, document.body) : panel}
    </div>
  );
}
