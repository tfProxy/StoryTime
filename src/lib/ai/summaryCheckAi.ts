// AI helper for the story review: does a chapter's summary match the chapter? Small prompt, one chapter and its summary,
// answered with ok or a one-line problem. Runs in the browser or on the server with the user's own key.
import { completeChat } from "./client";
import { estimateTokens, type PromptParts } from "./prompts";
import { extractJson } from "./codexAi";
import type { Settings } from "../settings";

export type SummaryCheckResult = { ok: true } | { ok: false; problem: string };

const PROBLEM_MAX = 200;

const SYSTEM_SUMMARY = `You check that the summary of a story chapter matches the chapter.
The summary is wrong if:
- it leaves out a key event of the chapter (something that changes the story, not a small detail), or
- it states something the chapter does not say.
Minor wording or brevity is fine. A summary does not have to mention everything.
Reply with JSON only. If the summary is fine: {"ok":true}
If not, say what is wrong in one short line: {"ok":false,"problem":"one short line"}`;

export type SummaryCheckRequestOptions = {
  chapter: { title: string; body: string };
  summary: string;
};

/** The request for one chapter and its summary. A chapter too long for the context is cut to fit. */
export function summaryCheckRequest(contextTokens: number, opts: SummaryCheckRequestOptions): PromptParts {
  const summary = opts.summary.trim();
  const budget = Math.max(1000, contextTokens - 1500);
  // The summary is kept whole; the chapter gets what is left (about 2 characters a token).
  const room = Math.max(1000, budget - estimateTokens(summary));
  const maxChars = room * 2;
  const body = opts.chapter.body.length > maxChars ? `${opts.chapter.body.slice(0, maxChars)}…` : opts.chapter.body;
  const message = [`Chapter: "${opts.chapter.title}"\n${body}`, `Summary to check:\n${summary}`, "Does the summary match the chapter? Reply as JSON."].join("\n\n");
  return { system: SYSTEM_SUMMARY, message };
}

/** Reads the answer from a model reply (already parsed from JSON), or null when it can't be read. Tolerates a bare "ok". */
export function parseSummaryCheck(raw: unknown): SummaryCheckResult | null {
  if (typeof raw === "string") return raw.trim().toLowerCase().replace(/[^a-z]/g, "") === "ok" ? { ok: true } : null;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { ok?: unknown; problem?: unknown };
  const ok = o.ok === true || (typeof o.ok === "string" && o.ok.trim().toLowerCase() === "true");
  const notOk = o.ok === false || (typeof o.ok === "string" && o.ok.trim().toLowerCase() === "false");
  if (ok) return { ok: true };
  if (!notOk) return null;
  const problem = typeof o.problem === "string" ? o.problem.replace(/\s+/g, " ").trim().slice(0, PROBLEM_MAX) : "";
  return { ok: false, problem: problem || "The summary does not match the chapter." };
}

export type SummaryCheckOptions = SummaryCheckRequestOptions & { signal?: AbortSignal; role?: "main" | "cheap" };

/** Asks whether a chapter's summary matches it. Throws when the reply can't be read. */
export async function summaryCheck(settings: Settings, opts: SummaryCheckOptions): Promise<SummaryCheckResult> {
  const request = summaryCheckRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: opts.role ?? "cheap",
    signal: opts.signal,
  });
  const result = parseSummaryCheck(extractJson(reply));
  if (!result) throw new Error("The AI's reply about the summary couldn't be read.");
  return result;
}
