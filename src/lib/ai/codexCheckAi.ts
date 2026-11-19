// AI helper for the codex check: the AI reads one posted chapter and proposes changes to the codex, each one
// fact-sized and with a quote from the chapter as evidence. They go to the codex inbox for the owner to accept, edit
// or dismiss. Pure apart from `completeChat`; runs on the server (the work queue's review runs).
import { completeChat, type AiSourceIds } from "./client";
import { estimateTokens, mentions, type PromptParts } from "./prompts";
import { extractJson } from "./codexAi";
import { matchQuote } from "./quotes";
import { ENTRY_TYPES, FACT_LIMITS, aspectAndForm, factLinesForEditing, isFormAspect, sameAspect, type CodexEntry, type EntryType } from "../codex";
import { DEFAULT_CATEGORIES, aspectRules, formFor, resolveAspect, type CategoryLists } from "../codexCategories";
import { contextFor, type Settings } from "../settingsSchema";

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
/** How many of the reply's changes are read before the best MAX_SUGGESTIONS are kept. */
const READ_MAX = 60;
const MAX_ENTRIES = 25;
const NEW_ENTRY_NOTES = 500;
const NEW_ENTRY_FACTS = 6;
const NAME_MAX = 100;
const ALIAS_MAX = 60;
const ALIASES_MAX = 10;
/** How much of an aspect is read before its "[… form]" label is taken off (aspectAndForm). */
const LABELLED_MAX = 120;

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lc = (s: string) => s.trim().toLowerCase();

const systemCodexCheck = (aspects: string) => `You keep the codex of a story up to date. The codex records the lasting state of the story's characters, places and things as small facts, one per aspect, for example "Ears: tall russet fox ears". You are shown one chapter that has just been posted, and what the codex says now about the entries the chapter mentions. Propose the changes the codex needs because of this chapter.

How to write a fact:
- Describe the state at the END of the chapter, in the present tense.
- Keep it short (under about 25 words) and standalone: use names, not pronouns. No plot retelling, no feelings or events; only what stays true.

${aspects}

This story may involve physical transformation. When a character's body, sex, species or form changes, record each changed aspect separately (Ears, Tail, Fur, Build, Voice, Sex, Species and so on), even when several change in one scene. When the character is now in a different form or stage of a change, also propose a "form" item. A form the character has had before (its current form or one under "Other forms") keeps the name it has there, spelled the same; give a new name only to a form the character has never had, and a further change to the same form is a new stage of it (in "text"), not a new form.

Kinds of item:
- "set": a new aspect, or an existing one that changed. Give "entry" (the entry's name as listed), "aspect", "text" and, only if the fact belongs to one form of the character, "form" (otherwise leave it empty).
- "form": the character is now in a different form or stage. Give "entry", "form" (the form's name, such as "vixen" or "half-changed") and "text" (a short note about it, or empty). A new form needs a real name, a word or two saying what the character now is ("goo creature", "dragon", "vixen"), never "current", "new", "true form" or "transformed". Every "set" item for that form gives the same name as its "form".
- "retire": an existing fact is no longer true and nothing replaces it. Give "entry" and "aspect" (and "form" if the fact has one).
- "entry": a new named character, place, item or faction likely to come up again that is not in the codex or in the list of other names. Give "name", "type" (one of ${ENTRY_TYPES.join(", ")}), "aliases", "notes" (one sentence) and up to ${NEW_ENTRY_FACTS} "facts" ({"aspect","form","text"}).
- "conflict": the chapter states a different value for an existing fact as if it had always been so, rather than showing it change. This is likely a slip by the author. Give "entry", "aspect", "text" (the value the chapter gives) and "form" if the fact has one.

Rules:
- Every item needs "quote": one sentence or phrase copied word for word from the chapter that shows it (under 200 characters). Copy one unbroken passage; never join pieces with "...".
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

/**
 * How the AI reads one entry: its name, current form and live facts. A character with many forms would fill a small
 * model's prompt with facts of forms it isn't in (and it then filed details under the wrong one), so only the facts for
 * every form, the current form and the forms the chapter names are shown; the other forms are listed by name, so a
 * form the character returns to is called what it was called before.
 */
export function describeForCheck(e: CodexEntry, body = ""): string {
  const lines = [`${e.name} [${e.type}]${e.aliases.length ? ` (also: ${e.aliases.join(", ")})` : ""}`];
  if (e.form) {
    const label = [e.form.name, e.form.note].map((s) => s.trim()).filter(Boolean).join(", ");
    if (label) lines.push(`Current form: ${label}`);
  }
  const now = e.form?.name.trim() || e.baseForm;
  if (!now) {
    lines.push(...factLinesForEditing(e));
    return lines.join("\n");
  }
  const named = (form: string) => mentions({ name: form, type: "", aliases: [], content: "", always_include: false }, body);
  const shownForm = (form: string) => !form.trim() || sameAspect(form, now) || named(form);
  lines.push(...factLinesForEditing({ ...e, facts: e.facts.filter((f) => shownForm(f.form)) }));
  const others = e.forms.filter((f) => !shownForm(f));
  if (others.length) lines.push(`Other forms (their facts are not shown): ${others.join(", ")}`);
  return lines.join("\n");
}

export type CodexCheckRequestOptions = {
  chapter: { title: string; body: string };
  /** The codex as it stands at the chapter; the request shows only those the chapter mentions (and the always-included). */
  entries: CodexEntry[];
  /** Names of other entries, so they aren't proposed as new. The names of entries left out of the request are added. */
  otherNames: string[];
  /**
   * "Update from the story" for one entry: only this entry is shown, the AI is asked for its changes alone (no new
   * entries), and anything else in the reply is dropped.
   */
  focus?: CodexEntry;
  /** With `focus`: what the author wants more of, if they said. */
  hint?: string;
  /** The fact categories the AI picks from (Settings → Codex); the defaults when not given. */
  categories?: CategoryLists;
};

/** The request for one chapter's codex changes. A chapter too long for the context is cut to fit. */
export function codexCheckRequest(contextTokens: number, opts: CodexCheckRequestOptions): PromptParts {
  const shown = opts.focus ? [opts.focus] : selectEntries(opts.entries, opts.chapter.body);
  const others: string[] = [];
  for (const n of [...opts.otherNames, ...opts.entries.filter((e) => !shown.includes(e)).map((e) => e.name)]) {
    const name = asString(n, 60);
    if (name && !others.some((x) => lc(x) === lc(name)) && !shown.some((e) => lc(e.name) === lc(name))) others.push(name);
  }
  const known = shown.length ? shown.map((e) => describeForCheck(e, opts.chapter.body)).join("\n\n") : "(no entry is mentioned in this chapter)";
  const otherList = others.slice(0, 80).join(", ");
  // The lists for the types shown, and for characters (most new entries are), to keep the prompt short.
  const types = opts.focus ? [opts.focus.type] : [...new Set<EntryType>(["character", ...shown.map((e) => e.type)])];
  const system = systemCodexCheck(aspectRules(opts.categories ?? DEFAULT_CATEGORIES, types));

  const budget = Math.max(1000, contextTokens - 2000 - estimateTokens(system));
  // The codex is kept whole; the chapter gets what is left, at 3 characters a token (prose runs about 4 to 4.5, so this
  // leaves a margin). A chapter still too long keeps its start and its end: the facts are its state at the end.
  const room = Math.max(1000, budget - estimateTokens(known) - estimateTokens(otherList));
  const maxChars = room * 3;
  const full = opts.chapter.body;
  const body = full.length > maxChars ? `${full.slice(0, maxChars / 2)}\n[…]\n${full.slice(-maxChars / 2)}` : full;

  const focus = opts.focus?.name;
  const message = [
    focus ? `The codex now, for ${focus}:\n${known}` : `The codex now, for the entries this chapter mentions:\n${known}`,
    otherList ? `Other names already in the codex (not new): ${otherList}` : "",
    `Chapter to read: "${opts.chapter.title}"\n${body}`,
    focus && opts.hint?.trim() ? `The author wants more of: ${opts.hint.trim()}` : "",
    focus
      ? `Propose only the changes this chapter makes to ${focus}, as JSON. Leave out every other entry, and propose no new entries.`
      : "Propose the codex changes this chapter needs, as JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, message };
}

function parseNewEntry(o: Record<string, unknown>, taken: Set<string>, lists: CategoryLists): SuggestedEntry | null {
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
      const given = aspectAndForm(asString(r.aspect, LABELLED_MAX), asString(r.form, FACT_LIMITS.form));
      const aspect = resolveAspect(given.aspect.slice(0, FACT_LIMITS.aspect), lists[type], facts).aspect;
      if (isFormAspect(aspect)) continue; // a new entry's form is set after it exists
      const form = formFor(aspect, given.form, lists[type]);
      if (aspect && facts.some((x) => sameAspect(x.aspect, aspect) && sameAspect(x.form, form))) continue; // one fact per aspect
      facts.push({ aspect, form, text });
      if (facts.length >= NEW_ENTRY_FACTS) break;
    }
  }
  return { name, type, aliases, notes: asString(o.notes, NEW_ENTRY_NOTES), facts };
}

/** The first sentence of the chapter that names one of `names` (whole words), or null. */
function sentenceNaming(names: unknown[], body: string): string | null {
  let at = -1;
  for (const n of names) {
    const name = asString(n, NAME_MAX);
    if (!name) continue;
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").exec(body);
    if (m && (at < 0 || m.index < at)) at = m.index + m[1].length;
  }
  if (at < 0) return null;
  const before = body.slice(0, at);
  const start = Math.max(before.search(/[^.!?…\n]*$/), 0);
  const end = body.slice(at).search(/[.!?…](\s|$)|\n/);
  const sentence = body.slice(start, end < 0 ? body.length : at + end + 1).trim();
  return sentence.slice(0, FACT_LIMITS.quote) || null;
}

export type ParseCodexCheckOptions = {
  body: string;
  /** Every entry live at the chapter (with its facts). */
  entries: CodexEntry[];
  otherNames: string[];
  categories?: CategoryLists;
};

/**
 * The request shows "Current form: Fox, fully transformed" (the form, then its stage), and models give that back as a
 * form's name: a form of the entry followed by a comma is that form, and the rest is its stage.
 */
function withStage(entry: CodexEntry, form: string): { form: string; stage: string } {
  const known = entry.forms.find((f) => form.toLowerCase().startsWith(`${f.toLowerCase()},`));
  return known ? { form: known, stage: form.slice(known.length + 1).trim() } : { form, stage: "" };
}

/** Turns a model reply into suggestions, dropping what can't be trusted (bad quotes, unknown entries, no change). */
export function parseCodexCheck(reply: string, opts: ParseCodexCheckOptions): SuggestionInput[] {
  const raw = extractJson(reply);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { changes?: unknown }).changes : null;
  if (!Array.isArray(list)) return [];

  const byName = new Map<string, CodexEntry>();
  for (const e of opts.entries) for (const n of [e.name, ...e.aliases]) if (n.trim() && !byName.has(lc(n))) byName.set(lc(n), e);
  const taken = new Set([...byName.keys(), ...opts.otherNames.map(lc)]);
  // The names the codex has; `taken` also gathers the new entries this reply proposes.
  const known = new Set(taken);
  const strays = new Map<string, { name: string; quote: string; facts: Record<string, unknown>[] }>();
  const lists = opts.categories ?? DEFAULT_CATEGORIES;
  // Where in the chapter a kept quote (the chapter's own words, spaces made single) starts.
  const flat = opts.body.replace(/\s+/g, " ");
  const placeOf = (quote: string) => Math.max(flat.indexOf(quote.split(" … ")[0]), 0);

  // Models write "form": "current" for "the form this chapter leaves them in": that is the form the reply moves the
  // entry to, if it does, or else the one it is in. A form item named "current" or "true form" names nothing and goes,
  // and so do the "current" facts beside it: they belong to a form the reply didn't name, not the old one (on The Lab,
  // Cydonia moved Sarah to "true form" and gave her new body as "current").
  const vague = (f: string) => /^(current|now|present|this|true|false|yes)( form)?$/i.test(f.trim());
  const movedTo = new Map<string, string>();
  const movedUnnamed = new Set<string>();
  for (const item of list) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const form = aspectAndForm(asString(o.aspect, LABELLED_MAX), asString(o.form, FACT_LIMITS.form)).form;
    const isForm = lc(asString(o.kind, 20)) === "form" || (lc(asString(o.kind, 20)) === "set" && isFormAspect(asString(o.aspect, LABELLED_MAX)));
    const target = byName.get(lc(asString(o.entry, NAME_MAX)));
    if (isForm && target && form && vague(form)) movedUnnamed.add(target.entry_id);
    if (isForm && target && form && !vague(form) && !movedTo.has(target.entry_id)) movedTo.set(target.entry_id, withStage(target, form).form);
  }

  const out: SuggestionInput[] = [];
  for (const item of list) {
    if (out.length >= READ_MAX) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let kind = lc(asString(o.kind, 20)) as SuggestionKind;
    if (!(SUGGESTION_KINDS as readonly string[]).includes(kind)) continue;
    // The chapter's own words for the AI's quote; a new entry without one that fits is shown by where it is named.
    const given = asString(o.quote, FACT_LIMITS.quote);
    let quote = given ? matchQuote(given, opts.body, FACT_LIMITS.quote) : null;
    if (!quote && kind === "entry") quote = sentenceNaming([o.name, ...(Array.isArray(o.aliases) ? o.aliases : [])], opts.body);
    if (!quote) continue;
    quote = quote.replace(/\s+/g, " ").trim();

    if (kind === "entry") {
      const entry = parseNewEntry(o, taken, lists);
      if (!entry) continue;
      taken.add(lc(entry.name)); // a second proposal of the same name in this reply is a duplicate
      for (const a of entry.aliases) taken.add(lc(a));
      out.push({ kind, aspect: "", form: "", after: "", quote, entry });
      continue;
    }

    const target = byName.get(lc(asString(o.entry, NAME_MAX)));
    if (!target) {
      // A change for a name the codex doesn't have: the model is describing someone new without proposing them (on
      // Amulet of Change, twelve facts about Maren, the lead, who wasn't in the codex). Gathered into a proposal below.
      const name = asString(o.entry, NAME_MAX);
      if (name && !known.has(lc(name)) && kind === "set") {
        const stray = strays.get(lc(name)) ?? { name, quote, facts: [] };
        stray.facts.push({ aspect: o.aspect, form: o.form, text: o.text });
        strays.set(lc(name), stray);
      }
      continue;
    }
    // The aspect as the list (or the entry) spells it: "Fur" is filed under Skin, "New: Gills" is a new category.
    const named = aspectAndForm(asString(o.aspect, LABELLED_MAX), asString(o.form, FACT_LIMITS.form));
    let aspect = resolveAspect(named.aspect.slice(0, FACT_LIMITS.aspect), lists[target.type], target.facts).aspect;
    let form = named.form;
    const text = asString(o.text, FACT_LIMITS.text);
    // A "set" of the aspect "form" is a form change.
    if (kind === "set" && isFormAspect(aspect)) kind = "form";
    // Personality, Relationships and the like are the same in every form: a form the AI gave them is dropped.
    if (kind === "set" || kind === "conflict") form = formFor(aspect, form, lists[target.type]);
    if (vague(form)) {
      if (kind === "form") continue;
      const to = movedTo.get(target.entry_id);
      if (!to && movedUnnamed.has(target.entry_id)) continue;
      form = to ?? target.form?.name ?? target.baseForm ?? "";
    }
    const split = withStage(target, form);
    form = split.form;
    const stage = split.stage;
    const live = (a: string, f: string) => target.facts.find((x) => !isFormAspect(x.aspect) && sameAspect(x.aspect, a) && sameAspect(x.form, f));
    // One change per aspect: of two for the same fact in this reply, the one quoted later in the chapter is its state
    // at the end.
    if (kind !== "form") {
      const dup = out.findIndex((x) => x.kind !== "form" && x.kind !== "entry" && x.entry_id === target.entry_id && sameAspect(x.aspect, aspect) && sameAspect(x.form, form));
      if (dup >= 0 && placeOf(quote) <= placeOf(out[dup].quote)) continue;
      if (dup >= 0) out.splice(dup, 1);
    }

    if (kind === "form") {
      if (!form) continue;
      const note = text || stage;
      if (target.form && sameAspect(target.form.name, form) && lc(target.form.note) === lc(note)) continue;
      out.push({ kind, entry_id: target.entry_id, aspect: "", form, after: note, quote });
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
  // The new names' changes become a new entry, or join the one the reply proposed for that name.
  for (const s of strays.values()) {
    const made = parseNewEntry({ name: s.name, type: "character", facts: s.facts }, new Set(), lists);
    if (!made?.facts.length) continue;
    const proposed = out.find((x) => x.kind === "entry" && [x.entry!.name, ...x.entry!.aliases].some((n) => lc(n) === lc(s.name)))?.entry;
    if (!proposed) {
      out.push({ kind: "entry", aspect: "", form: "", after: "", quote: s.quote, entry: made });
      continue;
    }
    for (const f of made.facts) {
      if (proposed.facts.length >= NEW_ENTRY_FACTS) break;
      if (!proposed.facts.some((x) => sameAspect(x.aspect, f.aspect) && sameAspect(x.form, f.form))) proposed.facts.push(f);
    }
  }
  if (out.length <= MAX_SUGGESTIONS) return out;
  // Too many: models list changes in the chapter's order, so keeping the first ones lost the chapter's end, which is
  // the state the codex records. Form changes, contradictions and new entries go first, then the latest in the chapter;
  // what is kept stays in the reply's order.
  const rank = (s: SuggestionInput) => (s.kind === "form" ? 0 : s.kind === "conflict" ? 1 : s.kind === "entry" ? 2 : 3);
  const kept = new Set([...out].sort((a, b) => rank(a) - rank(b) || placeOf(b.quote) - placeOf(a.quote)).slice(0, MAX_SUGGESTIONS));
  return out.filter((s) => kept.has(s));
}

export type RunCodexCheckOptions = CodexCheckRequestOptions & { signal?: AbortSignal; role?: "main" | "cheap"; source?: AiSourceIds };

/** Asks the AI what the chapter changes in the codex. Throws when the reply can't be read. */
export async function runCodexCheck(settings: Settings, opts: RunCodexCheckOptions): Promise<SuggestionInput[]> {
  if (!opts.chapter.body.trim()) return [];
  const request = codexCheckRequest(contextFor(settings, "codex"), { categories: settings.codexCategories, ...opts });
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    use: "codex",
    role: opts.role ?? "cheap",
    signal: opts.signal,
    precise: true,
    source: { label: opts.focus ? `Update “${opts.focus.name}” from the story` : "Codex check", ...opts.source },
  });
  const found = parseCodexCheck(reply, { body: opts.chapter.body, entries: opts.entries, otherNames: opts.otherNames, categories: opts.categories ?? settings.codexCategories });
  return opts.focus ? found.filter((s) => s.kind !== "entry" && s.entry_id === opts.focus!.entry_id) : found;
}
