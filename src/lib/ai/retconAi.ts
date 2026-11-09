// AI helper for a retcon: the AI reads one chapter and the change the author made to the story (a detail that is now
// as if it had always been so) and proposes small replacements for the passages that no longer fit. Pure apart from
// `completeChat`; runs on the server (the work queue's review runs).
import { completeChat, type AiSourceIds } from "./client";
import { extractJson } from "./codexAi";
import { estimateTokens, type PromptParts } from "./prompts";
import { findPassage, type RetconEdit } from "../retconText";
import type { Settings } from "../settings";

export const MAX_RETCON_EDITS = 30;
const PASSAGE_MAX = 2000;
const NOTE_MAX = 1000;

const SYSTEM_RETCON = `You keep a story consistent after its author changed a detail (a retcon). The change is now true as if it had always been so, from the start of this part of the story. You are shown the change and one chapter. Find every passage in the chapter that no longer fits the change, directly or by implication (descriptions, comparisons and imagery, what other characters say or notice), and rewrite just those passages so they fit.

Rules:
- Change as few words as you can. Keep the author's voice, style, tense and the rest of each sentence.
- "old" is copied exactly, character for character, from the chapter or its summary: a whole sentence or clause, long enough that it appears only once. "new" is its replacement.
- Leave alone passages that already fit, and passages that show the detail changing within the story (a transformation, a disguise, a spell). Mention those in "note".
- If fitting the change would need more than rewording (the plot depends on the old detail), do not rewrite it; explain in "note" what the author should look at.
- Nothing to change: {"edits":[],"note":""}.
Reply with JSON only, in this shape:
{"edits":[{"old":"","new":""}],"note":""}`;

export type RetconRequestOptions = {
  /** What changed, in words ("Mira's eyes are blue (they were gray). Treat it as always having been so."). */
  instruction: string;
  chapter: { title: string; body: string; summary: string | null };
};

/** The request for one chapter. A chapter too long for the context is cut to fit. */
export function retconRequest(contextTokens: number, opts: RetconRequestOptions): PromptParts {
  const summary = opts.chapter.summary?.trim() ?? "";
  const budget = Math.max(1000, contextTokens - 2000 - estimateTokens(SYSTEM_RETCON) - estimateTokens(opts.instruction) - estimateTokens(summary));
  // The reply repeats the passages it changes, so the chapter gets a bit over half of what is left (about 2 characters a token).
  const maxChars = Math.floor(budget * 1.2);
  const body = opts.chapter.body.length > maxChars ? `${opts.chapter.body.slice(0, maxChars)}…` : opts.chapter.body;
  const message = [
    `The change:\n${opts.instruction}`,
    `Chapter: "${opts.chapter.title}"\n${body}`,
    summary ? `The chapter's summary (fix it too if it no longer fits):\n${summary}` : "",
    "Propose the replacements this chapter needs for the change, as JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: SYSTEM_RETCON, message };
}

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Turns a model reply into edits, keeping only those whose passage is in the chapter (or its summary) and that change it. */
export function parseRetcon(reply: string, texts: string[]): { edits: RetconEdit[]; note: string } {
  const raw = extractJson(reply);
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(raw) ? raw : Array.isArray(obj.edits) ? obj.edits : [];
  const edits: RetconEdit[] = [];
  for (const item of list) {
    if (edits.length >= MAX_RETCON_EDITS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const old = asString(o.old, PASSAGE_MAX);
    const next = typeof o.new === "string" ? o.new.trim().slice(0, PASSAGE_MAX) : "";
    if (!old || old === next) continue;
    // The chapter's own spelling of the passage, so applying it later is exact.
    const found = texts.map((t) => findPassage(old, t)).find((p): p is string => p !== null);
    if (!found || found === next || edits.some((e) => e.old === found)) continue;
    edits.push({ old: found, new: next });
  }
  return { edits, note: asString(obj.note, NOTE_MAX) };
}

export type RunRetconOptions = RetconRequestOptions & { signal?: AbortSignal; role?: "main" | "cheap"; source?: AiSourceIds };

/** Asks the AI what the chapter needs changed for the retcon. Throws when the call fails. */
export async function runRetcon(settings: Settings, opts: RunRetconOptions): Promise<{ edits: RetconEdit[]; note: string }> {
  if (!opts.chapter.body.trim()) return { edits: [], note: "" };
  const request = retconRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: opts.role ?? "main",
    signal: opts.signal,
    source: { label: "Retcon", ...opts.source },
  });
  return parseRetcon(reply, [opts.chapter.body, opts.chapter.summary ?? ""]);
}
