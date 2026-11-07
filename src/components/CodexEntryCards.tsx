"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ENTRY_TYPES, isAiFact, TYPE_HEADINGS, TYPE_LABELS, type CodexEntry, type EntryType } from "@/lib/codex";
import { STALE_FROM } from "@/lib/codexHints";
import CodexGroup from "./CodexGroup";

type Props = {
  entries: CodexEntry[];
  /** The chapter the entries are shown at: cards link to the entry page at this chapter, and mark the entries changed in it. */
  chapterId: string;
  storyId?: string;
  /** Each entry's picture at this chapter, by entry id. */
  pictures?: Record<string, { id: string }>;
  /** Entries with a change waiting in a draft, by entry id (the op that is waiting). */
  held?: Record<string, string>;
  /** Open the entry here instead of linking to its page (the writing page's drawer). */
  onOpen?: (entry: CodexEntry) => void;
  /** Shown when there are no entries. */
  empty?: string;
  /** The Story Bible's version: each type is a fold ("Characters (2) · 2 suggestions") instead of a heading. */
  fold?: boolean;
  /** Under an entry's card: what else belongs to the entry (its suggestions). */
  extra?: (entry: CodexEntry) => ReactNode;
  /** List items for a type's fold, after its cards (things that are not entries yet); a type with no entries is still shown when this returns something. */
  groupExtra?: (type: EntryType) => ReactNode;
  /** The suggestions a type's fold holds, for its summary. */
  groupSuggestions?: (type: EntryType) => number;
  /** How many hints each entry's page shows, by entry id (the Story Bible). */
  hints?: Record<string, number>;
  /** How many chapters mention each entry since its last change, by entry id (the Story Bible). */
  stale?: Record<string, number>;
};

/** "Mentioned in 6 chapters since last updated" on a card, from `STALE_FROM` chapters (`staleAlong` / `staleInTree`). */
export function StaleNote({ n }: { n: number | undefined }) {
  if (!n || n < STALE_FROM) return null;
  return (
    <span className="meta entry-card-line codex-stale" title="Chapters that name it since its last change (chapters the codex check has read don't count)">
      Mentioned in {n} chapters since last updated
    </span>
  );
}

/** The mark on a fact the AI wrote on its own and the owner hasn't approved yet. */
export function AiBadge() {
  return (
    <span className="ai-badge" title="Written by the AI from the story: approve it or edit it">
      AI
    </span>
  );
}

/** "⚠ 2 hints" on a card whose entry's page warns about something. */
export function HintCount({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <span className="codex-hint-count" title="The entry's page says what to fix">
      {" "}
      · ⚠ {n} hint{n === 1 ? "" : "s"}
    </span>
  );
}

/** The compact list of a codex's entries, grouped by type: every place that lists entries uses it, and each card opens the entry's page. */
export default function CodexEntryCards({ entries, chapterId, storyId, pictures = {}, held = {}, onOpen, empty, fold, extra, groupExtra, groupSuggestions, hints = {}, stale = {} }: Props) {
  if (entries.length === 0 && !groupExtra) return empty ? <p className="meta">{empty}</p> : null;
  return (
    <>
      {ENTRY_TYPES.map((type) => {
        const group = entries.filter((e) => e.type === type);
        const more = groupExtra?.(type);
        if (group.length === 0 && !more) return null;
        const list = (
            <>
            <ul className="entry-cards">
              {group.map((e) => {
                const picture = pictures[e.entry_id];
                const wait = held[e.entry_id];
                const ai = e.facts.filter(isAiFact).length;
                const inner = (
                  <>
                    {picture && storyId && (
                      // eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size
                      <img className="codex-thumb" src={`/api/stories/${storyId}/codex-pictures/${picture.id}`} alt="" />
                    )}
                    <span className="entry-card-text">
                      <span>
                        <strong>{e.name}</strong> <span className="meta">{TYPE_LABELS[e.type]}</span>
                        {e.always_include && <span className="tag"> · always included</span>}
                        {e.shared_entry_id && <span className="tag"> · shared</span>}
                        <HintCount n={hints[e.entry_id]} />
                        {ai > 0 && (
                          <span className="tag codex-ai-count">
                            {" "}
                            · {ai} AI {ai === 1 ? "fact" : "facts"} to check
                          </span>
                        )}
                        {wait ? (
                          <span className="tag"> · {wait === "create" ? "new" : "changed"} in this chapter, saved when you post</span>
                        ) : (
                          e.op.anchor_chapter_id === chapterId && <span className="tag"> · changed in this chapter</span>
                        )}
                      </span>
                      <span className="meta entry-card-line">
                        Keywords: {e.aliases.length > 0 ? e.aliases.join(", ") : "none"}
                        {e.form && ` · Form: ${e.form.name}`}
                      </span>
                      <StaleNote n={stale[e.entry_id]} />
                      <span className="entry-card-desc">{e.description || <em>No facts yet</em>}</span>
                    </span>
                  </>
                );
                const below = extra?.(e);
                return (
                  <li key={e.entry_id} className={below ? "entry-with-extra" : undefined}>
                    {onOpen ? (
                      <button type="button" className="entry-card" onClick={() => onOpen(e)}>
                        {inner}
                      </button>
                    ) : (
                      <Link className="entry-card" href={`/s/${storyId}/codex/${e.entry_id}?at=${chapterId}`}>
                        {inner}
                      </Link>
                    )}
                    {below}
                  </li>
                );
              })}
              {more}
            </ul>
          </>
        );
        return fold ? (
          <CodexGroup key={type} title={TYPE_HEADINGS[type]} count={group.length} suggestions={groupSuggestions?.(type) ?? 0}>
            {list}
          </CodexGroup>
        ) : (
          <section key={type}>
            <h2>{TYPE_HEADINGS[type]}</h2>
            {list}
          </section>
        );
      })}
    </>
  );
}
