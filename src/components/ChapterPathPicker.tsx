"use client";

import { Fragment, useState } from "react";
import { DRAFT_ANCHOR } from "@/lib/codex";

type PathChapter = { id: string; title: string };

type Props = {
  /** The chapters on this branch, first chapter first, ending at the current one (with `draft`: the posted chapters before the one being written). */
  path: PathChapter[];
  /** The current chapter (the last of `path`; ignored with `draft`). */
  currentId: string;
  /** The chosen chapter's id (with `draft`, DRAFT_ANCHOR means the chapter being written). */
  value: string;
  onChange: (id: string) => void;
  /** On the writing page the current chapter is not posted yet: "This chapter" is DRAFT_ANCHOR, saved when the chapter is posted. */
  draft?: boolean;
};

/**
 * "Takes effect from": a few quick choices (this chapter, the previous one, the start) and, under "Earlier…", the whole
 * path to pick from. Only chapters on the current branch are offered. The value is the chosen chapter's id.
 */
export default function ChapterPathPicker({ path, currentId, value, onChange, draft = false }: Props) {
  const [showPath, setShowPath] = useState(false);

  const upToHere = (() => {
    const at = path.findIndex((c) => c.id === currentId);
    return at < 0 ? path : path.slice(0, at + 1);
  })();
  const chapters: PathChapter[] = draft ? [...path, { id: DRAFT_ANCHOR, title: "This chapter (not posted yet)" }] : upToHere;
  const cur = chapters.length - 1;
  const chosenAt = chapters.findIndex((c) => c.id === value);
  const nameOf = (c: PathChapter) => (c.id === DRAFT_ANCHOR ? "the chapter you’re writing" : `“${c.title}”`);

  const hasPrevious = cur >= 1;
  // With two chapters the start is the previous chapter, so it is offered once.
  const hasStart = cur >= 2;
  const hasEarlier = chapters.length > 3;
  const isQuick = chosenAt === cur || (hasPrevious && chosenAt === cur - 1) || (hasStart && chosenAt === 0);
  // The path stays open while the chosen chapter is not one of the quick choices.
  const pathOpen = hasEarlier && (showPath || (chosenAt >= 0 && !isQuick));

  const pill = (key: string, label: string, on: boolean, onClick: () => void) => (
    <button key={key} type="button" className="chapter-picker-pill" aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );

  function pick(i: number, keepPath = false) {
    if (!keepPath) setShowPath(false);
    onChange(chapters[i].id);
  }

  let explain: string;
  if (chosenAt < 0) explain = "";
  else {
    const chosen = chapters[chosenAt];
    const n = cur - chosenAt + 1;
    explain =
      chosenAt === 0
        ? "Applies to the whole story on this branch"
        : `Applies from ${nameOf(chosen)} on: ${n === 1 ? "this chapter" : `${n} chapters up to here`} and every chapter after it on this branch`;
    if (draft) explain += chosen.id === DRAFT_ANCHOR ? ". Saved when you post it" : ". Saved now, and it reaches every branch below it";
  }

  return (
    <div className="chapter-picker">
      <span className="chapter-picker-label">
        Takes effect from
      </span>
      <div className="chapter-picker-body">
        <div className="chapter-picker-pills" role="group" aria-label="Takes effect from">
          {pill("here", "This chapter", chosenAt === cur && !pathOpen, () => pick(cur))}
          {hasPrevious && pill("previous", `Previous chapter (${chapters[cur - 1].title})`, chosenAt === cur - 1 && !pathOpen, () => pick(cur - 1))}
          {hasStart && pill("start", "The start", chosenAt === 0 && !pathOpen, () => pick(0))}
          {hasEarlier &&
            pill("earlier", "Earlier…", pathOpen, () => {
              setShowPath(true);
              // Something earlier than the quick choices to start from, so the pressed pill and the tint mean something.
              if (isQuick) pick(cur - 2, true);
            })}
        </div>
        {pathOpen && (
          <div className="chapter-picker-path" role="group" aria-label="Chapters on this branch">
            {chapters.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 && (
                  <span className="chapter-picker-sep" aria-hidden="true">
                    ›
                  </span>
                )}
                <button
                  type="button"
                  className="chapter-picker-chapter"
                  data-tint={i === chosenAt ? "chosen" : i > chosenAt ? "after" : undefined}
                  aria-pressed={i === chosenAt}
                  onClick={() => pick(i, true)}
                >
                  {i === cur && !draft ? `${c.title} (this chapter)` : c.title}
                </button>
              </Fragment>
            ))}
          </div>
        )}
        {explain && (
          <small className="chapter-picker-explain" aria-live="polite">
            {explain}
          </small>
        )}
      </div>
    </div>
  );
}
