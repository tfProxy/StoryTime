// How a generated (or revised) chapter goes into a draft. Pure, so both the writing page and the work queue (which
// finishes a Generate into the draft when the page is gone) do exactly the same thing.
import type { Draft } from "./drafts";

export const MAX_UNDO = 20;
export const MAX_VERSIONS = 20;

/** A new generated or revised draft gets its own version; the text it started from is kept as the one before it. */
export function startVersion(d: Draft): Pick<Draft, "versions" | "versionIndex"> {
  if (!d.body.trim()) return {};
  const kept = [...(d.versions ?? [{ title: d.title, body: d.body }])];
  kept[d.versionIndex ?? kept.length - 1] = { title: d.title, body: d.body };
  const versions = [...kept, { title: "", body: "" }].slice(-MAX_VERSIONS);
  return { versions, versionIndex: versions.length - 1 };
}

/** The undo list with the current text added (nothing is added for an empty draft). */
export function pushUndo(d: Draft): Draft["undo"] {
  if (!d.title && !d.body) return d.undo;
  return [...d.undo, { title: d.title, body: d.body }].slice(-MAX_UNDO);
}

/** What happens when a Generate starts: the text now in the draft is kept as the previous version and in undo. */
export function beginGenerated(d: Draft): Draft {
  return { ...d, undo: pushUndo(d), ...startVersion(d) };
}

/**
 * Puts generated text into the draft: what the page does when a Generate starts and streams. Unless `continued`
 * (the text is a longer version of what an earlier call already put in), the draft's text is kept first as the
 * previous version and in undo. A title still arriving (`null`) leaves the title as it is.
 */
export function applyGenerated(d: Draft, text: { title: string | null; body: string }, opts: { continued?: boolean } = {}): Draft {
  const base = opts.continued ? d : beginGenerated(d);
  return { ...base, ...(text.title !== null ? { title: text.title } : {}), body: text.body };
}

/**
 * What follows a Generate: the choice text for the previous chapter, only when the author hasn't written any, and
 * suggested choices for this chapter's ending, only when the author hasn't typed any choices.
 */
export function applyAfterGenerate(d: Draft, after: { choiceLabel?: string; suggestions?: string[] }): Draft {
  let next = d;
  if (after.choiceLabel && !d.newChoiceLabel.trim()) next = { ...next, newChoiceLabel: after.choiceLabel };
  if (after.suggestions && !d.choices.some((c) => c.trim())) next = { ...next, suggestions: after.suggestions };
  return next;
}
