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
  /** The author's style notes for the whole story (point of view, tense, tone, limits). */
  style?: string;
  /** Chapters from the story root down to the chapter being continued; empty for a new story. */
  path: ContextChapter[];
  /** The choice the reader picked to get to the chapter being written, if any. */
  choiceLabel: string | null;
  /** Codex entries in effect at the point being continued. */
  codex?: ContextCodexEntry[];
  /** Hand-picked changes to which codex entries go into the prompt (by entry id). */
  codexOverrides?: CodexOverrides;
  /** Choices already offered on the chapter being continued (so new ideas don't repeat them). */
  siblingChoices?: string[];
};

export type CodexOverrides = { include: string[]; exclude: string[] };

/** A request as it will be sent: the system prompt (if any) and the message. */
export type PromptParts = { system?: string; message: string };

export type Length = "short" | "medium" | "long";
export const LENGTH_WORDS: Record<Length, number> = { short: 300, medium: 600, long: 1000 };

// Rough estimate; good enough for budgeting.
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

const SYSTEM_BASE = `You are a skilled fiction co-author helping write one chapter of a branching, choose-your-own-adventure story.
- If the author gives style notes, follow them; they override your own preferences.
- Match the established voice, point of view and tense. Keep names, facts and tone consistent with the story so far.
- Write only the chapter's prose. Do NOT write the reader's choices, menus, or questions like "What do you do?" — choices are added separately.
- Pick up exactly where the story left off. If the reader made a choice, the chapter opens by carrying it out. Do not recap earlier events. (For a story's first chapter, establish the protagonist, setting and point of view quickly.)
- End on an open situation with real stakes, where several different actions would make sense. Do not resolve the tension, summarise, reflect or moralise at the end.
- Show rather than tell: let actions, dialogue and detail carry emotion instead of explaining feelings, and vary sentence rhythm.
- Plain paragraphs separated by blank lines. No markdown formatting, no commentary, no notes to the author.`;

const OUTPUT_FORMAT = `Output format: the first line is "# " followed by the chapter title. Then a blank line, then the chapter text.`;

export const SYSTEM_CHAPTER = `${SYSTEM_BASE}\n\n${OUTPUT_FORMAT}`;
export const SYSTEM_CHOICES = `You help write branching stories. You reply with a JSON array of strings and nothing else.`;

/**
 * Splits text the author typed into the request itself and any "[...]" notes in it, which are
 * extra instructions for the AI: "Jim picks up the ring [he is nervous]". Brackets that aren't
 * closed are left alone.
 */
export function parseBracketNotes(input: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const text = input
    .replace(/\[([^\[\]]*)\]/g, (_, note: string) => {
      if (note.trim()) notes.push(note.trim().replace(/\s+/g, " "));
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .trim();
  return { text, notes };
}

/** The notes as a block for the prompt, or "" if there are none. */
export function notesBlock(notes: string[], heading = "Additional instructions from the author (follow these closely)"): string {
  return notes.length ? `${heading}:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
}

/**
 * For a request that has to say something even if it is nothing but notes ("[make it tenser]"):
 * the notes become the request itself when there is no other text.
 */
export function parseInstruction(input: string): { text: string; notes: string[] } {
  const { text, notes } = parseBracketNotes(input);
  return text ? { text, notes } : { text: notes.join("; "), notes: [] };
}

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

const chapterLine = (c: ContextChapter) => `- ${c.title}: ${c.summary ?? excerpt(c.body, 300)}`;

/** Room kept for the rolling summary when the per-chapter summaries don't all fit. */
const ROLLING_RESERVE = 500;

/**
 * Splits the story so far into three tiers. Chapters from `firstVerbatim` go in whole; those
 * from `firstListed` up to it go in as their own one-paragraph summaries (each made from the
 * chapter itself, so they don't drift); anything older is covered by a rolling summary.
 */
function storyTiers(path: ContextChapter[], budgetTokens: number) {
  const w = verbatimWindow(path, budgetTokens);
  const lines = path.slice(0, w.firstVerbatim).map(chapterLine);
  const room = budgetTokens - w.used;
  const cost = (l: string) => estimateTokens(l) + 1;
  let firstListed = w.firstVerbatim;
  if (lines.reduce((n, l) => n + cost(l), 0) <= room) {
    firstListed = 0;
  } else {
    let used = Math.min(ROLLING_RESERVE, Math.floor(room / 2));
    for (let i = w.firstVerbatim - 1; i >= 0; i--) {
      if (used + cost(lines[i]) > room) break;
      used += cost(lines[i]);
      firstListed = i;
    }
  }
  return { ...w, lines, firstListed };
}

/**
 * Index of the chapter whose rolling `path_summary` a prompt will want, or -1 if no chapter
 * needs one. Deliberately assumes the tightest budget any prompt uses (choice suggestions
 * with a codex), so summaries made for it also serve the roomier prompts.
 */
export function summaryCoverageIndex(path: ContextChapter[], contextTokens: number): number {
  if (path.length === 0) return -1;
  const budget = Math.floor(Math.max(500, contextTokens - 1500) * 0.5 * 0.75);
  return storyTiers(path, budget).firstListed - 1;
}

/**
 * Builds the "story so far" text within a token budget: the most recent chapters verbatim,
 * the ones before them as per-chapter summaries, and a rolling summary for the oldest.
 */
export function buildStorySoFar(path: ContextChapter[], budgetTokens: number): string {
  if (path.length === 0) return "";
  const { firstVerbatim, verbatimBudget, hugeLast, lines, firstListed } = storyTiers(path, budgetTokens);
  const verbatim = path.slice(firstVerbatim).map((c, i, arr) => {
    const isLast = i === arr.length - 1;
    return hugeLast && isLast
      ? `### ${c.title}\n…${c.body.slice(-verbatimBudget * 4)}`
      : `### ${c.title}\n${c.body}`;
  });

  let rolling = "";
  let listFrom = firstListed;
  if (firstListed > 0) {
    // The nearest stored rolling summary that leaves no gap before the listed chapters.
    const j = path.findIndex((c, i) => i >= firstListed - 1 && i < firstVerbatim && c.path_summary);
    if (j >= 0) {
      rolling = path[j].path_summary!;
      listFrom = j + 1;
    } else {
      rolling = lines[0]; // at least keep how the story began
    }
  }
  const listed = lines.slice(listFrom);

  return [
    rolling && `Earlier in the story:\n${rolling}`,
    listed.length > 0 && `${rolling ? "Then, chapter by chapter" : "Earlier in the story, chapter by chapter"}:\n${listed.join("\n")}`,
    `Most recent chapters:\n${verbatim.join("\n\n")}`,
  ]
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
  if (ctx.style?.trim()) parts.push(`Style notes from the author (follow these in everything you write):\n${ctx.style.trim()}`);
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
  const { text, notes } = parseBracketNotes(direction);
  return [
    storyHeader(ctx, budgetFor(contextTokens), direction),
    `Write ${target}, about ${LENGTH_WORDS[length]} words.`,
    text ? `Direction from the author: ${text}` : "Use your own judgment about what happens.",
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function refinePrompt(
  ctx: StoryContext,
  current: { title: string; body: string },
  instruction: string,
  contextTokens: number,
): string {
  // The chapter being revised is not yet part of the path, so it goes in separately.
  const { text, notes } = parseInstruction(instruction);
  return [
    storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.7), `${current.body}\n${instruction}`),
    `Here is the current draft of the chapter being written:\n# ${current.title || "Untitled"}\n\n${current.body}`,
    `Revise it according to this instruction: ${text}\nChange only what the instruction asks for; keep every other sentence exactly as written. Return the complete revised chapter.`,
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const SYSTEM_PASSAGE = `${SYSTEM_BASE}\n\nYou rewrite one marked passage of a chapter. Reply with only the rewritten passage: no title, no quotation marks, no commentary, and nothing from outside the marked passage.`;

/** Revise just one passage of the chapter (`before` + `passage` + `after` is the whole body); the reply replaces `passage`. */
export function passageRefinePrompt(
  ctx: StoryContext,
  current: { title: string; before: string; passage: string; after: string },
  instruction: string,
  contextTokens: number,
): string {
  const whole = `${current.before}${current.passage}${current.after}`;
  const { text, notes } = parseInstruction(instruction);
  return [
    storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.7), `${whole}\n${instruction}`),
    `Here is the current draft of the chapter being written. The passage to revise is between [[START]] and [[END]]:\n# ${current.title || "Untitled"}\n\n${current.before}[[START]]${current.passage}[[END]]${current.after}`,
    `Revise only the marked passage according to this instruction: ${text}\nChange only what the instruction asks for, and keep roughly the same length unless it says otherwise. Return just the rewritten passage, which will replace the marked text. It must fit with the text before and after it.`,
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What makes a set of choices worth offering; shared by the choice and idea prompts. */
const CHOICE_QUALITY = `Good options lead to meaningfully different outcomes (not variations of one action), are things the protagonist could plausibly do right now, and don't make one option the obvious right answer. Mix kinds, for example one bold, one cautious and one unexpected. Word them consistently, as short imperative phrases like "Follow the stranger".`;

export function choicesPrompt(
  ctx: StoryContext,
  current: { title: string; body: string },
  existing: string[],
  contextTokens: number,
): string {
  return [
    storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.5), current.body),
    `Here is the chapter that was just written:\n# ${current.title || "Untitled"}\n\n${current.body}`,
    `Suggest 3 distinct options the reader could pick at the end of this chapter. ${CHOICE_QUALITY} Each is a short action or decision, under 12 words, written as button text (no numbering).` +
      (existing.length ? ` Do not repeat these existing options: ${existing.map((e) => `"${e}"`).join(", ")}.` : "") +
      `\nReply with only a JSON array of 3 strings.`,
  ].join("\n\n");
}

export const SYSTEM_IDEAS = `You help write branching stories. You reply with a JSON array and nothing else.`;

export type Idea = { choice: string; direction: string };

/**
 * Asks for directions the chapter being written could take. With no choice text yet, each idea
 * is a new choice the reader could pick; once there is one, the ideas all follow from it. Guidance
 * from the author, when there is some, is the premise of the chapter and every idea builds on it.
 */
export function ideasPrompt(ctx: StoryContext, contextTokens: number, guidance = "", earlier: string[] = []): string {
  const existing = ctx.siblingChoices ?? [];
  const { text: given, notes } = parseBracketNotes(guidance);
  const opening = ctx.path.length === 0;
  const chapter = opening ? "the opening chapter" : "the next chapter";
  const avoid = !opening && !ctx.choiceLabel && existing.length
    ? ` These choices already exist, so do not repeat or closely echo them: ${existing.map((e) => `"${e}"`).join(", ")}.`
    : "";
  const choiceField = opening || ctx.choiceLabel
    ? `"choice" (a short name for the idea, under 12 words)`
    : `"choice" (button text for the choice the reader could pick at the end of the last chapter to reach it, under 12 words)`;
  const inChapter = opening ? "in the opening chapter" : "in the chapter";
  let ask: string;
  if (given) {
    ask =
      `The author has described what ${chapter} is about: "${given}"` +
      `\nTreat this as the premise of the chapter. Every idea must include the events it describes, and none may skip or contradict them. Suggest 4 distinct ways to write ${chapter} from this premise` +
      (ctx.choiceLabel ? `, each following from the reader's choice.` : `.`) +
      avoid +
      `\nFor each give ${choiceField} and "direction" (one or two sentences on what happens ${inChapter}: the events of the premise, then where this idea takes them that the other ideas don't).`;
  } else if (opening) {
    ask =
      `Suggest 4 distinct ways this story could open.` +
      `\nFor each give ${choiceField} and "direction" (one or two sentences on what happens ${inChapter}).`;
  } else if (ctx.choiceLabel) {
    ask =
      `Suggest 4 distinct ways the next chapter could play out, each following from the reader's choice.` +
      `\nFor each give ${choiceField} and "direction" (one or two sentences on what happens ${inChapter}).`;
  } else {
    ask =
      `Suggest 4 distinct directions the story could take from the end of the last chapter, each a new choice the reader could pick there.` +
      avoid +
      `\nFor each give "choice" (button text, under 12 words) and "direction" (one or two sentences on what happens in the chapter that follows it).`;
  }
  const variety = given
    ? `Make the ideas differ in kind (tone, risk, or which character drives the chapter) in how they play out the premise, not by leaving it out.`
    : `Make the ideas differ in kind (tone, risk, or which character drives the chapter), not small variations of one plot.`;
  const reply = `\n${variety} ${CHOICE_QUALITY}\nReply with only a JSON array of 4 objects like [{"choice":"...","direction":"..."}].`;
  if (notes.length) ask += `\n${notesBlock(notes, "Also follow these instructions from the author in every idea")}`;
  if (earlier.length) {
    ask += `\nThese ideas were already suggested, so give different ones: ${earlier.map((e) => `"${e}"`).join(", ")}.`;
  }
  return [storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.7), given), ask + reply].join("\n\n");
}

export const SYSTEM_CHOICE_LABEL = `You help write branching stories. You reply with the button text and nothing else.`;

/**
 * Asks for the text of the button a reader would click on the previous chapter. With a written
 * chapter it describes how to reach that chapter; without one it proposes something worth choosing.
 */
export function choiceLabelPrompt(ctx: StoryContext, chapter: { title: string; body: string } | null, contextTokens: number): string {
  const format = `in a single sentence of under 12 words, with no quotes or numbering.\nReply with only that one sentence.`;
  return [
    storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.5), chapter?.body ?? ""),
    ...(chapter
      ? [
          `Here is the chapter that was just written:\n# ${chapter.title || "Untitled"}\n\n${chapter.body}`,
          `Write the text of the button a reader would click at the end of the previous chapter to get to this one: a short action or decision ${format}`,
        ]
      : [
          `No chapter has been written after the last one yet. Suggest an interesting, surprising choice the reader could make at the end of the last chapter: a short action or decision that opens a new direction for the story, written as button text ${format}`,
        ]),
  ].join("\n\n");
}

/** Takes the first sentence of the reply, without quotes, bullets or a trailing full stop. */
export function parseChoiceLabel(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const first = line.replace(/^[-*\d.)\s]+/, "").replace(/^["'“‘]+/, "").split(/(?<=[.!?])["'”’]?\s+/)[0];
  return first.replace(/["'”’]+$/, "").replace(/\.$/, "").trim();
}

export function parseIdeas(text: string, max = 6): Idea[] {
  const arr = text.match(/\[[\s\S]*\]/);
  if (!arr) return [];
  try {
    const parsed = JSON.parse(arr[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => ({
        choice: typeof x?.choice === "string" ? x.choice.trim() : "",
        direction: typeof x?.direction === "string" ? x.direction.trim() : "",
      }))
      .filter((x) => x.choice)
      .slice(0, max);
  } catch {
    return [];
  }
}

export const SYSTEM_PLAN_STEPS = `You help write branching stories. You reply with a JSON array and nothing else.`;

/**
 * A plan step (write-ahead runs): for a chapter that was just written, what happens in the chapter each
 * of `labels` leads to (planned together so they differ in kind), plus `add` new choices with their plans.
 * `ctx.path` is the story up to but not including `chapter`. Reply: a JSON array of {choice, direction},
 * the given labels first, in order, unchanged; read it with `parseIdeas(text, 12)` and `matchSteps`.
 * With only `add` (no labels) it suggests the choices for a new chapter.
 */
export function planStepsPrompt(
  ctx: StoryContext,
  chapter: { title: string; body: string },
  labels: string[],
  add: number,
  contextTokens: number,
): string {
  const quote = (l: string) => `“${l}”`;
  const parts = [
    storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.6), chapter.body),
    `Here is the chapter that was just written:\n# ${chapter.title || "Untitled"}\n\n${chapter.body}`,
  ];
  const other = (ctx.siblingChoices ?? []).filter((s) => !labels.includes(s));
  let ask = "";
  if (labels.length) {
    ask +=
      `These choices are offered at its end: ${labels.map(quote).join(", ")}.` +
      `\nFor each, say in one or two sentences what happens in the chapter it leads to, so the chapters differ in kind (tone, risk, or which character drives the chapter) and none repeats another.`;
  }
  if (add > 0) {
    ask += (ask ? "\nThen suggest" : "Suggest") + ` ${add} new choice${add === 1 ? "" : "s"} to offer as well, with what happens after each.`;
    const avoid = [...labels, ...other];
    if (avoid.length) ask += ` Do not repeat or closely echo these: ${avoid.map(quote).join(", ")}.`;
    ask += ` ${CHOICE_QUALITY} Each new choice is a short action or decision, under 12 words, written as button text.`;
  }
  const total = labels.length + add;
  ask +=
    `\nReply with only a JSON array of ${total} object${total === 1 ? "" : "s"} like [{"choice":"...","direction":"..."}]` +
    (labels.length ? `, the given choices first, in the order above, with "choice" exactly as written above, then any new ones.` : `.`);
  parts.push(ask);
  return parts.join("\n\n");
}

export type PlanStep = { label: string; direction: string; isNew: boolean };

/**
 * Pairs a plan step's reply with the given labels. Each label takes the reply item with the same text
 * (ignoring case and quotes) if there is one, else the item at the same position; a label with no plan
 * gets an empty direction. Items left over are new choices, in order.
 */
export function matchSteps(labels: string[], ideas: Idea[]): PlanStep[] {
  const norm = (s: string) => s.toLowerCase().replace(/[\s"'“”‘’.!?]+/g, " ").trim();
  const used = new Set<number>();
  const found: (number | null)[] = labels.map((l) => {
    const i = ideas.findIndex((x, k) => !used.has(k) && norm(x.choice) === norm(l));
    if (i >= 0) used.add(i);
    return i >= 0 ? i : null;
  });
  const steps: PlanStep[] = labels.map((label, n) => {
    let i = found[n];
    // No text match: take the item at the same position if nothing else claimed it and it isn't another label's text.
    if (i === null && n < ideas.length && !used.has(n) && !labels.some((l) => norm(l) === norm(ideas[n].choice))) {
      i = n;
      used.add(n);
    }
    return { label, direction: i === null ? "" : ideas[i].direction, isNew: false };
  });
  ideas.forEach((x, k) => {
    if (!used.has(k)) steps.push({ label: x.choice, direction: x.direction, isNew: true });
  });
  return steps;
}

export const SYSTEM_ARC_PLAN = `You help write branching stories. You plan a stretch of chapters that leads to a goal the author names. You reply with a JSON array and nothing else.`;

/**
 * Reach a goal (D6): plans `chapters` chapters, one after another from the end of the last chapter, that get the
 * story to what the author wants to happen. `ctx.path` is the story so far. Each step is `choice` (button text for
 * the choice that leads into that chapter, under 12 words) and `direction` (what happens in it); only the last
 * step reaches the goal. Read the reply with `parseIdeas(text, chapters)`.
 */
export function arcPlanPrompt(ctx: StoryContext, objective: string, chapters: number, contextTokens: number): string {
  const { text: goal, notes } = parseBracketNotes(objective);
  const ask =
    `The author wants the story to reach this: "${goal}"` +
    `\nPlan exactly ${chapters} chapter${chapters === 1 ? "" : "s"}, one after another, starting from the end of the last chapter, that get the story there. ` +
    (chapters === 1
      ? `That one chapter reaches the goal.`
      : `Each chapter follows naturally from the one before it, and only the last one reaches the goal; the earlier ones build toward it without arriving.`) +
    `\nFor each give "choice" (button text, under 12 words, for the choice the reader picks at the end of the chapter before it to get into this chapter) and "direction" (one or two sentences on what happens in this chapter).` +
    (notes.length ? `\n${notesBlock(notes, "Also follow these instructions from the author")}` : "") +
    `\n${CHOICE_QUALITY}` +
    `\nReply with only a JSON array of ${chapters} object${chapters === 1 ? "" : "s"} like [{"choice":"...","direction":"..."}], in story order.`;
  return [storyHeader(ctx, Math.floor(budgetFor(contextTokens) * 0.7), goal), ask].join("\n\n");
}

/**
 * The direction a chapter of a Reach a goal chain is written from (step `index` of `total`, 0 for the first):
 * what it is part of, what happens in it, and whether it arrives at the goal or only builds toward it.
 */
export function arcDirection(objective: string, step: { direction: string }, index: number, total: number, nextChoice?: string): string {
  const { text: goal } = parseBracketNotes(objective);
  const head = `This chapter is part ${index + 1} of ${total} of a stretch of the story heading toward: ${goal}.`;
  const what = step.direction.trim() ? ` In this chapter: ${step.direction.trim()}` : "";
  const last = index + 1 >= total;
  const end = last
    ? ` This chapter reaches that goal.`
    : ` Don't reach that goal yet${nextChoice ? `; end where “${nextChoice}” is a natural next step` : ""}.`;
  return `${head}${what}${end}`;
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
