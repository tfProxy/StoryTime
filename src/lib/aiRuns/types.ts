// Shared types for AI runs (write ahead, grow the tree, reach a goal, fill missing pictures).
// The server validates the same shapes with zod (src/lib/aiRuns.ts).

import type { ModelRef } from "../settingsSchema";

export type RunMode = "fill" | "tree" | "arc" | "pictures" | "review";

/** Where a write task's chapter goes. */
export type Slot =
  | { kind: "choice"; choiceId: string } // an existing unwritten choice
  | { kind: "new"; parentChapterId: string; label: string } // a new choice on an existing chapter (arc)
  | { kind: "fromTask"; taskId: string; choiceIndex: number }; // the n-th choice an earlier task's chapter was posted with (arc)

/** `written`: posted, its summaries and planned choices still to come (D20 "Group by model"). */
export type TaskStatus = "todo" | "written" | "done" | "failed" | "skipped";

export type WriteTask = {
  kind: "write";
  id: string; // "t1", "t2", … unique in the run
  slot: Slot;
  label: string; // the choice text (shown, and sent as "The reader chose")
  direction: string; // what happens in this chapter; "" leaves it to the AI
  depth: number; // 1 = a child of the start chapter
  /** The new chapter's choices: `given` first (in order), then `suggest` more from the AI, each planned by a plan step (D22). */
  choices: { given: string[]; suggest: number };
  /** The plan task that writes this task's `direction`; the task waits for it (Fill). */
  plannedBy?: string;
  /** The chapter this one continues from, when it exists already (Fill, Grow the tree); a `fromTask` slot reads it from that task. */
  parentChapterId?: string;
  /** What the plan said happens after each of this chapter's choices (D22), kept so later chapters start from it. */
  planned?: { label: string; direction: string }[];
  /** Grow the tree: queue a task for each of the new chapter's choices (milestone 2). */
  expand: boolean;
  status: TaskStatus;
  chapterId?: string; // set when done
  choiceIds?: string[]; // from POST /api/chapters, same order as the choices sent
  error?: string;
};

/**
 * A plan step (D22) on a chapter that exists: what happens after each of `labels` (its unwritten choices to be
 * written), plus `add` new choices with their plans (Grow the tree tops a chapter up to its width). The result is
 * kept in `steps` and copied into the waiting write tasks' `direction`; new choices are added to the chapter.
 * `depth` is the depth (1 = a child of the start chapter) of the chapters it plans.
 */
export type PlanTask = {
  kind: "plan";
  id: string;
  chapterId: string;
  depth: number;
  labels: string[];
  add: number;
  status: TaskStatus;
  steps?: { label: string; direction: string; choiceId?: string }[];
  error?: string;
};

/** Fill missing pictures (milestone 4): one picture for one slot of one chapter. */
export type PictureTask = {
  kind: "picture";
  id: string;
  chapterId: string;
  slot: "header" | "footer";
  /** The chapter's title, for the task list. */
  label?: string;
  /** `todo`: no prompt yet; `written`: its prompt is written and the picture is being made; `done`: saved as the slot. */
  status: TaskStatus;
  prompt?: string;
  negative?: string;
  jobId?: string;
  error?: string;
};

/** Find tags: the AI reads one chapter (at `revision`) and saves its tag suggestions. Made by the server when the run is created. */
export type TagsTask = {
  kind: "tags";
  id: string;
  chapterId: string;
  /** The chapter's revision when the run was made; a chapter edited since is skipped. */
  revision: number;
  /** The chapter's title, for the task list. */
  label?: string;
  status: TaskStatus;
  /** How many new suggestions the AI's reading of the chapter added (set when it was read). */
  found?: number;
  error?: string;
};

/** Facts: the AI reads one chapter (at `revision`) and its facts are saved. Made by the server when a review run asks for facts. */
export type FactsTask = {
  kind: "facts";
  id: string;
  chapterId: string;
  /** The chapter's revision when the run was made; a chapter edited since is skipped. */
  revision: number;
  /** The chapter's title, for the task list. */
  label?: string;
  status: TaskStatus;
  /** How many facts were saved (set when the chapter was read). */
  found?: number;
  error?: string;
};

/** Continuity: the AI judges each clash between chapters found in the facts along the way to `chapterIds`. Made by the server when a review run asks for it. */
export type ContinuityTask = {
  kind: "continuity";
  id: string;
  /** The chapters in the run's scope with no child in it; each one's way from the start is checked. */
  chapterIds: string[];
  status: TaskStatus;
  /** How many clashes were judged a contradiction (set when done). */
  found?: number;
  error?: string;
};

/** Summary: the AI checks one chapter's summary against the chapter (at `revision`). Made by the server when a review run asks for it. */
export type SummaryTask = {
  kind: "summary";
  id: string;
  chapterId: string;
  /** The chapter's revision when the run was made; a chapter edited since is skipped. */
  revision: number;
  /** The chapter's title, for the task list. */
  label?: string;
  status: TaskStatus;
  /** 1 when the summary does not match the chapter (set when checked). */
  found?: number;
  error?: string;
};

export type RunTask = WriteTask | PlanTask | PictureTask | TagsTask | FactsTask | ContinuityTask | SummaryTask;

export type RunOptions = {
  // writing modes
  length?: "short" | "medium" | "long";
  model?: ModelRef | null; // writing model; null = the default main model
  suggestModel?: ModelRef | null; // choices, summaries and picture prompts; null = the default cheap model
  guidance?: string; // added to every chapter's direction ([bracket notes] allowed)
  endChoices?: number; // D5
  reviewPlan?: boolean; // D23, default false
  /**
   * Depths whose plans the owner has already checked (D23). Chosen over a flag per task because
   * the review is of a whole level at once; `needsReview` is false for a depth in this list.
   */
  reviewedDepths?: number[];
  models?: "group" | "writing" | "each"; // D20, default "group"
  scope?: "children" | "below"; // fill, and pictures ("below" = this chapter and everything under it)
  maxDepth?: number;
  breadth?: number; // tree
  objective?: string;
  chapters?: number;
  alternatives?: number; // arc
  // pictures
  slots?: "header" | "footer" | "both";
  useRefs?: boolean; // D12, default false
  // tags: which chapters (the server makes the tasks): the start chapter, the way to it, it and everything below it, or the whole story
  tagScope?: "chapter" | "path" | "subtree" | "story" | "chapters";
  /** With tagScope "chapters": exactly these chapters (the automatic review after an AI run). */
  chapterIds?: string[];
  /** A review run the server started by itself after a save or an AI run. */
  automatic?: boolean;
  // review: what to read each chapter for (tags unless said otherwise)
  checks?: ("tags" | "facts" | "continuity" | "summaries")[];
};

/** `queued`: waiting its turn in a tab's work queue. `running` with a lapsed lease means the tab that ran it is gone. */
/** `review`: waiting for the owner to check a level's plans (D23); `AiRun.review_depth` says which. */
export type RunStatus = "ready" | "queued" | "running" | "review" | "paused" | "done" | "stopped";

export type AiRun = {
  id: string;
  story_id: string;
  start_chapter_id: string | null; // null = the whole story (pictures, tags)
  mode: RunMode;
  options: RunOptions;
  tasks: RunTask[];
  status: RunStatus;
  review_depth: number | null;
  error: string | null;
  version: number;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
  /** As the server answers: another tab holds the run now. */
  leased?: boolean;
};
