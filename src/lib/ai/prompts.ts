// Prompt construction for chapter drafting. Pure functions, no network.

export type ContextChapter = {
  title: string;
  body: string;
  summary: string | null;
  path_summary: string | null;
};

export type ContextCodexEntry = {
  name: string;
  type: string;
  aliases: string[];
  content: string;
  always_include: boolean;
};

export type StoryContext = {
  storyTitle: string;
  premise: string;
  /** Chapters from the story root down to the chapter being continued; empty for a new story. */
  path: ContextChapter[];
  /** The choice the reader picked to get to the chapter being written, if any. */
  choiceLabel: string | null;
  /** Codex entries in effect at the point being continued. */
  codex?: ContextCodexEntry[];
};

export type Length = "short" | "medium" | "long";
export const LENGTH_WORDS: Record<Length, number> = { short: 300, medium: 600, long: 1000 };

// Rough estimate; good enough for budgeting.
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

const SYSTEM_BASE = `You are a skilled fiction co-author helping write one chapter of a branching, choose-your-own-adventure story that many people write together.
- Match the established voice, point of view and tense. Keep names, facts and tone consistent with the story so far.
- Write only the chapter's prose. Do NOT write the reader's choices, menus, or questions like "What do you do?" — choices are added separately.
- End at a natural decision point or a satisfying stopping place.
- Plain paragraphs separated by blank lines. No markdown formatting, no commentary, no notes to the author.`;

const OUTPUT_FORMAT = `Output format: the first line is "# " followed by the chapter title. Then a blank line, then the chapter text.`;

export const SYSTEM_CHAPTER = `${SYSTEM_BASE}\n\n${OUTPUT_FORMAT}`;
export const SYSTEM_CHOICES = `You help write branching stories. You reply with a JSON array of strings and nothing else.`;

/**
 * Builds the "story so far" text within a token budget. The most recent chapters are
 * included verbatim; earlier ones are condensed (their summary, or an excerpt).
 */
export function buildStorySoFar(path: ContextChapter[], budgetTokens: number): string {
  if (path.length === 0) return "";
  const verbatim: string[] = [];
  let used = 0;
  let firstVerbatim = path.length;
  const verbatimBudget = Math.floor(budgetTokens * 0.7);

  for (let i = path.length - 1; i >= 0; i--) {
    const text = `### ${path[i].title}\n${path[i].body}`;
    const cost = estimateTokens(text);
    if (i === path.length - 1 && cost > verbatimBudget) {
      // Always include the chapter being continued, trimmed from the front if it is huge.
      verbatim.unshift(`### ${path[i].title}\n…${path[i].body.slice(-verbatimBudget * 4)}`);
      used = verbatimBudget;
      firstVerbatim = i;
      break;
    }
    if (used + cost > verbatimBudget) break;
    verbatim.unshift(text);
    used += cost;
    firstVerbatim = i;
  }

  const earlier = path.slice(0, firstVerbatim);
  let condensed = "";
  if (earlier.length > 0) {
    const last = earlier[earlier.length - 1];
    if (last.path_summary) {
      // A stored rolling summary already covers everything before the verbatim window.
      condensed = last.path_summary;
    } else {
      const lines = earlier.map((c) => `- ${c.title}: ${c.summary ?? excerpt(c.body, 300)}`);
      // Drop the oldest-after-the-opening lines until it fits the remaining budget.
      const room = budgetTokens - used;
      while (lines.length > 2 && estimateTokens(lines.join("\n")) > room) lines.splice(1, 1);
      condensed = lines.join("\n");
    }
  }

  return [condensed && `Earlier in the story:\n${condensed}`, `Most recent chapters:\n${verbatim.join("\n\n")}`]
    .filter(Boolean)
    .join("\n\n");
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does `text` mention the entry by name or alias (whole word, case-insensitive)? */
export function mentions(entry: ContextCodexEntry, text: string): boolean {
  return [entry.name, ...entry.aliases]
    .map((n) => n.trim())
    .filter(Boolean)
    .some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}($|[^\\p{L}\\p{N}])`, "iu").test(text));
}

/**
 * Picks codex entries for the prompt within a token budget: "always include" entries first,
 * then entries mentioned in the recent text, in codex order.
 */
export function buildCodexBlock(entries: ContextCodexEntry[], triggerText: string, budgetTokens: number): string {
  const chosen = [...entries.filter((e) => e.always_include), ...entries.filter((e) => !e.always_include && mentions(e, triggerText))];
  const lines: string[] = [];
  let used = 0;
  for (const e of chosen) {
    const alias = e.aliases.length ? ` (also: ${e.aliases.join(", ")})` : "";
    const line = `- ${e.name} [${e.type}]${alias}: ${e.content.replace(/\s+/g, " ").trim()}`;
    const cost = estimateTokens(line);
    if (used + cost > budgetTokens) continue; // skip what doesn't fit, but keep trying smaller ones
    lines.push(line);
    used += cost;
  }
  return lines.length ? `Codex (established facts; stay consistent with these):\n${lines.join("\n")}` : "";
}

function storyHeader(ctx: StoryContext, budgetTokens: number, extraTrigger = ""): string {
  const parts = [`Story: ${ctx.storyTitle || "(untitled)"}`];
  if (ctx.premise.trim()) parts.push(`Premise: ${ctx.premise.trim()}`);
  if (ctx.codex?.length) {
    // Entries are triggered by the premise, the last few chapters, and whatever is being written now.
    const trigger = [ctx.premise, ...ctx.path.slice(-3).map((c) => c.body), ctx.choiceLabel ?? "", extraTrigger].join("\n");
    const block = buildCodexBlock(ctx.codex, trigger, Math.floor(budgetTokens * 0.25));
    if (block) parts.push(block);
    budgetTokens = Math.floor(budgetTokens * 0.75);
  }
  const sofar = buildStorySoFar(ctx.path, budgetTokens);
  if (sofar) parts.push(sofar);
  if (ctx.choiceLabel) parts.push(`The reader chose: "${ctx.choiceLabel}"`);
  return parts.join("\n\n");
}

/** Reserve room for the system prompt, instructions and the reply. */
const RESERVED_TOKENS = 1500;
const budgetFor = (contextTokens: number) => Math.max(500, contextTokens - RESERVED_TOKENS);

export function generatePrompt(ctx: StoryContext, direction: string, length: Length, contextTokens: number): string {
  const target = ctx.path.length === 0 ? "the opening chapter of this story" : "the next chapter";
  return [
    storyHeader(ctx, budgetFor(contextTokens), direction),
    `Write ${target}, about ${LENGTH_WORDS[length]} words.`,
    direction.trim() ? `Direction from the author: ${direction.trim()}` : "Use your own judgment about what happens.",
  ].join("\n\n");
}

export function refinePrompt(
  ctx: StoryContext,
  current: { title: string; body: string },
  instruction: string,
  contextTokens: number,
): string {
  // The chapter being revised is not yet part of the path, so it goes in separately.
  return [
    storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.7), `${current.body}\n${instruction}`),
    `Here is the current draft of the chapter being written:\n# ${current.title || "Untitled"}\n\n${current.body}`,
    `Revise it according to this instruction: ${instruction.trim()}\nReturn the complete revised chapter.`,
  ].join("\n\n");
}

export function choicesPrompt(
  ctx: StoryContext,
  current: { title: string; body: string },
  existing: string[],
  contextTokens: number,
): string {
  return [
    storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.5), current.body),
    `Here is the chapter that was just written:\n# ${current.title || "Untitled"}\n\n${current.body}`,
    `Suggest 3 distinct options the reader could pick at the end of this chapter. Each is a short action or decision, under 12 words, written as button text (no numbering).` +
      (existing.length ? ` Do not repeat these existing options: ${existing.map((e) => `"${e}"`).join(", ")}.` : "") +
      `\nReply with only a JSON array of 3 strings.`,
  ].join("\n\n");
}

/** Splits "# Title\n\nbody" output. While streaming, the title may not be complete yet. */
export function parseChapterOutput(text: string): { title: string | null; body: string } {
  const m = text.match(/^\s*#+\s*([^\n]*)\n+([\s\S]*)$/);
  if (m) return { title: m[1].trim(), body: m[2] };
  if (/^\s*#/.test(text) && !text.includes("\n")) return { title: null, body: "" }; // title still arriving
  return { title: null, body: text };
}

export function parseChoices(text: string): string[] {
  const clean = (s: unknown) => String(s).replace(/^[\s\-*\d.)"]+|["\s]+$/g, "").trim();
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      const parsed = JSON.parse(arr[0]);
      if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean).slice(0, 6);
    } catch {
      // fall through to line parsing
    }
  }
  return text.split("\n").map(clean).filter(Boolean).slice(0, 6);
}
