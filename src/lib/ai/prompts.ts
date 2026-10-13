// Prompt construction for chapter drafting. Pure functions, no network.

export type ContextChapter = {
  /** Present for chapters loaded from the server; needed to save generated summaries. */
  id?: string;
  revision?: number;
  title: string;
  body: string;
  summary: string | null;
  path_summary: string | null;
};

export type ContextCodexEntry = {
  /** Present for entries loaded from the server; used to pin or exclude them by hand. */
  id?: string;
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
  /** Hand-picked changes to which codex entries go into the prompt (by entry id). */
  codexOverrides?: CodexOverrides;
};

export type CodexOverrides = { include: string[]; exclude: string[] };

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
 * Finds how many of the most recent chapters fit verbatim in the budget. Chapters before
 * `firstVerbatim` have to be condensed. The chapter being continued is always included.
 */
function verbatimWindow(path: ContextChapter[], budgetTokens: number) {
  const verbatimBudget = Math.floor(budgetTokens * 0.7);
  let used = 0;
  let firstVerbatim = path.length;
  let hugeLast = false;
  for (let i = path.length - 1; i >= 0; i--) {
    const cost = estimateTokens(`### ${path[i].title}\n${path[i].body}`);
    if (i === path.length - 1 && cost > verbatimBudget) {
      hugeLast = true; // included anyway, trimmed from the front
      used = verbatimBudget;
      firstVerbatim = i;
      break;
    }
    if (used + cost > verbatimBudget) break;
    used += cost;
    firstVerbatim = i;
  }
  return { firstVerbatim, used, verbatimBudget, hugeLast };
}

/**
 * Index of the chapter whose rolling `path_summary` a prompt will want, or -1 if the whole
 * path fits verbatim. Deliberately assumes the tightest budget any prompt uses (choice
 * suggestions with a codex), so summaries made for it also serve the roomier prompts.
 */
export function summaryCoverageIndex(path: ContextChapter[], contextTokens: number): number {
  if (path.length === 0) return -1;
  const budget = Math.floor(Math.max(500, contextTokens - 1500) * 0.5 * 0.75);
  return verbatimWindow(path, budget).firstVerbatim - 1;
}

/**
 * Builds the "story so far" text within a token budget. The most recent chapters are
 * included verbatim; earlier ones are condensed (a stored summary, or an excerpt).
 */
export function buildStorySoFar(path: ContextChapter[], budgetTokens: number): string {
  if (path.length === 0) return "";
  const { firstVerbatim, used, verbatimBudget, hugeLast } = verbatimWindow(path, budgetTokens);
  const verbatim = path.slice(firstVerbatim).map((c, i, arr) => {
    const isLast = i === arr.length - 1;
    return hugeLast && isLast
      ? `### ${c.title}\n…${c.body.slice(-verbatimBudget * 4)}`
      : `### ${c.title}\n${c.body}`;
  });

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

export type CodexStatus = {
  entry: ContextCodexEntry;
  /** Why the entry would be picked without any manual changes. */
  auto: "always" | "mentioned" | null;
  /** included = in the prompt; too-long = wanted but over the budget; excluded = switched off by hand. */
  state: "included" | "too-long" | "excluded" | "off";
  /** Switched on by hand although nothing in the text triggers it. */
  pinned: boolean;
};

export const codexKey = (e: ContextCodexEntry) => e.id ?? e.name;

function codexLine(e: ContextCodexEntry): string {
  const alias = e.aliases.length ? ` (also: ${e.aliases.join(", ")})` : "";
  return `- ${e.name} [${e.type}]${alias}: ${e.content.replace(/\s+/g, " ").trim()}`;
}

/** What the prompt builder will do with every codex entry, and why. */
export function explainCodex(
  entries: ContextCodexEntry[],
  triggerText: string,
  budgetTokens: number,
  overrides?: CodexOverrides,
): CodexStatus[] {
  const include = new Set(overrides?.include ?? []);
  const exclude = new Set(overrides?.exclude ?? []);
  const rows: CodexStatus[] = entries.map((entry) => {
    const auto = entry.always_include ? "always" : mentions(entry, triggerText) ? "mentioned" : null;
    const key = codexKey(entry);
    const pinned = auto === null && include.has(key);
    const state = exclude.has(key) ? "excluded" : auto || pinned ? "included" : "off";
    return { entry, auto, pinned, state };
  });
  // "Always include" entries get the budget first, then the rest in codex order.
  const order = [...rows.filter((r) => r.entry.always_include), ...rows.filter((r) => !r.entry.always_include)];
  let used = 0;
  for (const r of order) {
    if (r.state !== "included") continue;
    const cost = estimateTokens(codexLine(r.entry));
    if (used + cost > budgetTokens) r.state = "too-long"; // skip what doesn't fit, but keep trying smaller ones
    else used += cost;
  }
  return rows;
}

/**
 * Picks codex entries for the prompt within a token budget: "always include" entries first,
 * then entries mentioned in the recent text (or added by hand), in codex order.
 */
export function buildCodexBlock(
  entries: ContextCodexEntry[],
  triggerText: string,
  budgetTokens: number,
  overrides?: CodexOverrides,
): string {
  const rows = explainCodex(entries, triggerText, budgetTokens, overrides).filter((r) => r.state === "included");
  const chosen = [...rows.filter((r) => r.entry.always_include), ...rows.filter((r) => !r.entry.always_include)];
  const lines = chosen.map((r) => codexLine(r.entry));
  return lines.length ? `Codex (established facts; stay consistent with these):\n${lines.join("\n")}` : "";
}

/** The text that decides which entries are relevant: the premise, recent chapters and what is being written. */
export function codexTrigger(ctx: StoryContext, extraTrigger = ""): string {
  return [ctx.premise, ...ctx.path.slice(-3).map((c) => c.body), ctx.choiceLabel ?? "", extraTrigger].join("\n");
}

/** The share of the context budget given to the codex. */
export const codexBudget = (budgetTokens: number) => Math.floor(budgetTokens * 0.25);

function storyHeader(ctx: StoryContext, budgetTokens: number, extraTrigger = ""): string {
  const parts = [`Story: ${ctx.storyTitle || "(untitled)"}`];
  if (ctx.premise.trim()) parts.push(`Premise: ${ctx.premise.trim()}`);
  if (ctx.codex?.length) {
    // Entries are triggered by the premise, the last few chapters, and whatever is being written now.
    const block = buildCodexBlock(ctx.codex, codexTrigger(ctx, extraTrigger), codexBudget(budgetTokens), ctx.codexOverrides);
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
export const budgetFor =(contextTokens: number) => Math.max(500, contextTokens - RESERVED_TOKENS);

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
