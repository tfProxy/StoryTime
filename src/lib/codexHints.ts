import { isFormAspect, type CodexEntry } from "./codex";
import { budgetFor, codexBudget, estimateTokens, mentions, type ContextCodexEntry } from "./ai/prompts";

/**
 * A plain-code warning about a codex entry, shown on its page: what is wrong and what to do, and the fix the page
 * offers for it. `edit`: the fact to open for editing; `duplicates`: the facts that say the same aspect, one of which
 * can be removed.
 */
export type EntryHint = { key: string; text: string; edit?: string; duplicates?: [string, string] };

/** A fact longer than this many words is hard for the AI to use and crowds the prompt. */
export const LONG_FACT_WORDS = 25;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
// "Ear" and "Ears", "Hair  colour" and "hair colour": the same aspect written two ways.
const aspectKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/s$/, "");
// The AI isn't told chapter numbers, and a fact is already dated by the chapter it is set at.
const CHAPTER_REF = /\b(chapters?|ch\.)\s*\d+|\b(this|that|last|next|previous|earlier|later|the first|the last) chapter\b/i;

/**
 * What may stop an entry working as meant, worked out without the AI.
 * `chapterTexts`: the chapters on the path up to here, to check the entry is mentioned; `contextTokens`: the AI's
 * context size from Settings, to see how much of the codex's share of a prompt the entry takes.
 */
export function entryHints(entry: CodexEntry, { chapterTexts, contextTokens }: { chapterTexts?: string[]; contextTokens?: number } = {}): EntryHint[] {
  const hints: EntryHint[] = [];
  const facts = entry.facts.filter((f) => !isFormAspect(f.aspect));

  if (facts.length > 0 && !entry.always_include && chapterTexts) {
    const who: ContextCodexEntry = { name: entry.name, type: entry.type, aliases: entry.aliases, content: "", always_include: false };
    if (!chapterTexts.some((t) => mentions(who, t))) {
      hints.push({
        key: "unmentioned",
        text: "Neither its name nor a keyword appears in the chapters up to here, so it only goes to the AI when added by hand. Add the name it goes by as a keyword, or turn on Always include.",
      });
    }
  }

  for (const f of facts) {
    const n = words(f.text);
    if (n > LONG_FACT_WORDS) hints.push({ key: `long-${f.fact_id}`, text: `${f.aspect || "A fact"} is long (${n} words). Split it into shorter facts, one thing each.`, edit: f.fact_id });
    if (CHAPTER_REF.test(f.text)) {
      hints.push({
        key: `chapter-${f.fact_id}`,
        text: `${f.aspect || "A fact"} mentions a chapter. The AI isn't told chapter numbers; set the fact from the chapter where it becomes true instead.`,
        edit: f.fact_id,
      });
    }
  }

  const seen = new Map<string, (typeof facts)[number]>();
  for (const f of facts) {
    if (!f.aspect.trim()) continue;
    const key = `${f.form.trim().toLowerCase()}\u0000${aspectKey(f.aspect)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, f);
    else if (first.aspect.trim() !== f.aspect.trim()) {
      hints.push({
        key: `dup-${f.fact_id}`,
        text: `“${first.aspect.trim()}” and “${f.aspect.trim()}” are the same aspect written two ways${f.form ? ` (${f.form})` : ""}, and the AI reads both. Keep one, or edit one to say both.`,
        duplicates: [first.fact_id, f.fact_id],
      });
    }
  }

  if (contextTokens && entry.description) {
    const room = codexBudget(budgetFor(contextTokens));
    const size = estimateTokens(entry.description);
    if (size > room / 4) {
      hints.push({
        key: "big",
        text: `What the AI reads about it is long (about ${size} tokens, more than a quarter of the ${room} the codex gets in a prompt at your context size). With other entries in the scene it may be left out; shorten or remove facts.`,
      });
    }
  }
  return hints;
}

/** How many things the entry's page warns about: its hints and its facts that clash between forms (the ⚠ count on its card). */
// A form's own fact replaces the every-form one on its aspect (applicableFacts), so a pair is no longer a clash to fix.
export const hintCount = (entry: CodexEntry, opts: Parameters<typeof entryHints>[1] = {}) => entryHints(entry, opts).length;

/** From this many chapters mentioning an entry since its last change, its card says it may be out of date. */
export const STALE_FROM = 3;

/** What the out-of-date count needs about a chapter, and about an entry's history. */
type StaleChapter = { id: string; parent_id: string | null; body: string };
type StaleInput = {
  /** The entry's name and keywords, as it stands. */
  who: Pick<CodexEntry, "name" | "type" | "aliases">;
  /** Chapters where the entry changed (an entry op or a fact op anchored there): each starts the count again. */
  changes: Set<string>;
  /** Chapters the AI codex check has read at their current revision: they don't add to the count. */
  checked: Set<string>;
};

const mentionsIn = (who: StaleInput["who"], text: string) => mentions({ name: who.name, type: who.type, aliases: who.aliases, content: "", always_include: false }, text);

/**
 * The chapters on a path (root first) that mention the entry since its last change there, in story order: what
 * "Update from the story" reads. None when the entry doesn't start on the path.
 */
export function chaptersSinceChange<C extends Omit<StaleChapter, "parent_id">>(path: C[], { who, changes }: Omit<StaleInput, "checked">): C[] {
  const last = path.findLastIndex((c) => changes.has(c.id));
  return last < 0 ? [] : path.slice(last + 1).filter((c) => mentionsIn(who, c.body));
}

/**
 * How many chapters mention the entry since it last changed, along one path (root first, ending at the chapter shown),
 * leaving out those the codex check has read. Before the entry's first change on the path (its creation) nothing counts.
 */
export function staleAlong(path: Omit<StaleChapter, "parent_id">[], input: StaleInput): number {
  return chaptersSinceChange(path, input).filter((c) => !input.checked.has(c.id)).length;
}

/** The same count for the whole story: the most chapters on any one branch (`chapters` with parents before children). */
export function staleInTree(chapters: StaleChapter[], input: StaleInput): number {
  const counts = new Map<string, number | null>();
  let most = 0;
  for (const c of chapters) {
    const before = c.parent_id ? (counts.get(c.parent_id) ?? null) : null;
    const now = input.changes.has(c.id) ? 0 : before !== null && !input.checked.has(c.id) && mentionsIn(input.who, c.body) ? before + 1 : before;
    counts.set(c.id, now);
    if (now !== null && now > most) most = now;
  }
  return most;
}

/** Always-included entries go into every prompt first: past this share of the codex's room, little is left for the rest. */
export const ALWAYS_SHARE = 0.5;

/**
 * The always-included entries when together they take more than `ALWAYS_SHARE` of the codex's room in a prompt at this
 * context size, biggest first; null when they fit.
 */
export function alwaysIncludedLoad(entries: CodexEntry[], contextTokens: number): { names: string[]; tokens: number; room: number } | null {
  const always = entries.filter((e) => e.always_include && e.description).map((e) => ({ name: e.name, tokens: estimateTokens(e.description) }));
  const tokens = always.reduce((n, e) => n + e.tokens, 0);
  const room = codexBudget(budgetFor(contextTokens));
  if (tokens <= room * ALWAYS_SHARE) return null;
  return { names: always.sort((a, b) => b.tokens - a.tokens).map((e) => e.name), tokens, room };
}
