// How a generated chapter goes into a draft. Pure, so both the writing page and the work queue (which
// finishes a Generate into the draft when the page is gone) do exactly the same thing.
import type { Draft, DraftVersion } from "./drafts";

export const MAX_UNDO = 20;
export const MAX_VERSIONS = 20;

/** The draft's text as a version or undo step, with the kept AI requests that wrote it. */
export function snapshot(d: Pick<Draft, "title" | "body" | "ai">): DraftVersion {
  return d.ai?.length ? { title: d.title, body: d.body, ai: d.ai } : { title: d.title, body: d.body };
}

/** What a version or undo step puts back into the draft: its text and the requests that wrote it (none for hand-written). */
export function restore(v: DraftVersion): Pick<Draft, "title" | "body" | "ai"> {
  return { title: v.title, body: v.body, ai: v.ai };
}

/**
 * The draft's versions with the one showing refreshed from its text (a draft with none yet has its text as the only
 * one). Each version keeps the prompt that made it.
 */
export function keptVersions(d: Draft): DraftVersion[] {
  const kept = [...(d.versions ?? [snapshot(d)])];
  const at = d.versionIndex ?? kept.length - 1;
  const prompt = kept[at]?.prompt;
  kept[at] = prompt !== undefined ? { ...snapshot(d), prompt } : snapshot(d);
  return kept;
}

/**
 * A new generated draft gets its own version, with the prompt that makes it; the text it started from is kept as the
 * one before it. With no text to keep, the Generate writes into the version showing (the first, in a new draft).
 */
export function startVersion(d: Draft, prompt = d.prompt): Pick<Draft, "versions" | "versionIndex"> {
  if (!d.body.trim()) {
    const versions = [...(d.versions ?? [{ title: "", body: "" }])];
    const at = d.versionIndex ?? versions.length - 1;
    versions[at] = { ...versions[at], prompt };
    return { versions, versionIndex: at };
  }
  const versions = [...keptVersions(d), { title: "", body: "", prompt }].slice(-MAX_VERSIONS);
  return { versions, versionIndex: versions.length - 1 };
}

/** The undo list with the current text added (nothing is added for an empty draft). */
export function pushUndo(d: Draft): Draft["undo"] {
  if (!d.title && !d.body) return d.undo;
  return [...d.undo, snapshot(d)].slice(-MAX_UNDO);
}

/** What happens when a Generate starts: the text now in the draft is kept as the previous version and in undo. */
export function beginGenerated(d: Draft, prompt?: string): Draft {
  return { ...d, undo: pushUndo(d), ...startVersion(d, prompt) };
}

/**
 * Puts generated text into the draft: what the page does when a Generate starts and streams. Unless `continued`
 * (the text is a longer version of what an earlier call already put in), the draft's text is kept first as the
 * previous version and in undo. A title still arriving (`null`) leaves the title as it is. `ai`: the kept request
 * writing it; a Generate writes the text afresh, so it replaces the ones before (a text without it keeps what it has).
 * `prompt`: the Generate's prompt, kept with its version (the draft's prompt box when not given).
 */
export function applyGenerated(d: Draft, text: { title: string | null; body: string }, opts: { continued?: boolean; ai?: string; prompt?: string } = {}): Draft {
  const base = opts.continued ? d : { ...beginGenerated(d, opts.prompt), ai: undefined };
  return { ...base, ...(text.title !== null ? { title: text.title } : {}), body: text.body, ...(opts.ai ? { ai: [opts.ai] } : {}) };
}

/**
 * Whether a Generate that started from `base` (the draft's title and text at that moment) has already been begun in
 * this draft, so further text of it is `continued`. A draft that was empty has nothing to keep; otherwise the
 * previous text is the last entry in undo. This lets the writing page and the work queue each apply the text
 * without telling each other what they did.
 */
export function isBegun(d: Draft, base: { title: string; body: string }): boolean {
  if (!base.title && !base.body) return true;
  const last = d.undo[d.undo.length - 1];
  return !!last && last.title === base.title && last.body === base.body;
}

/** What follows a Generate: the choice text for the previous chapter, only when the author hasn't written any. */
export function applyAfterGenerate(d: Draft, after: { choiceLabel?: string }): Draft {
  if (after.choiceLabel && !d.newChoiceLabel.trim()) return { ...d, newChoiceLabel: after.choiceLabel };
  return d;
}
