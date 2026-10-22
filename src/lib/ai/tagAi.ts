// AI helpers for story tags: suggest which tags apply to a chapter (with a quote as evidence), and
// help the author write a precise tag rule from a rough idea. All of it runs in the browser with
// the user's own key; nothing is saved until the user accepts.
import { completeChat } from "./client";
import { estimateTokens, type PromptParts } from "./prompts";
import { extractJson, type StoryInfo } from "./codexAi";
import type { Settings } from "../settings";

export type TagExample = { text: string; applies: boolean; note?: string };

export type TagRule = {
  id: string;
  name: string;
  applies: string;
  not_applies: string;
  choices: string[];
  examples: TagExample[];
};

export type TagSuggestion = { tag_id: string; value: string | null; quote: string; reason: string };

export type RuleDraft = { name: string; applies: string; not_applies: string; choices: string[] };

const QUOTE_MAX = 240;
const REASON_MAX = 300;

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const lc = (s: string) => s.trim().toLowerCase();

// ---------- suggesting tags for a chapter ----------

const SYSTEM_TAGS = `You label a chapter of a story with tags from the author's list. For each tag you are given a rule: when it applies, when it does not, sometimes allowed values, and sometimes examples.
Rules:
- Tag only what actually happens on the page in this chapter. Not what is mentioned, planned, hoped for, feared or remembered, and not what happens in other chapters.
- Follow each tag's "Applies when" and "Doesn't apply when" literally. Do not stretch them.
- The examples show what does and does not count. Treat them as guidance, not as text to look for.
- If you are not sure, do not tag it. Leaving a tag out is better than a wrong tag.
- For each tag that applies, give a short exact quote from the chapter (copied word for word, under 200 characters) that shows it, and a one-sentence reason.
- If a tag has choices, set "value" to exactly one of them. If it has none, set "value" to null.
Reply with JSON only, in this shape (tags that do not apply are left out; if none apply, reply {"tags":[]}):
{"tags":[{"name":"tag name","value":null,"quote":"exact words from the chapter","reason":"one short sentence"}]}`;

function describeTag(t: TagRule): string {
  const lines = [`Tag: ${t.name}`, `Applies when: ${t.applies.trim() || "(not described)"}`];
  if (t.not_applies.trim()) lines.push(`Doesn't apply when: ${t.not_applies.trim()}`);
  if (t.choices.length) lines.push(`Choices: ${t.choices.join(", ")}`);
  if (t.examples.length) {
    lines.push("Examples:");
    for (const e of t.examples) {
      const text = e.text.replace(/\s+/g, " ").trim();
      lines.push(`- ${e.applies ? "Counts" : "Doesn't count"}: "${text}"${e.note?.trim() ? ` (${e.note.trim()})` : ""}`);
    }
  }
  return lines.join("\n");
}

export type TagRequestOptions = {
  story: StoryInfo;
  chapter: { title: string; body: string };
  tags: TagRule[];
};

/** The request for tagging one chapter. A chapter too long for the context is cut to fit. */
export function tagRequest(contextTokens: number, opts: TagRequestOptions): PromptParts {
  const { story, chapter, tags } = opts;
  const budget = Math.max(1000, contextTokens - 1500);
  const rules = tags.map(describeTag).join("\n\n");
  // The rules come first and are kept whole; the chapter gets what is left (about 2 characters a token, as in the codex scan).
  const room = Math.max(1000, budget - estimateTokens(rules));
  const maxChars = room * 2;
  const body = chapter.body.length > maxChars ? `${chapter.body.slice(0, maxChars)}…` : chapter.body;

  const message = [
    `Story: ${story.title}${story.premise.trim() ? `\nPremise: ${story.premise.trim()}` : ""}`,
    `Tags:\n\n${rules || "(none)"}`,
    `Chapter to read: "${chapter.title}"\n${body}`,
    "List the tags that apply to this chapter, as JSON.",
  ].join("\n\n");
  return { system: SYSTEM_TAGS, message };
}

/** Turns a model reply (already parsed from JSON) into suggestions. Tolerates junk. */
export function parseTagReply(raw: unknown, tags: TagRule[]): TagSuggestion[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { tags?: unknown }).tags : null;
  if (!Array.isArray(list)) return [];
  const byName = new Map<string, TagRule>();
  for (const t of tags) if (!byName.has(lc(t.name))) byName.set(lc(t.name), t);

  const seen = new Set<string>();
  const out: TagSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const tag = byName.get(lc(asString(o.name ?? o.tag, 200)));
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);

    let value: string | null = null;
    if (tag.choices.length && typeof o.value === "string") {
      value = tag.choices.find((c) => lc(c) === lc(o.value as string)) ?? null;
    }
    out.push({
      tag_id: tag.id,
      value,
      quote: asString(o.quote, QUOTE_MAX),
      reason: asString(o.reason, REASON_MAX),
    });
  }
  return out;
}

/** Makes text comparable: straight quotes and dashes, one space between words, no case. */
function squash(s: string): string {
  return s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True if the quote appears in the chapter, ignoring whitespace, curly quotes and case. */
export function quoteInText(quote: string, body: string): boolean {
  const q = squash(quote).replace(/^\.\.\.|\.\.\.$/g, "").trim();
  if (!q) return false;
  return squash(body).includes(q);
}

export type SuggestOptions = TagRequestOptions & { signal?: AbortSignal; role?: "main" | "cheap" };

export async function suggestTagsForChapter(settings: Settings, opts: SuggestOptions): Promise<TagSuggestion[]> {
  if (opts.tags.length === 0) return [];
  const request = tagRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    // Like a single-chapter codex scan: the main model, unless the caller is tagging many chapters.
    role: opts.role ?? "main",
    signal: opts.signal,
  });
  const found = parseTagReply(extractJson(reply), opts.tags);
  // A quote that isn't in the chapter is a sign the tag was made up, so the suggestion goes too.
  return found.filter((s) => quoteInText(s.quote, opts.chapter.body));
}

// ---------- helping write a rule ----------

const SYSTEM_RULE = `You help an author write a precise rule for a tag used to label chapters of a story. The rule will be given to a small AI that reads a chapter and decides if the tag applies, so it must be literal and unambiguous.
From the author's rough idea, write:
- "name": a short tag name (one to three words).
- "applies": one or two sentences saying exactly what must happen on the page for the tag to apply.
- "not_applies": the near-misses that should not count, as short phrases separated by semicolons. Think of: something only mentioned, planned or wished for; a dream or vision; an illusion or disguise; something that happened in the past; something that is only a joke or a figure of speech.
- "choices": a list of allowed values ONLY if the idea asks for levels or kinds (for example mild, graphic). Otherwise an empty list.
Use plain words. Do not invent extra requirements the author did not ask for.
Reply with JSON only: {"name":"","applies":"","not_applies":"","choices":[]}`;

export type RuleOptions = { idea: string; name?: string };

/** The request for drafting a rule; throws if there is no idea yet. */
export function ruleRequest(_contextTokens: number | undefined, opts: RuleOptions): PromptParts {
  const idea = opts.idea.trim();
  if (!idea) throw new Error("Describe the tag first, for example “tf: a character changes species or physical form”.");
  const name = opts.name?.trim();
  const message = [name && `Tag name: ${name}`, `Rough idea: ${idea}`, "Write the rule, as JSON."].filter(Boolean).join("\n");
  return { system: SYSTEM_RULE, message };
}

function asList(v: unknown, max: number, each: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = asString(x, each);
    if (s && !out.some((o) => lc(o) === lc(s))) out.push(s);
  }
  return out.slice(0, max);
}

/**
 * Turns a parsed model reply into a rule. A weak model's bad output never throws: whatever is
 * missing falls back to the author's idea (and name).
 */
export function parseRuleReply(raw: unknown, idea: string, name?: string): RuleDraft {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const notApplies = Array.isArray(o.not_applies)
    ? asList(o.not_applies, 12, 120).join("; ")
    : asString(o.not_applies, 1000);
  const fallbackName = name?.trim() || (idea.includes(":") ? idea.split(":")[0].trim() : "");
  return {
    name: asString(o.name, 60) || fallbackName.slice(0, 60),
    applies: asString(o.applies, 1000) || (idea.includes(":") ? idea.slice(idea.indexOf(":") + 1).trim() : idea.trim()),
    not_applies: notApplies,
    choices: asList(o.choices, 8, 40),
  };
}

export type DraftRuleOptions = RuleOptions & { signal?: AbortSignal };

export async function draftRule(settings: Settings, opts: DraftRuleOptions): Promise<RuleDraft> {
  const request = ruleRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    signal: opts.signal,
  });
  let json: unknown = null;
  try {
    json = extractJson(reply);
  } catch {
    // A weak model's chatter: fall back to the idea below rather than lose the author's work.
  }
  return parseRuleReply(json, opts.idea, opts.name);
}
