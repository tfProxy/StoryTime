// AI helper for the codex check: the AI reads one posted chapter and proposes changes to the codex, each one
// fact-sized and with a quote from the chapter as evidence. They go to the codex inbox for the owner to accept, edit
// or dismiss. Pure apart from `completeChat`; runs on the server (the work queue's review runs).
import { completeChat, type AiSourceIds } from "./client";
import { estimateTokens, mentions, type PromptParts } from "./prompts";
import { extractJson } from "./codexAi";
import { quoteInText } from "./tagAi";
import { ENTRY_TYPES, FACT_LIMITS, STARTER_ASPECTS, isFormAspect, sameAspect, type CodexEntry, type EntryType } from "../codex";
import type { Settings } from "../settings";

export const SUGGESTION_KINDS = ["set", "form", "retire", "entry", "conflict"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** A proposed new entry, with the facts it starts with. */
export type SuggestedEntry = { name: string; type: EntryType; aliases: string[]; notes: string; facts: { aspect: string; form: string; text: string }[] };

/**
 * One suggestion as the AI makes it. For "form", `form` is the form name and `after` the note; for "retire", `after` is "";
 * for "entry" there is no entry_id and `entry` holds the proposal.
 */
export type SuggestionInput = {
  kind: SuggestionKind;
  entry_id?: string;
  aspect: string;
  form: string;
  after: string;
  quote: string;
  entry?: SuggestedEntry;
};

export const MAX_SUGGESTIONS = 12;
const MAX_ENTRIES = 25;
const NOTES_IN_PROMPT = 300;
const NEW_ENTRY_NOTES = 500;
const NEW_ENTRY_FACTS = 6;
const NAME_MAX = 100;
const ALIAS_MAX = 60;
const ALIASES_MAX = 10;

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lc = (s: string) => s.trim().toLowerCase();

const SYSTEM_CODEX_CHECK = `You keep the codex of a story up to date. The codex records the lasting state of the story's characters, places and things as small facts, one per aspect, for example "Ears: tall russet fox ears". You are shown one chapter that has just been posted, and what the codex says now about the entries the chapter mentions. Propose the changes the codex needs because of this chapter.

How to write a fact:
- Describe the state at the END of the chapter, in the present tense.
- Keep it short (under about 25 words) and standalone: use names, not pronouns. No plot retelling, no feelings or events; only what stays true.
- Reuse the aspect names already on the entry when they fit. Otherwise use a short title-case name. For a character, the usual aspects are: ${STARTER_ASPECTS.character.join(", ")}.

This story may involve physical transformation. When a character's body, sex, species or form changes, record each changed aspect separately (Ears, Tail, Fur, Build, Voice, Sex, Species and so on), even when several change in one scene. When the character is now in a different form or stage of a change, also propose a "form" item.

Kinds of item:
- "set": a new aspect, or an existing one that changed. Give "entry" (the entry's name as listed), "aspect", "text" and, only if the fact belongs to one form of the character, "form" (otherwise leave it empty).
- "form": the character is now in a different form or stage. Give "entry", "form" (the form's name, such as "vixen" or "half-changed") and "text" (a short note about it, or empty).
- "retire": an existing fact is no longer true and nothing replaces it. Give "entry" and "aspect" (and "form" if the fact has one).
- "entry": a new named character, place, item or faction likely to come up again that is not in the codex or in the list of other names. Give "name", "type" (one of ${ENTRY_TYPES.join(", ")}), "aliases", "notes" (one sentence) and up to ${NEW_ENTRY_FACTS} "facts" ({"aspect","form","text"}).
- "conflict": the chapter states a different value for an existing fact as if it had always been so, rather than showing it change. This is likely a slip by the author. Give "entry", "aspect", "text" (the value the chapter gives) and "form" if the fact has one.

Rules:
- Every item needs "quote": the exact words copied from the chapter that show it (under 200 characters).
- Only what the chapter shows. Do not guess, and do not repeat what the codex already says.
- Skip trivia. At most ${MAX_SUGGESTIONS} items; a few valuable ones are better than many.
Reply with JSON only, in this shape ({"changes":[]} if there is nothing to change):
{"changes":[{"kind":"set|form|retire|entry|conflict","entry":"existing entry name","aspect":"","form":"","text":"","quote":"","name":"","type":"","aliases":[],"notes":"","facts":[{"aspect":"","form":"","text":""}]}]}`;

/** The entries to show the AI: those the chapter mentions, then the ones always included, at most MAX_ENTRIES. */
export function selectEntries(entries: CodexEntry[], body: string): CodexEntry[] {
  const picked = entries.filter((e) => mentions(e, body));
  for (const e of entries) if (e.always_include && !picked.includes(e)) picked.push(e);
  return picked.slice(0, MAX_ENTRIES);
}

/** How the AI reads one entry: its name, current form, each live fact and its notes. */
export function describeForCheck(e: CodexEntry): string {
  const lines = [`${e.name} [${e.type}]${e.aliases.length ? ` (also: ${e.aliases.join(", ")})` : ""}`];
  if (e.form) {
    const label = [e.form.name, e.form.note].map((s) => s.trim()).filter(Boolean).join(", ");
    if (label) lines.push(`Current form: ${label}`);
  }
  for (const f of e.facts) {
    if (isFormAspect(f.aspect) || !f.text.trim()) continue;
    lines.push(`- ${f.aspect.trim() || "(note)"} [${f.form.trim() ? `${f.form.trim()} form` : "every form"}]: ${f.text.trim()}`);
  }
  const notes = e.content.replace(/\s+/g, " ").trim();
  if (notes) lines.push(`Notes: ${notes.length > NOTES_IN_PROMPT ? `${notes.slice(0, NOTES_IN_PROMPT).trimEnd()}…` : notes}`);
  return lines.join("\n");
}

export type CodexCheckRequestOptions = {
  chapter: { title: string; body: string };
  /** The codex as it stands at the chapter; the request shows only those the chapter mentions (and the always-included). */
  entries: CodexEntry[];
  /** Names of other entries, so they aren't proposed as new. The names of entries left out of the request are added. */
  otherNames: string[];
};

/** The request for one chapter's codex changes. A chapter too long for the context is cut to fit. */
export function codexCheckRequest(contextTokens: number, opts: CodexCheckRequestOptions): PromptParts {
  const shown = selectEntries(opts.entries, opts.chapter.body);
  const others: string[] = [];
  for (const n of [...opts.otherNames, ...opts.entries.filter((e) => !shown.includes(e)).map((e) => e.name)]) {
    const name = asString(n, 60);
    if (name && !others.some((x) => lc(x) === lc(name)) && !shown.some((e) => lc(e.name) === lc(name))) others.push(name);
  }
  const known = shown.length ? shown.map(describeForCheck).join("\n\n") : "(no entry is mentioned in this chapter)";
  const otherList = others.slice(0, 80).join(", ");

  const budget = Math.max(1000, contextTokens - 2000 - estimateTokens(SYSTEM_CODEX_CHECK));
  // The codex is kept whole; the chapter gets what is left (about 2 characters a token).
  const room = Math.max(1000, budget - estimateTokens(known) - estimateTokens(otherList));
  const maxChars = room * 2;
  const body = opts.chapter.body.length > maxChars ? `${opts.chapter.body.slice(0, maxChars)}…` : opts.chapter.body;

  const message = [
    `The codex now, for the entries this chapter mentions:\n${known}`,
    otherList ? `Other names already in the codex (not new): ${otherList}` : "",
    `Chapter to read: "${opts.chapter.title}"\n${body}`,
    "Propose the codex changes this chapter needs, as JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: SYSTEM_CODEX_CHECK, message };
}

function parseNewEntry(o: Record<string, unknown>, taken: Set<string>): SuggestedEntry | null {
  const name = asString(o.name, NAME_MAX);
  if (!name || taken.has(lc(name))) return null;
  const typeWord = lc(asString(o.type, 20));
  const type = (ENTRY_TYPES as readonly string[]).includes(typeWord) ? (typeWord as EntryType) : "character";
  const aliases: string[] = [];
  if (Array.isArray(o.aliases)) {
    for (const a of o.aliases) {
      const alias = asString(a, ALIAS_MAX);
      if (alias && lc(alias) !== lc(name) && !aliases.some((x) => lc(x) === lc(alias)) && !taken.has(lc(alias))) aliases.push(alias);
      if (aliases.length >= ALIASES_MAX) break;
    }
  }
  const facts: SuggestedEntry["facts"] = [];
  if (Array.isArray(o.facts)) {
    for (const f of o.facts) {
      if (!f || typeof f !== "object") continue;
      const r = f as Record<string, unknown>;
      const text = asString(r.text, FACT_LIMITS.text);
      if (!text) continue;
      const aspect = asString(r.aspect, FACT_LIMITS.aspect);
      if (isFormAspect(aspect)) continue; // a new entry's form is set after it exists
      facts.push({ aspect, form: asString(r.form, FACT_LIMITS.form), text });
      if (facts.length >= NEW_ENTRY_FACTS) break;
    }
  }
  return { name, type, aliases, notes: asString(o.notes, NEW_ENTRY_NOTES), facts };
}

export type ParseCodexCheckOptions = {
  body: string;
  /** Every entry live at the chapter (with its facts). */
  entries: CodexEntry[];
  otherNames: string[];
};

/** Turns a model reply into suggestions, dropping what can't be trusted (bad quotes, unknown entries, no change). */
export function parseCodexCheck(reply: string, opts: ParseCodexCheckOptions): SuggestionInput[] {
  const raw = extractJson(reply);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { changes?: unknown }).changes : null;
  if (!Array.isArray(list)) return [];

  const byName = new Map<string, CodexEntry>();
  for (const e of opts.entries) for (const n of [e.name, ...e.aliases]) if (n.trim() && !byName.has(lc(n))) byName.set(lc(n), e);
  const taken = new Set([...byName.keys(), ...opts.otherNames.map(lc)]);

  const out: SuggestionInput[] = [];
  for (const item of list) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let kind = lc(asString(o.kind, 20)) as SuggestionKind;
    if (!(SUGGESTION_KINDS as readonly string[]).includes(kind)) continue;
    const quote = asString(o.quote, FACT_LIMITS.quote);
    if (!quote || !quoteInText(quote, opts.body)) continue;

    if (kind === "entry") {
      const entry = parseNewEntry(o, taken);
      if (!entry) continue;
      taken.add(lc(entry.name)); // a second proposal of the same name in this reply is a duplicate
      for (const a of entry.aliases) taken.add(lc(a));
      out.push({ kind, aspect: "", form: "", after: "", quote, entry });
      continue;
    }

    const target = byName.get(lc(asString(o.entry, NAME_MAX)));
    if (!target) continue;
    let aspect = asString(o.aspect, FACT_LIMITS.aspect);
    let form = asString(o.form, FACT_LIMITS.form);
    const text = asString(o.text, FACT_LIMITS.text);
    // A "set" of the aspect "form" is a form change.
    if (kind === "set" && isFormAspect(aspect)) kind = "form";
    const live = (a: string, f: string) => target.facts.find((x) => !isFormAspect(x.aspect) && sameAspect(x.aspect, a) && sameAspect(x.form, f));

    if (kind === "form") {
      if (!form) continue;
      if (target.form && sameAspect(target.form.name, form) && lc(target.form.note) === lc(text)) continue;
      out.push({ kind, entry_id: target.entry_id, aspect: "", form, after: text, quote });
    } else if (kind === "retire") {
      if (!aspect || !live(aspect, form)) continue;
      out.push({ kind, entry_id: target.entry_id, aspect, form, after: "", quote });
    } else {
      // "set" and "conflict"
      if (!aspect || !text) continue;
      if (live(aspect, form) && lc(live(aspect, form)!.text) === lc(text)) continue;
      aspect = live(aspect, form)?.aspect ?? aspect; // keep the entry's own spelling of the aspect
      form = live(aspect, form)?.form ?? form;
      out.push({ kind, entry_id: target.entry_id, aspect, form, after: text, quote });
    }
  }
  return out;
}

export type RunCodexCheckOptions = CodexCheckRequestOptions & { signal?: AbortSignal; role?: "main" | "cheap"; source?: AiSourceIds };

/** Asks the AI what the chapter changes in the codex. Throws when the reply can't be read. */
export async function runCodexCheck(settings: Settings, opts: RunCodexCheckOptions): Promise<SuggestionInput[]> {
  if (!opts.chapter.body.trim()) return [];
  const request = codexCheckRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: opts.role ?? "cheap",
    signal: opts.signal,
    source: { label: "Codex check", ...opts.source },
  });
  return parseCodexCheck(reply, { body: opts.chapter.body, entries: opts.entries, otherNames: opts.otherNames });
}
