// Rolling story summaries. Each chapter stores a short `summary` of itself and a
// `path_summary` of the whole story up to and including it, so later prompts can condense old
// chapters without sending them. They are generated in the browser with the user's own
// (cheaper) model and saved to the server for everyone to reuse.
import { completeChat } from "./client";
import { extractJson } from "./codexAi";
import { summaryCoverageIndex, type ContextChapter } from "./prompts";
import { LIMITS } from "../limits";
import type { Settings } from "../settings";

export type Summaries = { summary: string; path_summary: string };

const SYSTEM_SUMMARY = `You maintain a running summary of a branching story so that later writers can keep it consistent without re-reading everything.
Reply in exactly this format, with no other text:
SUMMARY:
A short paragraph covering only the chapter you are given: what happens, who is involved, what changes, and any thread left open. Use the length you are asked for. Write it from the chapter itself.
STORY SO FAR:
The updated running summary of the whole story up to and including this chapter. Start from the previous summary (if there is one) and fold this chapter in. Keep it under about 300 words. Keep names, relationships, key events, unresolved threads and the current situation; compress older details first. Plain prose, past tense, no commentary.`;

const clip = (s: string) => s.trim().slice(0, LIMITS.summary);

/** About an eighth of the chapter, so each summary keeps the detail later chapters may need. */
export function summaryWords(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(150, Math.max(40, Math.round(words / 8 / 10) * 10));
}

/** One step: fold a chapter into the running summary. `previous` is null for a story's first chapter. */
export async function summarizeChapter(
  settings: Settings,
  opts: {
    story: { title: string; premise: string };
    previous: string | null;
    chapter: { title: string; body: string };
    /** The author's own summary of the chapter; used as-is instead of a generated one. */
    summary?: string;
    signal?: AbortSignal;
    /** Called as the reply streams in, with whatever of the two summaries has been written so far. */
    onText?: (partial: Summaries) => void;
  },
): Promise<Summaries> {
  const own = opts.summary?.trim() ? clip(opts.summary) : null;
  const budget = Math.max(1000, settings.contextTokens - 1500);
  // A chapter can be longer than the model's window; keep the start and the end.
  const maxChars = budget * 3;
  const body =
    opts.chapter.body.length > maxChars
      ? `${opts.chapter.body.slice(0, maxChars / 2)}\n[…]\n${opts.chapter.body.slice(-maxChars / 2)}`
      : opts.chapter.body;
  const prompt = [
    `Story: ${opts.story.title}${opts.story.premise.trim() ? `\nPremise: ${opts.story.premise.trim()}` : ""}`,
    opts.previous
      ? `Summary of the story before this chapter:\n${opts.previous}`
      : "This is the first chapter, so there is no earlier summary.",
    `Chapter: "${opts.chapter.title}"\n${body}`,
    own
      ? `The author has already summarized this chapter. Use it unchanged as the SUMMARY:\n${own}`
      : `Make the SUMMARY about ${summaryWords(opts.chapter.body)} words.`,
  ].join("\n\n");

  // Small or "thinking" models sometimes ramble or break the format, so give it one more go.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await completeChat(
      settings,
      {
        system: SYSTEM_SUMMARY,
        messages: [{ role: "user", content: prompt }],
        useSummaryModel: true,
        maxTokens: 1500,
        signal: opts.signal,
      },
      opts.onText && ((soFar) => opts.onText!(parsePartialSummaryReply(soFar, own))),
    );
    try {
      const parsed = parseSummaryReply(reply);
      return own ? { ...parsed, summary: own } : parsed;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Reads the labelled format asked for above; also accepts JSON, which earlier versions used. */
export function parseSummaryReply(reply: string): Summaries {
  const labelled = /SUMMARY:\s*([\s\S]*?)\s*STORY SO FAR:\s*([\s\S]*)$/i.exec(reply.replace(/\*\*/g, ""));
  let summary = labelled ? clip(labelled[1]) : "";
  let path_summary = labelled ? clip(labelled[2]) : "";
  if (!summary || !path_summary) {
    if (!reply.includes("{")) throw new Error("The AI didn't return anything I could read. Try again.");
    const json = extractJson(reply) as Record<string, unknown>;
    summary = typeof json.summary === "string" ? clip(json.summary) : "";
    path_summary = typeof json.story_so_far === "string" ? clip(json.story_so_far) : "";
  }
  if (!summary || !path_summary) throw new Error("The AI's summary was incomplete. Try again.");
  return { summary, path_summary };
}

/** Reads a reply that is still arriving: whatever of each labelled part has been written so far. */
export function parsePartialSummaryReply(reply: string, own?: string | null): Summaries {
  const text = reply.replace(/\*\*/g, "");
  const start = /SUMMARY:\s*/i.exec(text);
  if (!start) return { summary: own ?? "", path_summary: "" };
  const rest = text.slice(start.index + start[0].length);
  const split = /STORY SO FAR:\s*/i.exec(rest);
  const summary = (split ? rest.slice(0, split.index) : rest).trim();
  return { summary: own ?? summary, path_summary: split ? rest.slice(split.index + split[0].length) : "" };
}

/** Stores a generated summary for a chapter (only fills it if it is still empty). */
export async function saveSummaries(chapterId: string, revision: number, s: Summaries): Promise<void> {
  const res = await fetch(`/api/chapters/${chapterId}/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision, summary: s.summary, path_summary: s.path_summary }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Couldn't save the summary (${res.status})`);
  }
}

export type SummaryOptions = {
  story: { title: string; premise: string };
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Streamed text for the chapter at `index` in the path, as in summarizeChapter. */
  onText?: (partial: Summaries, index: number) => void;
};

/**
 * Makes sure `path[upTo]` has a rolling summary, generating (and saving) any that are missing
 * between it and the nearest earlier chapter that has one. Returns the summaries it made,
 * keyed by chapter id, so the caller can use them straight away.
 */
export async function ensurePathSummaries(
  settings: Settings,
  path: ContextChapter[],
  upTo: number,
  opts: SummaryOptions,
): Promise<Record<string, Summaries>> {
  const made: Record<string, Summaries> = {};
  if (upTo < 0 || upTo >= path.length || path[upTo].path_summary) return made;

  let start = upTo;
  while (start > 0 && !path[start - 1].path_summary) start--;
  let previous = start > 0 ? path[start - 1].path_summary : null;
  const total = upTo - start + 1;

  for (let i = start; i <= upTo; i++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    opts.onProgress?.(i - start, total);
    const c = path[i];
    const s = await summarizeChapter(settings, {
      story: opts.story,
      previous,
      chapter: c,
      signal: opts.signal,
      onText: opts.onText && ((p) => opts.onText!(p, i)),
    });
    // Saving is best-effort: the summary is still useful for this prompt if the server refuses.
    if (c.id && c.revision) await saveSummaries(c.id, c.revision, s).catch(() => {});
    if (c.id) made[c.id] = s;
    previous = s.path_summary;
  }
  opts.onProgress?.(total, total);
  return made;
}

/** The index to summarize up to so a prompt for this path can condense its older chapters. */
export function neededSummaryIndex(path: ContextChapter[], contextTokens: number): number {
  const i = summaryCoverageIndex(path, contextTokens);
  return i >= 0 && !path[i].path_summary ? i : -1;
}
