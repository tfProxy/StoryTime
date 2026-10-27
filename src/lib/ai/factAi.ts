// AI helper for the story review: list the durable facts a chapter states about characters, places
// and things (eye colour, species, where someone lives, ...), each with a quote as evidence, so they
// can be compared across chapters. Runs in the browser or on the server with the user's own key.
import { completeChat } from "./client";
import { estimateTokens, type PromptParts } from "./prompts";
import { extractJson, type StoryInfo } from "./codexAi";
import { quoteInText } from "./tagAi";
import type { Settings } from "../settings";

export type Fact = { entity: string; attribute: string; value: string; quote: string };

const MAX_FACTS = 40;
const ENTITY_MAX = 80;
const ATTRIBUTE_MAX = 60;
const VALUE_MAX = 120;
const QUOTE_MAX = 240;
const CODEX_NAMES_MAX = 80;

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lc = (s: string) => s.trim().toLowerCase();

const SYSTEM_FACTS = `You list the lasting facts a chapter of a story states about its characters, places and things.
Rules:
- A fact is something that stays true: eye or hair colour, species or form, age, where someone lives, who owns what, relationships, injuries, names, jobs.
- Do not list events, actions, feelings or plot summary.
- Only list what the chapter says. Do not guess or add what it leaves out.
- "entity" is the name as written in the chapter. If it matches a name in the list you are given, use that spelling.
- "attribute" is short and lowercase, for example "eye colour" or "home".
- "value" is short.
- "quote" is the exact words from the chapter that state the fact (copied word for word, under 200 characters).
Reply with JSON only, in this shape (if there are none, reply {"facts":[]}):
{"facts":[{"entity":"name","attribute":"eye colour","value":"green","quote":"exact words from the chapter"}]}`;

// The story is accepted so a caller can pass what it has, but the prompt leaves it out: the plan
// asks for the chapter text and the codex names only, which keeps it small for local models.
export type FactRequestOptions = {
  story?: StoryInfo;
  chapter: { title: string; body: string };
  codexNames: string[];
};

/** The request for one chapter's facts. A chapter too long for the context is cut to fit. */
export function factRequest(contextTokens: number, opts: FactRequestOptions): PromptParts {
  const { chapter } = opts;
  const names: string[] = [];
  for (const n of opts.codexNames) {
    const name = asString(n, 60);
    if (name && !names.some((x) => lc(x) === lc(name))) names.push(name);
  }
  const nameList = names.slice(0, CODEX_NAMES_MAX).join(", ");

  const budget = Math.max(1000, contextTokens - 1500);
  // The names come first and are kept whole; the chapter gets what is left (about 2 characters a token).
  const room = Math.max(1000, budget - estimateTokens(nameList));
  const maxChars = room * 2;
  const body = chapter.body.length > maxChars ? `${chapter.body.slice(0, maxChars)}…` : chapter.body;

  const message = [
    nameList ? `Known names: ${nameList}` : "",
    `Chapter to read: "${chapter.title}"\n${body}`,
    "List the lasting facts this chapter states, as JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: SYSTEM_FACTS, message };
}

/** Turns a model reply (already parsed from JSON) into facts. Tolerates junk. */
export function parseFactReply(raw: unknown): Fact[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { facts?: unknown }).facts : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const entity = asString(o.entity, ENTITY_MAX);
    const attribute = asString(o.attribute, ATTRIBUTE_MAX).toLowerCase();
    const value = asString(o.value, VALUE_MAX);
    const quote = asString(o.quote, QUOTE_MAX);
    if (!entity || !attribute || !value || !quote) continue;
    const key = `${lc(entity)}|${attribute}|${lc(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ entity, attribute, value, quote });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

export type Verdict = "contradiction" | "change" | "fine";

/** The two sides of a clash between chapters: the same thing stated with different values, the earlier chapter first. */
export type ConflictInfo = {
  entity: string;
  attribute: string;
  before: { value: string; quote: string };
  after: { value: string; quote: string };
};

const SYSTEM_JUDGE = `You check a story for continuity mistakes. You are shown two statements from two chapters of the same story, the earlier chapter first, that seem to give different values for the same thing.
Decide which of these it is:
- "contradiction": a mistake. The story says two things that cannot both be true, and nothing explains the difference.
- "change": the story explains it, for example a transformation, time passing, healing, moving house or a disguise.
- "fine": not really the same thing, or both can be true.
Reply with JSON only: {"verdict":"contradiction"} or {"verdict":"change"} or {"verdict":"fine"}`;

export type JudgeRequestOptions = { conflict: ConflictInfo; chapterTitles?: { before?: string; after?: string } };

/** The request asking whether one clash is a contradiction. */
export function judgeRequest(opts: JudgeRequestOptions): PromptParts {
  const { conflict: c, chapterTitles: t } = opts;
  const where = (title: string | undefined) => (title ? ` (chapter “${title}”)` : "");
  const message = [
    `${asString(c.entity, ENTITY_MAX)}, ${asString(c.attribute, ATTRIBUTE_MAX)}`,
    `Earlier${where(t?.before)}: value “${asString(c.before.value, VALUE_MAX)}”. The chapter says: “${asString(c.before.quote, QUOTE_MAX)}”`,
    `Later${where(t?.after)}: value “${asString(c.after.value, VALUE_MAX)}”. The chapter says: “${asString(c.after.quote, QUOTE_MAX)}”`,
    "Is this a contradiction, a change the story explains, or fine? Reply as JSON.",
  ].join("\n\n");
  return { system: SYSTEM_JUDGE, message };
}

/** Reads the verdict from a model reply (already parsed from JSON), or null when it can't be read. Tolerates a bare word. */
export function parseVerdict(raw: unknown): Verdict | null {
  const word = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { verdict?: unknown }).verdict : null;
  if (typeof word !== "string") return null;
  const w = lc(word).replace(/[^a-z]/g, "");
  return w === "contradiction" || w === "change" || w === "fine" ? w : null;
}

export type JudgeConflictOptions = JudgeRequestOptions & { signal?: AbortSignal; role?: "main" | "cheap" };

/** Asks whether one clash is a contradiction, a change the story explains, or fine. Throws when the reply can't be read. */
export async function judgeConflict(settings: Settings, opts: JudgeConflictOptions): Promise<Verdict> {
  const request = judgeRequest(opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: opts.role ?? "cheap",
    signal: opts.signal,
  });
  const verdict = parseVerdict(extractJson(reply));
  if (!verdict) throw new Error("The AI's reply about the clash couldn't be read.");
  return verdict;
}

export type ExtractFactsOptions = FactRequestOptions & { signal?: AbortSignal; role?: "main" | "cheap" };

export async function extractFacts(settings: Settings, opts: ExtractFactsOptions): Promise<Fact[]> {
  if (!opts.chapter.body.trim()) return [];
  const request = factRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    // The main model, unless the caller is reading many chapters.
    role: opts.role ?? "main",
    signal: opts.signal,
  });
  // A quote that isn't in the chapter is a sign the fact was made up, so it goes.
  return parseFactReply(extractJson(reply)).filter((f) => quoteInText(f.quote, opts.chapter.body));
}
