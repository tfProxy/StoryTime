import { isFormAspect, type CodexEntry } from "./codex";
import { budgetFor, codexBudget, estimateTokens, mentions, type ContextCodexEntry } from "./ai/prompts";

/** A plain-code warning about a codex entry, shown on its page: what is wrong and what to do. */
export type EntryHint = { key: string; text: string };

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

  if (facts.length === 0 && entry.content.trim()) {
    hints.push({ key: "notes-only", text: "It has notes but no facts, so the AI is told nothing about it. Use Turn notes into facts under Your notes." });
  }

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
    if (n > LONG_FACT_WORDS) hints.push({ key: `long-${f.fact_id}`, text: `${f.aspect || "A fact"} is long (${n} words). Split it into shorter facts, one thing each.` });
    if (CHAPTER_REF.test(f.text)) {
      hints.push({ key: `chapter-${f.fact_id}`, text: `${f.aspect || "A fact"} mentions a chapter. The AI isn't told chapter numbers; set the fact from the chapter where it becomes true instead.` });
    }
  }

  const seen = new Map<string, string>();
  for (const f of facts) {
    if (!f.aspect.trim()) continue;
    const key = `${f.form.trim().toLowerCase()}\u0000${aspectKey(f.aspect)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, f.aspect.trim());
    else if (first !== f.aspect.trim()) {
      hints.push({ key: `dup-${f.fact_id}`, text: `“${first}” and “${f.aspect.trim()}” are the same aspect written two ways${f.form ? ` (${f.form})` : ""}. Keep one: the AI reads both.` });
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
