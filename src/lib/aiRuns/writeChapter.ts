// What a run does to write one chapter, in three parts that can be called on their own (so the runner can group them
// by model, D20): `writeText` (the main model), `planNext` (the cheap model: the new chapter's choices, each planned
// together, D22) and `summarize` (the cheap model). The steps repeat what the writing page does, without its UI.
import { streamChat, type AiSourceIds, type ChatRequest } from "../ai/client";
import {
  generatePrompt,
  matchSteps,
  parseChapterOutput,
  parseIdeas,
  planStepsPrompt,
  SYSTEM_CHAPTER,
  SYSTEM_PLAN_STEPS,
  type StoryContext,
} from "../ai/prompts";
import { ensurePathSummaries, neededSummaryIndex, parseSummaryReply, summaryRequest, type Summaries } from "../ai/summaries";
import { LIMITS } from "../limits";
import type { ModelRef, Settings } from "../settingsSchema";
import type { ChapterContext } from "./api";
import type { RunOptions } from "./types";

/** The AI call the run uses; the real one streams from the browser. Tests replace it. */
export type Stream = (settings: Settings, req: ChatRequest) => AsyncIterable<string>;
export const defaultStream: Stream = streamChat;

/** Which model a request goes to: the writing model, or the cheaper one, which "Use the writing model for everything" (D20) replaces. */
export function modelRequest(options: RunOptions, role: "main" | "cheap"): { role: "main" | "cheap"; model: ModelRef | null } {
  if (role === "main" || options.models === "writing") return { role: "main", model: options.model ?? null };
  return { role: "cheap", model: options.suggestModel ?? null };
}

async function complete(stream: Stream, settings: Settings, req: ChatRequest, onText?: (soFar: string) => void): Promise<string> {
  let out = "";
  for await (const piece of stream(settings, req)) {
    if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    out += piece;
    onText?.(out);
  }
  return out;
}

/** The prompt's story context for continuing from a chapter: `context.path` ends at the parent. */
export function storyContextOf(context: ChapterContext, label: string | null, siblingChoices: string[] = context.choices.map((c) => c.label)): StoryContext {
  return {
    storyTitle: context.story.title,
    premise: context.story.premise,
    style: context.story.style,
    path: context.path,
    choiceLabel: label,
    codex: context.codex,
    siblingChoices,
  };
}

/**
 * Makes sure the older chapters of the path have the rolling summaries a prompt needs, as the writing page does.
 * A failure falls back silently: the prompt then uses short excerpts.
 */
export async function withPathSummaries(settings: Settings, ctx: StoryContext, signal?: AbortSignal, onStatus?: (text: string) => void, f?: typeof fetch, source?: AiSourceIds): Promise<StoryContext> {
  const upTo = neededSummaryIndex(ctx.path, settings.contextTokens);
  if (upTo < 0) return ctx;
  try {
    const made = await ensurePathSummaries(settings, ctx.path, upTo, {
      story: { title: ctx.storyTitle, premise: ctx.premise },
      signal,
      fetch: f,
      source,
      onProgress: (done, total) => onStatus?.(`Summarizing the story so far (${Math.min(done + 1, total)} of ${total})…`),
    });
    return { ...ctx, path: ctx.path.map((c) => (c.id && made[c.id] ? { ...c, summary: made[c.id].summary, path_summary: made[c.id].path_summary } : c)) };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return ctx;
  }
}

/** Writes the chapter's text with the main model. No title falls back to the choice's text; an empty body is an error. */
export async function writeText(
  settings: Settings,
  p: { ctx: StoryContext; label: string; direction: string; options: RunOptions; signal?: AbortSignal; onText?: (text: string) => void; stream?: Stream; source?: AiSourceIds },
): Promise<{ title: string; body: string }> {
  const prompt = generatePrompt(p.ctx, p.direction, p.options.length ?? "medium", settings.contextTokens);
  const text = await complete(
    p.stream ?? defaultStream,
    settings,
    { system: SYSTEM_CHAPTER, messages: [{ role: "user", content: prompt }], ...modelRequest(p.options, "main"), signal: p.signal, source: { label: "AI run: write", ...p.source } },
    p.onText && ((soFar) => p.onText!(soFar)),
  );
  const { title, body } = parseChapterOutput(text);
  if (!body.trim()) throw new Error("The model sent back no chapter text.");
  return { title: (title ?? "").trim() || p.label, body: body.trim() };
}

export type PlannedChoice = { label: string; direction: string; isNew: boolean };

const norm = (s: string) => s.toLowerCase().replace(/[\s"'“”‘’.!?]+/g, " ").trim();

/**
 * One request that plans a chapter's choices together (D22): what happens after each of the `given` ones, and
 * `suggest` new choices with their plans. `ctx.path` is the story before `chapter`. The new choices are cleaned
 * (blanks and repeats of any choice already there dropped) and kept to what `LIMITS.choices` leaves room for. A
 * failed or unreadable reply leaves just the given choices, unplanned.
 */
export async function planNext(
  settings: Settings,
  p: {
    ctx: StoryContext;
    chapter: { title: string; body: string };
    given: string[];
    suggest: number;
    options: RunOptions;
    signal?: AbortSignal;
    stream?: Stream;
    source?: AiSourceIds;
    /** A plan task of its own: a failed or unreadable reply is an error, not "no plan". */
    strict?: boolean;
  },
): Promise<PlannedChoice[]> {
  const unplanned = p.given.map((label) => ({ label, direction: "", isNew: false }));
  const room = Math.max(0, LIMITS.choices - p.given.length);
  const add = Math.min(p.suggest, room);
  if (p.given.length === 0 && add === 0) return [];
  try {
    const prompt = planStepsPrompt(p.ctx, p.chapter, p.given, add, settings.contextTokens);
    const reply = await complete(p.stream ?? defaultStream, settings, {
      system: SYSTEM_PLAN_STEPS,
      messages: [{ role: "user", content: prompt }],
      ...modelRequest(p.options, "cheap"),
      signal: p.signal,
      source: { label: "AI run: plan choices", ...p.source },
    });
    const ideas = parseIdeas(reply, 12);
    if (ideas.length === 0) {
      if (p.strict) throw new Error("The model's plan could not be read.");
      return unplanned;
    }
    const seen = new Set(p.given.map(norm));
    const out: PlannedChoice[] = [];
    let added = 0;
    for (const step of matchSteps(p.given, ideas)) {
      if (!step.isNew) {
        out.push(step);
        continue;
      }
      const label = step.label.trim().slice(0, LIMITS.label);
      if (!label || seen.has(norm(label)) || added >= add) continue;
      seen.add(norm(label));
      added += 1;
      out.push({ label, direction: step.direction, isNew: true });
    }
    return out;
  } catch (e) {
    if ((e instanceof DOMException && e.name === "AbortError") || p.strict) throw e;
    return unplanned;
  }
}

/**
 * Folds the chapter into the story's running summary with the cheap model. Tries twice, then gives up with null
 * (the chapter is kept without summaries; they are made later when needed).
 */
export async function summarize(
  settings: Settings,
  p: { story: { title: string; premise: string }; previous: string | null; chapter: { title: string; body: string }; options: RunOptions; signal?: AbortSignal; stream?: Stream; source?: AiSourceIds },
): Promise<Summaries | null> {
  const request = summaryRequest(settings.contextTokens, p);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await complete(p.stream ?? defaultStream, settings, {
        system: request.system,
        messages: [{ role: "user", content: request.message }],
        ...modelRequest(p.options, "cheap"),
        maxTokens: 1500,
        signal: p.signal,
        source: { label: "Summary", ...p.source },
      });
      return parseSummaryReply(reply);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
    }
  }
  return null;
}

/** Everything for one chapter in one go ("one chapter at a time"): the text, its planned choices and its summaries. */
export async function writeOneChapter(
  settings: Settings,
  p: {
    context: ChapterContext;
    label: string;
    direction: string;
    given: string[];
    suggest: number;
    options: RunOptions;
    signal?: AbortSignal;
    onText?: (text: string) => void;
    onStatus?: (text: string) => void;
    stream?: Stream;
    source?: AiSourceIds;
    /** Saves the older chapters' summaries on the server (the worker's fetch; the page's by default). */
    fetch?: typeof fetch;
  },
): Promise<{ title: string; body: string; choices: PlannedChoice[]; summary?: string; path_summary?: string }> {
  const ctx = await withPathSummaries(settings, storyContextOf(p.context, p.label), p.signal, p.onStatus, p.fetch, p.source);
  const chapter = await writeText(settings, { ctx, label: p.label, direction: p.direction, options: p.options, signal: p.signal, onText: p.onText, stream: p.stream, source: p.source });
  p.onStatus?.("Planning the choices…");
  const choices = await planNext(settings, { ctx: { ...ctx, siblingChoices: undefined }, chapter, given: p.given, suggest: p.suggest, options: p.options, signal: p.signal, stream: p.stream, source: p.source });
  p.onStatus?.("Summarizing…");
  const parent = p.context.path.at(-1);
  const s = await summarize(settings, { story: { title: ctx.storyTitle, premise: ctx.premise }, previous: parent?.path_summary ?? null, chapter, options: p.options, signal: p.signal, stream: p.stream, source: p.source });
  return { ...chapter, choices, ...(s && { summary: s.summary, path_summary: s.path_summary }) };
}
