// AI helper for "Flesh out": the AI reads one codex entry (its facts so far) and the story around it and proposes new
// facts to make the entry fuller. Two modes: "invent" (the default) adds new details that fit the story; "close" only
// elaborates on what the chapters already show, and every fact must carry a quote from them. The facts go to the codex
// inbox with source "expand" for the owner to accept, edit or dismiss. Pure apart from `completeChat`; runs on the server.
import { completeChat, type AiSourceIds } from "./client";
import { estimateTokens, type PromptParts } from "./prompts";
import { extractJson } from "./codexAi";
import { quoteInText } from "./tagAi";
import { FACT_LIMITS, STARTER_ASPECTS, isFormAspect, sameAspect, type CodexEntry } from "../codex";
import type { SuggestionInput } from "./codexCheckAi";
import type { Settings } from "../settings";

export const MAX_EXPAND_FACTS = 10;

export type FleshOutMode = "invent" | "close";

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lc = (s: string) => s.trim().toLowerCase();

const SYSTEM_BASE = `You keep the codex of a story. The codex records the lasting state of the story's characters, places and things as small facts, one per aspect, for example "Ears: tall russet fox ears". The author wants one entry to be fuller and more detailed. Propose new facts for it.

How to write a fact:
- One fact per aspect, in the present tense, short (under about 30 words) and standalone: use names, not pronouns.
- Only what stays true. No plot events, plans or feelings in the moment.
- Give "aspect" (a short title-case name; prefer ones from the usual list for the entry's type, and aspects the entry doesn't have yet) and "text". Give "form" only when the fact belongs to one form of a character that has several (otherwise leave it empty).
- Never repeat or contradict a fact the entry already has, or anything the story says. Do not propose an aspect the entry already has.
- Match the story's tone and style notes. Characters, places and things from well-known works are ones you already know: draw on what you know of them.
- At most ${MAX_EXPAND_FACTS} facts. Pick the details that make the entry feel most real and useful for writing scenes.`;

const INVENT_RULES = `
Invent: the story has not said everything, so add new details of your own that fit it and what is already known, such as appearance, manner, voice, history, habits, relationships and quirks. Keep them consistent and specific rather than generic. Leave "quote" empty.`;

const CLOSE_RULES = `
Stay close to the story: only add facts the chapters show or clearly imply, filling in what is there but not yet in the entry. Every fact needs "quote": the exact words copied from the chapters that show it (under 200 characters). Do not invent anything.`;

const SHAPE = `
Reply with JSON only, in this shape ({"facts":[]} if there is nothing to add):
{"facts":[{"aspect":"","form":"","text":"","quote":""}]}`;

const systemFor = (mode: FleshOutMode) => SYSTEM_BASE + (mode === "close" ? CLOSE_RULES : INVENT_RULES) + SHAPE;

export type FleshOutOptions = {
  entry: CodexEntry;
  story: { title: string; premise: string; style?: string };
  /** The names of the codex's other entries, so the new facts don't clash with them. */
  others: string[];
  /** The chapters from the story's start down to the one the entry is read at. */
  chapters: { title: string; body: string; summary?: string | null }[];
  mode?: FleshOutMode;
  /** What the author wants more of ("her family, how she talks"). */
  hint?: string;
};

/** The entry as the AI sees it: its form and facts so far. */
function describe(e: CodexEntry): string {
  const lines: string[] = [];
  if (e.form) {
    const label = [e.form.name, e.form.note].map((s) => s.trim()).filter(Boolean).join(", ");
    if (label) lines.push(`Current form: ${label}`);
  }
  for (const f of e.facts) {
    if (isFormAspect(f.aspect) || !f.text.trim()) continue;
    lines.push(`- ${f.aspect.trim() || "(note)"} [${f.form.trim() ? `${f.form.trim()} form` : "every form"}]: ${f.text.trim()}`);
  }
  return lines.join("\n") || "(none yet)";
}

/** Short pieces of the chapters around where the entry is named, newest chapters first, up to `maxChars` in all. */
export function excerptsFor(entry: CodexEntry, chapters: FleshOutOptions["chapters"], maxChars: number): string[] {
  const names = [entry.name, ...entry.aliases].map(lc).filter(Boolean);
  const out: string[] = [];
  let used = 0;
  for (const c of [...chapters].reverse()) {
    const body = c.body;
    const low = body.toLowerCase();
    const at = names.map((n) => low.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (at === undefined) continue;
    const piece = `“${c.title}”: …${body.slice(Math.max(0, at - 250), at + 450).replace(/\s+/g, " ").trim()}…`;
    if (used + piece.length > maxChars) break;
    out.push(piece);
    used += piece.length;
  }
  return out.reverse();
}

/** The request for one entry. The story's text is cut to fit the context. */
export function fleshOutRequest(contextTokens: number, opts: FleshOutOptions): PromptParts {
  const mode = opts.mode ?? "invent";
  const system = systemFor(mode);
  const { entry, story } = opts;
  const types = STARTER_ASPECTS[entry.type].length ? `Usual aspects for a ${entry.type}: ${STARTER_ASPECTS[entry.type].join(", ")}.` : "";
  const fixed = [
    `Story: ${story.title}`,
    story.premise.trim() && `Premise: ${story.premise.trim()}`,
    story.style?.trim() && `Style notes: ${story.style.trim()}`,
    `The entry: ${entry.name} [${entry.type}]${entry.aliases.length ? ` (also: ${entry.aliases.join(", ")})` : ""}`,
    types,
    `Its facts now:\n${describe(entry)}`,
    opts.others.length ? `Other entries (do not clash with them): ${opts.others.join(", ")}` : "",
    opts.hint?.trim() && `The author wants more of: ${opts.hint.trim()}`,
  ].filter(Boolean) as string[];
  const budget = Math.max(1000, contextTokens - 2500 - estimateTokens(system) - estimateTokens(fixed.join("\n\n")));
  const summaries = opts.chapters.filter((c) => c.summary?.trim()).map((c) => `- ${c.title}: ${c.summary!.trim()}`).join("\n");
  const excerpts = excerptsFor(entry, opts.chapters, Math.floor(budget * 1.5)).join("\n\n");
  const message = [
    ...fixed,
    summaries && `The story so far (summaries):\n${summaries}`,
    excerpts && `Where the entry appears:\n${excerpts}`,
    mode === "close" ? "Propose facts the chapters support, as JSON." : "Propose new facts, as JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, message };
}

/** Turns a model reply into suggestions for the entry, dropping what can't be trusted (an aspect it already has, a quote not in the chapters). */
export function parseFleshOut(reply: string, opts: FleshOutOptions): SuggestionInput[] {
  const raw = extractJson(reply);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { facts?: unknown }).facts : null;
  if (!Array.isArray(list)) return [];
  const mode = opts.mode ?? "invent";
  const { entry } = opts;
  const haystack = opts.chapters.map((c) => `${c.title}\n${c.body}\n${c.summary ?? ""}`).join("\n");
  const out: SuggestionInput[] = [];
  for (const item of list) {
    if (out.length >= MAX_EXPAND_FACTS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const aspect = asString(o.aspect, FACT_LIMITS.aspect);
    const form = asString(o.form, FACT_LIMITS.form);
    const text = asString(o.text, FACT_LIMITS.text);
    if (!aspect || !text || isFormAspect(aspect)) continue;
    // New details only: an aspect the entry already has (in that form) is its owner's to change.
    if (entry.facts.some((f) => sameAspect(f.aspect, aspect) && sameAspect(f.form, form))) continue;
    if (out.some((x) => sameAspect(x.aspect, aspect) && sameAspect(x.form, form))) continue;
    let quote = "";
    if (mode === "close") {
      quote = asString(o.quote, FACT_LIMITS.quote);
      if (!quote || !quoteInText(quote, haystack)) continue;
    }
    out.push({ kind: "set", entry_id: entry.entry_id, aspect, form, after: text, quote });
  }
  return out;
}

export type RunFleshOutOptions = FleshOutOptions & { signal?: AbortSignal; role?: "main" | "cheap"; source?: AiSourceIds };

/** Asks the AI for new facts for one entry. Throws when the reply can't be read. */
export async function runFleshOut(settings: Settings, opts: RunFleshOutOptions): Promise<SuggestionInput[]> {
  const request = fleshOutRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: opts.role ?? "cheap",
    signal: opts.signal,
    source: { label: "Flesh out", ...opts.source },
  });
  return parseFleshOut(reply, opts);
}
