// Importing a finished story from a text or Markdown file (New story › Import a story). The text is cut into
// paragraphs once, and everything after that works on paragraph numbers: the AI only says after which paragraph
// each chapter ends (and what the character does next), so the story's own words are kept exactly. Used by the
// server's import job (worker/importText.ts), the review page and the route that creates the story.
import { z } from "zod";
import { LIMITS } from "./limits";

export const IMPORT_LIMITS = {
  /** About 35,000 words: short stories, not novels. */
  text: 220_000,
  paragraphs: 3000,
  minWords: { min: 50, max: 3000 },
  maxWords: { min: 100, max: 5000 },
  /** Other choices suggested at each break; with the original one they must fit a chapter's choices. */
  alternatives: 4,
};

export const importDraftKey = (id: string) => `import:${id}`;
export const importHref = (id: string) => `/new/import/${id}`;

export const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export type ParsedText = {
  /** A level-1 heading before the first paragraph, taken as the story's title. */
  title: string | null;
  paragraphs: string[];
  /** Paragraphs that come straight after a heading or a scene break (`***`, `---`): good places to break. */
  breaks: number[];
  /** The heading before a paragraph, by paragraph index: a title for the chapter starting there. */
  headings: Record<number, string>;
};

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const SCENE_BREAK = /^\s*(?:(?:[*\-_=~•·]\s*){3,}|#)\s*$/;

/**
 * Cuts the text into paragraphs at blank lines (or at every line break, for a text with no blank lines at all).
 * Headings and scene breaks are not part of any paragraph: they only mark where a chapter could start.
 */
export function parseStoryText(input: string): ParsedText {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  let blocks = text.split(/\n[ \t]*\n/);
  if (blocks.filter((b) => b.trim()).length === 1 && text.trim().split("\n").length > 3) blocks = text.split("\n");
  const out: ParsedText = { title: null, paragraphs: [], breaks: [], headings: {} };
  let pendingBreak = false;
  let pendingHeading: string | null = null;
  for (const raw of blocks) {
    const block = raw.replace(/^\n+|\s+$/g, "");
    if (!block.trim()) continue;
    const lines = block.split("\n");
    // A heading on the block's first line, with text under it in the same block, still counts as a heading.
    const heading = HEADING.exec(lines[0].trim());
    if (heading) {
      const level = lines[0].trim().indexOf(" ");
      if (out.paragraphs.length === 0 && out.title === null && level === 1 && !pendingHeading) out.title = heading[1].trim();
      else {
        pendingBreak = true;
        pendingHeading = heading[1].trim();
      }
      const rest = lines.slice(1).join("\n").trim();
      if (!rest) continue;
      push(rest);
      continue;
    }
    if (SCENE_BREAK.test(block)) {
      pendingBreak = true;
      continue;
    }
    push(block.trim());
  }
  return out;

  function push(p: string) {
    const i = out.paragraphs.length;
    out.paragraphs.push(p);
    if (pendingBreak && i > 0) out.breaks.push(i);
    if (pendingHeading) out.headings[i] = pendingHeading.slice(0, LIMITS.title);
    pendingBreak = false;
    pendingHeading = null;
  }
}

// ---- the draft the import keeps its work in ----

const modelRef = z.object({ connectionId: z.string(), model: z.string() }).nullable();

export const importOptionsSchema = z
  .object({
    minWords: z.number().int().min(IMPORT_LIMITS.minWords.min).max(IMPORT_LIMITS.minWords.max),
    maxWords: z.number().int().min(IMPORT_LIMITS.maxWords.min).max(IMPORT_LIMITS.maxWords.max),
    alternatives: z.number().int().min(0).max(IMPORT_LIMITS.alternatives),
    model: modelRef,
  })
  .refine((o) => o.maxWords > o.minWords, { message: "The longest chapter must be longer than the shortest" });
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { minWords: 300, maxWords: 600, alternatives: 2, model: null };

const label = z.string().trim().max(LIMITS.label);

/** One chapter of the plan: it starts at paragraph `start` and runs to the next chapter's start. */
export const planChapterSchema = z.object({
  start: z.number().int().min(0),
  title: z.string().trim().max(LIMITS.title),
  /** The choice the original story takes at the end of this chapter; "" on the last chapter. */
  choice: label,
  /** Other choices (other endings, on the last chapter); only the kept ones are saved as unwritten choices. */
  alternatives: z.array(z.object({ label, keep: z.boolean() })).max(LIMITS.choices),
});
export type PlanChapter = z.infer<typeof planChapterSchema>;

export const importPlanSchema = z.object({
  title: z.string().trim().max(LIMITS.title),
  premise: z.string().trim().max(LIMITS.premise),
  style: z.string().trim().max(LIMITS.style),
  chapters: z.array(planChapterSchema).max(LIMITS.runChapters),
});
export type ImportPlan = z.infer<typeof importPlanSchema>;

export type ImportStatus = "splitting" | "ready" | "failed";

/** The import's draft (key `import:<id>`): the text, what was asked for, and the plan once the AI has made it. */
export type ImportDraft = {
  key: string;
  href: string;
  label: string;
  updatedAt: number;
  /** What the drafts list shows. */
  storyTitle: string;
  title: string;
  kind: "import";
  status: ImportStatus;
  /** What the import job is doing now ("Finding the breaks, part 1 of 2"). */
  progress?: string;
  error?: string;
  options: ImportOptions;
  paragraphs: string[];
  breaks: number[];
  headings: Record<number, string>;
  /** The title found in the text, if any. */
  textTitle: string | null;
  plan: ImportPlan | null;
};

export function newImportDraft(id: string, parsed: ParsedText, options: ImportOptions): ImportDraft {
  const name = parsed.title ?? "";
  return {
    key: importDraftKey(id),
    href: importHref(id),
    label: `Import: ${name || "a story"}`,
    updatedAt: 0,
    storyTitle: name,
    title: "",
    kind: "import",
    status: "splitting",
    progress: "Waiting for its turn",
    options,
    paragraphs: parsed.paragraphs,
    breaks: parsed.breaks,
    headings: parsed.headings,
    textTitle: parsed.title,
    plan: null,
  };
}

// ---- chapters from the plan ----

/** Each chapter's paragraphs, as [start, end) (end is the next chapter's start, or the last paragraph + 1). */
export function chapterRanges(chapters: { start: number }[], paragraphCount: number): { start: number; end: number }[] {
  return chapters.map((c, i) => ({ start: c.start, end: i + 1 < chapters.length ? chapters[i + 1].start : paragraphCount }));
}

export const chapterBody = (paragraphs: string[], range: { start: number; end: number }) => paragraphs.slice(range.start, range.end).join("\n\n");

export function rangeWords(paragraphs: string[], range: { start: number; end: number }): number {
  let n = 0;
  for (let i = range.start; i < range.end; i++) n += countWords(paragraphs[i]);
  return n;
}

/** What is wrong with the plan before it can be made into a story; empty when it is fine. */
export function planProblems(plan: ImportPlan, paragraphCount: number): string[] {
  const problems: string[] = [];
  if (!plan.title.trim()) problems.push("The story needs a title.");
  if (plan.chapters.length === 0) problems.push("There are no chapters.");
  if (plan.chapters[0] && plan.chapters[0].start !== 0) problems.push("The first chapter must start at the first paragraph.");
  plan.chapters.forEach((c, i) => {
    const n = i + 1;
    const next = plan.chapters[i + 1];
    if (next && next.start <= c.start) problems.push(`Chapter ${n} has no paragraphs.`);
    if (c.start >= paragraphCount) problems.push(`Chapter ${n} starts after the end of the story.`);
    if (!c.title.trim()) problems.push(`Chapter ${n} needs a title.`);
    if (next && !c.choice.trim()) problems.push(`Chapter ${n} needs the choice that leads to chapter ${n + 1}.`);
    const kept = c.alternatives.filter((a) => a.keep && a.label.trim()).length;
    if (kept + (next ? 1 : 0) > LIMITS.choices) problems.push(`Chapter ${n} has more than ${LIMITS.choices} choices.`);
  });
  return problems;
}

// ---- splitting with the AI ----

/** How many words of the story one request to find the breaks may hold, for the model's context size. */
export function windowWords(contextTokens: number): number {
  // About half the window for the story (a word is about 1.4 tokens), the rest for the instructions and the reply.
  return Math.max(800, Math.min(8000, Math.floor(((contextTokens - 1500) * 0.5) / 1.4)));
}

/** The paragraphs [from, to) that fit in one request, at least one. */
export function windowEnd(paragraphs: string[], from: number, words: number): number {
  let total = 0;
  let to = from;
  while (to < paragraphs.length) {
    total += countWords(paragraphs[to]);
    if (total > words && to > from) break;
    to++;
  }
  return to;
}

export const SYSTEM_SPLIT = `You help turn a finished story into a branching story. You divide it into short chapters, each ending at a decision point: a moment where the main character makes a choice that the next chapter follows. You never change the story's text. You reply with a JSON array and nothing else.`;

/** The request for the breaks in paragraphs [from, to), numbered from 1 for the whole story. */
export function splitPrompt(p: {
  paragraphs: string[];
  from: number;
  to: number;
  minWords: number;
  maxWords: number;
  /** Paragraph indexes after a heading or scene break. */
  breaks: number[];
  /** This part ends the story. */
  last: boolean;
}): string {
  const numbered: string[] = [];
  for (let i = p.from; i < p.to; i++) numbered.push(`[${i + 1}] (${countWords(p.paragraphs[i])} words) ${p.paragraphs[i]}`);
  const hints = p.breaks.filter((b) => b > p.from && b < p.to).map((b) => b + 1);
  const first = p.from + 1;
  const lastNo = p.to;
  return [
    `Here is ${p.from === 0 ? (p.last ? "a story" : "the start of a story") : `part of a story, from paragraph ${first}`}, one numbered paragraph per line:`,
    numbered.join("\n"),
    "---",
    [
      `TASK: Divide paragraphs ${first} to ${lastNo} into chapters of ${p.minWords} to ${p.maxWords} words. Add up the word counts given for each paragraph.`,
      "End each chapter right after a decision point: the main character is about to choose what to do, and the next chapter follows that choice. When there is no clear decision in the right stretch, end at a scene change or a moment of suspense.",
      hints.length ? `The author marked a scene break or heading before paragraphs ${hints.join(", ")}; these are good places to start a chapter.` : "",
      p.last
        ? `The last chapter must end at paragraph ${lastNo}, the end of the story.`
        : `The text stops at paragraph ${lastNo} in the middle of the story, so the last chapter you give may end before it.`,
      `For each chapter give:
- "end": the number of its last paragraph
- "title": a short chapter title
- "choice": what the main character decides at the end of this chapter, which the next chapter follows, written as button text a reader would click (a short action under 12 words, no quotes)${p.last ? `. For the chapter that ends the story, use ""` : ""}`,
      `Reply with only a JSON array like [{"end": 7, "title": "The Alley", "choice": "Follow the stranger into the alley"}].`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  ].join("\n\n");
}

export type SplitEntry = { end: number; title: string; choice: string };

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/^[\s"'“‘]+|[\s"'”’]+$/g, "").replace(/\.$/, "").trim().slice(0, max) : "";

/**
 * Reads the reply: chapters as the index after their last paragraph (so `end` is exclusive, like `chapterRanges`),
 * only those inside (from, to], in order. Null when nothing could be read.
 */
export function parseSplit(reply: string, from: number, to: number): SplitEntry[] | null {
  const m = reply.replace(/```(?:json)?/gi, "").match(/\[[\s\S]*\]/);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: SplitEntry[] = [];
  for (const x of parsed) {
    const end = Number((x as { end?: unknown })?.end);
    if (!Number.isInteger(end)) continue;
    // The reply numbers paragraphs from 1, so its "end" is the index one past the chapter's last paragraph.
    if (end <= from || end > to || (out.length && end <= out[out.length - 1].end)) continue;
    out.push({ end, title: clean((x as { title?: unknown }).title, LIMITS.title), choice: clean((x as { choice?: unknown }).choice, LIMITS.label) });
  }
  return out.length ? out : null;
}

/**
 * Breaks made without the AI (when its replies can't be read): chapters of about the middle of the range, ending
 * before a marked scene break when one is close.
 */
export function fallbackSplit(paragraphs: string[], from: number, to: number, minWords: number, maxWords: number, breaks: number[]): number[] {
  const target = (minWords + maxWords) / 2;
  const marked = new Set(breaks);
  const ends: number[] = [];
  let words = 0;
  for (let i = from; i < to; i++) {
    words += countWords(paragraphs[i]);
    const next = i + 1;
    if (next >= to) break;
    if ((words >= minWords && marked.has(next)) || words >= target) {
      ends.push(next);
      words = 0;
    }
  }
  return [...ends, to];
}

/** Joins chapters far shorter than asked for (under half the shortest) to the one after them; the last to the one before. */
export function mergeShort(paragraphs: string[], entries: SplitEntry[], from: number, minWords: number): SplitEntry[] {
  const out: SplitEntry[] = [];
  let start = from;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const short = rangeWords(paragraphs, { start, end: e.end }) < minWords / 2;
    if (short && i < entries.length - 1) {
      // The next chapter takes these paragraphs; it keeps its own title and choice, or this title if it has none.
      entries[i + 1] = { ...entries[i + 1], title: entries[i + 1].title || e.title };
      continue;
    }
    if (short && out.length > 0) {
      out[out.length - 1] = { ...out[out.length - 1], end: e.end, choice: e.choice };
      start = e.end;
      continue;
    }
    out.push(e);
    start = e.end;
  }
  return out;
}

export const SYSTEM_ALTERNATIVES = `You help turn a finished story into a branching story: at the end of a chapter you suggest other choices the main character could have made, each opening a different path from the original story's.
Each option is a short action or decision, under 12 words, written as button text (no numbering).
You reply with a JSON array of strings and nothing else.`;

/** The request for other choices at the end of a chapter (other endings, after the last one). */
export function alternativesPrompt(p: {
  storyTitle: string;
  storySoFar: string;
  chapter: { title: string; body: string };
  /** The choice the original story takes; null after the last chapter. */
  original: string | null;
  count: number;
}): string {
  const task = p.original
    ? `TASK: In the original story, the main character now chooses: "${p.original}". Suggest ${p.count} other choices they could make at this point instead, each clearly different from that one and from each other, and each fitting the characters and the moment.`
    : `TASK: This is where the original story ends. Suggest ${p.count} choices the main character could make here instead, each leading to a different ending, fitting the characters and the moment.`;
  return [
    `Story: ${p.storyTitle || "Untitled"}`,
    p.storySoFar ? `What happened before this chapter:\n${p.storySoFar}` : "",
    `The chapter:\n# ${p.chapter.title || "Untitled"}\n\n${p.chapter.body}`,
    "---",
    `${task}\n\nReply with only a JSON array of ${p.count} strings.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const SYSTEM_DETAILS = `You help set up a story in a writing app. You reply with a JSON object and nothing else.`;

/** The request for the story's title (when the text has none), summary and style notes, from its opening. */
export function detailsPrompt(opening: string, needTitle: boolean): string {
  return [
    `Here is the opening of a story:\n\n${opening}`,
    "---",
    `TASK: Write ${needTitle ? `a short title for the story, ` : ""}a summary of what the story is about in one or two sentences (without giving away the ending), and style notes for a writer continuing it: point of view, tense, tone, and how the prose reads, in one to three short sentences.`,
    `Reply with only a JSON object like {${needTitle ? `"title": "...", ` : ""}"premise": "...", "style": "..."}.`,
  ].join("\n\n");
}

export function parseDetails(reply: string): { title: string; premise: string; style: string } {
  const stripped = reply.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  let o: Record<string, unknown> = {};
  if (start !== -1 && end > start) {
    try {
      o = JSON.parse(stripped.slice(start, end + 1));
    } catch {
      o = {};
    }
  }
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return { title: s(o.title, LIMITS.title), premise: s(o.premise, LIMITS.premise), style: s(o.style, LIMITS.style) };
}

/** The first words of the story, whole paragraphs, for the details request. */
export function openingText(paragraphs: string[], words: number): string {
  const out: string[] = [];
  let n = 0;
  for (const p of paragraphs) {
    if (n >= words && out.length) break;
    out.push(p);
    n += countWords(p);
  }
  return out.join("\n\n");
}
