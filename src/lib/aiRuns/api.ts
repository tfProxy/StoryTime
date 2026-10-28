// Fetch helpers for the AI run routes and the chapter routes a run uses. Every helper takes the `fetch` to use, so
// the runner can be tested against a fake server.
import type { ContextChapter, ContextCodexEntry } from "../ai/prompts";
import type { Fact } from "../ai/factAi";
import type { SuggestionInput } from "../ai/codexCheckAi";
import type { CodexEntry } from "../codex";
import type { TagRule, TagSuggestion } from "../ai/tagAi";
import type { PathFacts } from "../continuity";
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

/** The tags on for a story, with their rules: `GET /api/stories/<id>/tags` lists every tag and the ids switched on. */
export const getStoryTags = (f: Fetch, storyId: string) => call<{ tags: (TagRule & { kind: string })[]; enabled: string[] }>(f, "GET", `/api/stories/${storyId}/tags`);

/** One chapter's tags and, for every chapter, the tag ids it was checked for at its current revision. */
export const getChapterTags = (f: Fetch, storyId: string, chapterId: string) =>
  call<{ chapter_tags: { tag_id: string; status: string; revision: number }[]; checked: Record<string, string[]> }>(
    f,
    "GET",
    `/api/stories/${storyId}/chapter-tags?chapter=${encodeURIComponent(chapterId)}`,
  );

/** Saves the AI's tag suggestions for a chapter revision; 409 when the chapter was edited meanwhile. */
export const postTagSuggestions = (f: Fetch, chapterId: string, revision: number, checkedTagIds: string[], suggestions: TagSuggestion[]) =>
  call<{ added: number; kept: number }>(f, "POST", `/api/chapters/${chapterId}/tags/suggest`, { revision, checked_tag_ids: checkedTagIds, suggestions });

/** Saves the facts the AI read from a chapter revision (replacing the chapter's facts); 409 when the chapter was edited meanwhile. */
export const postFacts = (f: Fetch, chapterId: string, revision: number, facts: Fact[]) =>
  call<{ saved: number }>(f, "POST", `/api/chapters/${chapterId}/facts`, { revision, facts });

/** The codex as it stands at a chapter: the live entries with their facts. */
export const getChapterCodex = (f: Fetch, chapterId: string) => call<{ entries: CodexEntry[] }>(f, "GET", `/api/chapters/${chapterId}/codex`);

/** Saves what the AI read from a chapter revision into the codex inbox (replacing the chapter's open suggestions); 409 when the chapter was edited meanwhile. */
export const postCodexSuggestions = (f: Fetch, chapterId: string, revision: number, suggestions: SuggestionInput[]) =>
  call<{ saved: number }>(f, "POST", `/api/chapters/${chapterId}/codex-suggestions`, { revision, suggestions });

/** The same for facts the AI read from one entry's notes: replaces only that entry's open "notes" suggestions at the chapter. */
export const postNotesSuggestions = (f: Fetch, chapterId: string, revision: number, entryId: string, suggestions: SuggestionInput[]) =>
  call<{ saved: number }>(f, "POST", `/api/chapters/${chapterId}/codex-suggestions`, { revision, suggestions, source: "notes", entry_id: entryId });

/** Saves the AI's check of a chapter's summary; 409 when the chapter or its summary was edited meanwhile. */
export const postSummaryCheck = (f: Fetch, chapterId: string, body: { revision: number; summary: string; verdict: "ok" | "wrong"; problem?: string }) =>
  call<{ ok: true }>(f, "POST", `/api/chapters/${chapterId}/summary-check`, body);

/** The facts of each chapter from the story's root down to this one, root first. */
export const getPathFacts = (f: Fetch, chapterId: string) => call<{ path: PathFacts[] }>(f, "GET", `/api/chapters/${chapterId}/facts`);

/** Every chapter tag of a story (the approved ones are what counts for a change event). */
export const getAllChapterTags = (f: Fetch, storyId: string) =>
  call<{ chapter_tags: { chapter_id: string; tag_name: string; status: string }[] }>(f, "GET", `/api/stories/${storyId}/chapter-tags`);

/** The verdicts already stored on a story's continuity clashes. */
export const getVerdicts = (f: Fetch, storyId: string) => call<{ verdicts: { fingerprint: string; before: { revision: number }; after: { revision: number } }[] }>(f, "GET", `/api/stories/${storyId}/continuity`);

export type VerdictSide = { chapterId: string; revision: number; value: string; quote: string };

/** Saves the AI's verdict on one clash (replacing an earlier one on the same two quotes). */
export const postVerdict = (f: Fetch, storyId: string, body: { verdict: string; entity: string; attribute: string; before: VerdictSide; after: VerdictSide }) =>
  call<{ fingerprint: string }>(f, "POST", `/api/stories/${storyId}/continuity`, body);

/** Adds an unwritten choice to a chapter. */
export const addChoice = (f: Fetch, chapterId: string, label: string) => call<{ ok: true }>(f, "POST", `/api/chapters/${chapterId}/choices`, { label });

/** Fills in the summaries of a chapter (replacing any there, as the bulk summaries page does). */
export const putSummary = (f: Fetch, chapterId: string, revision: number, summary: string, path_summary: string) =>
  call<unknown>(f, "PUT", `/api/chapters/${chapterId}/summary`, { revision, summary, path_summary });
