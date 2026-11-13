"use client";

import type { CodexEntry, LiveFact } from "@/lib/codex";
import type { EntryHint } from "@/lib/codexHints";

/** A fact change for a draft to hold (a new chapter's, on the writing desk): no fact_id for a new fact. */
export type HeldFact = { op: "set" | "retire"; aspect: string; form: string; text: string; quote: string; fact_id?: string };

/**
 * Plain warnings about an entry above its facts (never mentioned, long facts, the same aspect written two ways), each
 * with its fix: Edit it, or keep one of two duplicates.
 */
export function EntryHints({
  entry,
  hints,
  busy,
  editing,
  onEdit,
  onRemove,
}: {
  entry: CodexEntry;
  hints: EntryHint[];
  busy: boolean;
  /** The fact being edited, so its "Edit it" is off. */
  editing: string | null;
  onEdit: (factId: string) => void;
  onRemove: (fact: LiveFact) => void;
}) {
  if (hints.length === 0) return null;
  return (
    <div className="notice codex-hints" role="note" aria-label="Hints">
      <ul>
        {hints.map((h) => {
          const dups = h.duplicates?.map((id) => entry.facts.find((f) => f.fact_id === id)).filter((f): f is LiveFact => !!f) ?? [];
          const toEdit = h.edit ? entry.facts.find((f) => f.fact_id === h.edit) : undefined;
          return (
            <li key={h.key}>
              {h.text}
              {(toEdit || dups.length === 2) && (
                <span className="row codex-hint-fix">
                  {toEdit && (
                    <button type="button" className="secondary" disabled={busy || editing === toEdit.fact_id} aria-label={`Edit ${toEdit.aspect || "the fact"}`} onClick={() => onEdit(toEdit.fact_id)}>
                      Edit it
                    </button>
                  )}
                  {dups.length === 2 &&
                    dups.map((keep, i) => {
                      const drop = dups[1 - i];
                      return (
                        <button
                          key={keep.fact_id}
                          type="button"
                          className="secondary"
                          disabled={busy}
                          aria-label={`Keep “${keep.aspect}: ${keep.text}”, remove “${drop.aspect}: ${drop.text}”`}
                          onClick={() => onRemove(drop)}
                        >
                          Keep “{keep.aspect}”
                        </button>
                      );
                    })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
