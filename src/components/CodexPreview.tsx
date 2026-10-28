"use client";

import { useState } from "react";
import {
  budgetFor,
  codexBudget,
  codexKey,
  codexTrigger,
  explainCodex,
  type CodexOverrides,
  type CodexStatus,
  type StoryContext,
} from "@/lib/ai/prompts";

type Props = {
  ctx: StoryContext;
  /** What the author has typed about what should happen; it can mention entries too. */
  direction: string;
  contextTokens: number;
  overrides: CodexOverrides;
  onChange: (next: CodexOverrides) => void;
  /** Opens an entry for editing (by entry id); without it entries can only be read here. */
  onEdit?: (entryId: string) => void;
  onNew?: () => void;
  /** Ids of entries added or changed in the draft (not saved until it is posted). */
  held?: string[];
};

function why(r: CodexStatus): string {
  if (r.state === "excluded") return "left out by you";
  if (r.state === "too-long") return "doesn't fit in the context budget";
  if (r.pinned) return "added by you";
  return r.auto === "always" ? "always included" : "mentioned in the recent text";
}

// Shows which codex entries will be sent with the next prompt and lets the author add or drop them.
export default function CodexPreview({ ctx, direction, contextTokens, overrides, onChange, onEdit, onNew, held }: Props) {
  // The entry whose description is shown.
  const [open, setOpen] = useState<string | null>(null);
  const entries = ctx.codex ?? [];
  if (entries.length === 0) {
    return onNew ? (
      <p className="meta">
        No codex entries yet.{" "}
        <button type="button" className="linkish" onClick={onNew}>
          Add one
        </button>{" "}
        so the AI remembers characters, places and facts.
      </p>
    ) : null;
  }

  const rows = explainCodex(entries, codexTrigger(ctx, direction), codexBudget(budgetFor(contextTokens)), overrides);
  const used = rows.filter((r) => r.state === "included");
  const wanted = rows.filter((r) => r.state === "too-long");
  const excluded = rows.filter((r) => r.state === "excluded");
  const others = rows.filter((r) => r.state === "off");

  const without = (list: string[], key: string) => list.filter((k) => k !== key);
  const add = (key: string) => onChange({ include: [...without(overrides.include, key), key], exclude: without(overrides.exclude, key) });
  const leaveOut = (r: CodexStatus) => {
    const key = codexKey(r.entry);
    onChange(
      r.pinned
        ? { include: without(overrides.include, key), exclude: overrides.exclude }
        : { include: overrides.include, exclude: [...without(overrides.exclude, key), key] },
    );
  };
  const putBack = (key: string) => onChange({ include: overrides.include, exclude: without(overrides.exclude, key) });

  const row = (r: CodexStatus, action: { label: string; run: () => void }) => {
    const key = codexKey(r.entry);
    const shown = open === key;
    const id = r.entry.id;
    return (
      <li key={key} className="codex-pick codex-entry">
        <span className="codex-entry-name">
          <button type="button" className="linkish" aria-expanded={shown} onClick={() => setOpen(shown ? null : key)}>
            <strong>{r.entry.name}</strong>
          </button>{" "}
          <span className="meta">[{r.entry.type}]</span>{" "}
          <span className="tag">· {r.state === "off" ? "not mentioned" : why(r)}</span>
          {id && held?.includes(id) && <span className="tag"> · changed in this draft</span>}
        </span>
        <span className="row">
          {onEdit && id && (
            <button type="button" className="secondary" onClick={() => onEdit(id)}>
              Edit
            </button>
          )}
          <button type="button" className="secondary" onClick={action.run}>
            {action.label}
          </button>
        </span>
        {shown && (
          <div className="codex-entry-detail">
            {r.entry.aliases.length > 0 && <div className="meta">Also: {r.entry.aliases.join(", ")}</div>}
            {r.entry.always_include && <div className="meta">Always included in prompts.</div>}
            {/* `content` here is what the AI reads (the entry's form and facts), never the owner's notes. */}
            <p>{r.entry.content || <em>No facts yet</em>}</p>
          </div>
        )}
      </li>
    );
  };

  return (
    <details className="codex-preview">
      <summary>
        Codex for this prompt: {used.length} of {entries.length} entr{entries.length === 1 ? "y" : "ies"}
        {used.length > 0 && <span className="meta"> ({used.map((r) => r.entry.name).join(", ")})</span>}
      </summary>
      <p className="meta">
        Entries are picked when they are &ldquo;always included&rdquo; or their name appears in the premise, the last few
        chapters, the choice or what you type above. This list updates as you type. Click a name to read its entry.
      </p>
      {used.length + wanted.length + excluded.length > 0 && (
        <ul className="codex-picks">
          {used.map((r) => row(r, { label: "Leave out", run: () => leaveOut(r) }))}
          {wanted.map((r) => row(r, { label: "Leave out", run: () => leaveOut(r) }))}
          {excluded.map((r) => row(r, { label: "Put back", run: () => putBack(codexKey(r.entry)) }))}
        </ul>
      )}
      {used.length === 0 && <p className="meta">No entries will be sent. Add some below if the AI should know about them.</p>}
      {others.length > 0 && (
        <>
          <h3 className="codex-other">Other entries</h3>
          <ul className="codex-picks">{others.map((r) => row(r, { label: "Add", run: () => add(codexKey(r.entry)) }))}</ul>
        </>
      )}
      {onNew && (
        <button type="button" className="secondary" onClick={onNew}>
          + New entry
        </button>
      )}
    </details>
  );
}
