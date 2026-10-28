"use client";

import Link from "next/link";
import { ENTRY_TYPES, TYPE_HEADINGS, TYPE_LABELS, type CodexEntry } from "@/lib/codex";

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
};

/** The compact list of a codex's entries, grouped by type: every place that lists entries uses it, and each card opens the entry's page. */
export default function CodexEntryCards({ entries, chapterId, storyId, pictures = {}, held = {}, onOpen, empty }: Props) {
  if (entries.length === 0) return empty ? <p className="meta">{empty}</p> : null;
  return (
    <>
      {ENTRY_TYPES.map((type) => {
        const group = entries.filter((e) => e.type === type);
        if (group.length === 0) return null;
        return (
          <section key={type}>
            <h2>{TYPE_HEADINGS[type]}</h2>
            <ul className="entry-cards">
              {group.map((e) => {
                const picture = pictures[e.entry_id];
                const wait = held[e.entry_id];
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
                      <span className="entry-card-desc">{e.description || <em>No facts yet</em>}</span>
                    </span>
                  </>
                );
                return (
                  <li key={e.entry_id}>
                    {onOpen ? (
                      <button type="button" className="entry-card" onClick={() => onOpen(e)}>
                        {inner}
                      </button>
                    ) : (
                      <Link className="entry-card" href={`/s/${storyId}/codex/${e.entry_id}?at=${chapterId}`}>
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
