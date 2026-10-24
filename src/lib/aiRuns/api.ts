// Fetch helpers for the AI run routes and the chapter routes a run uses. Every helper takes the `fetch` to use, so
// the runner can be tested against a fake server.
import type { ContextChapter, ContextCodexEntry } from "../ai/prompts";
import type { AiRun, RunStatus, RunTask } from "./types";

export type Fetch = typeof fetch;

/** A refused request; `status` is the HTTP status (409 means another tab has the run, or it changed meanwhile). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** What `GET /api/chapters/<id>/context` answers. */
export type ChapterContext = {
  story: { id: string; title: string; premise: string; style: string };
  /** From the story's start down to the chapter, which is last. */
  path: (Required<Pick<ContextChapter, "id" | "revision">> & ContextChapter & { depth: number })[];
  codex: ContextCodexEntry[];
  choices: { id: string; label: string; child_chapter_id: string | null }[];
};

async function call<T>(f: Fetch, method: string, url: string, body?: unknown): Promise<T> {
  const res = await f(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `The request failed (${res.status})`, res.status);
  return data as T;
}

export const getContext = (f: Fetch, chapterId: string) => call<ChapterContext>(f, "GET", `/api/chapters/${chapterId}/context`);

export const getRun = (f: Fetch, runId: string) => call<AiRun & { leased: boolean }>(f, "GET", `/api/ai-runs/${runId}`);

/** Takes (or renews) the run's lease for this tab; 409 when another tab has it. */
export const claimRunLease = (f: Fetch, runId: string, token: string) => call<{ version: number }>(f, "POST", `/api/ai-runs/${runId}/claim`, { token });

/** Saves the run (what changed only); returns it as saved, with its new version. */
export const patchRun = (
  f: Fetch,
  runId: string,
  body: { token: string; version: number; tasks?: RunTask[]; status?: RunStatus; review_depth?: number | null; error?: string | null },
) => call<AiRun & { leased: boolean }>(f, "PATCH", `/api/ai-runs/${runId}`, body);

export type NewChapter = {
  title: string;
  body: string;
  summary?: string;
  path_summary?: string;
  choices: string[];
  ai_run_id: string;
} & ({ choice_id: string } | { parent_chapter_id: string; new_choice_label: string });

export const postChapter = (f: Fetch, chapter: NewChapter) =>
  call<{ story_id: string; chapter_id: string; choice_ids: string[] }>(f, "POST", "/api/chapters", { ...chapter, codex_changes: [] });

/** Adds an unwritten choice to a chapter. */
export const addChoice = (f: Fetch, chapterId: string, label: string) => call<{ ok: true }>(f, "POST", `/api/chapters/${chapterId}/choices`, { label });

/** Fills in the summaries of a chapter (replacing any there, as the bulk summaries page does). */
export const putSummary = (f: Fetch, chapterId: string, revision: number, summary: string, path_summary: string) =>
  call<unknown>(f, "PUT", `/api/chapters/${chapterId}/summary`, { revision, summary, path_summary });
