// AI runs (write ahead, fill missing pictures): a run is a list of tasks kept on the server so it can be resumed
// after a reload or from another browser. The browser does the work (AI calls and ComfyUI calls are made there)
// and saves the list after each task. A run is held by one tab at a time through a lease (`claimRun`), and every
// save carries the `version` it started from, so two tabs can't overwrite each other.
import { z } from "zod";
import { db, newId } from "./db";
import { LIMITS } from "./limits";
import { getChapter, getStory, PostError } from "./stories";
import { decidedTagIdsByChapter, storyTags } from "./tags";
import { getStoryChapters } from "./tree";

const text = (max: number) => z.string().trim().max(max);

export const RUN_MODES = ["fill", "tree", "arc", "pictures", "tags"] as const;
export const TASK_STATUSES = ["todo", "written", "done", "failed", "skipped"] as const;
export const RUN_STATUSES = ["ready", "queued", "running", "review", "paused", "done", "stopped"] as const;

/** How long a tab holds a run without saving it (each save renews it). */
export const LEASE_MS = 2 * 60 * 1000;

const taskStatus = z.enum(TASK_STATUSES);
const modelRef = z.object({ connectionId: z.string().min(1).max(200), model: z.string().trim().min(1).max(300) });

const slotSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), choiceId: z.string().min(1).max(100) }),
  z.object({ kind: z.literal("new"), parentChapterId: z.string().min(1).max(100), label: text(LIMITS.label).min(1) }),
  z.object({ kind: z.literal("fromTask"), taskId: z.string().min(1).max(40), choiceIndex: z.number().int().min(0).max(LIMITS.choices) }),
]);

const taskId = z.string().min(1).max(40);

export const WriteTaskSchema = z.object({
  kind: z.literal("write"),
  id: taskId,
  slot: slotSchema,
  label: text(LIMITS.label),
  direction: text(LIMITS.premise),
  depth: z.number().int().min(1).max(100),
  choices: z.object({ given: z.array(text(LIMITS.label).min(1)).max(LIMITS.choices), suggest: z.number().int().min(0).max(LIMITS.choices) }),
  plannedBy: taskId.optional(),
  parentChapterId: z.string().min(1).max(100).optional(),
  planned: z.array(z.object({ label: text(LIMITS.label), direction: text(LIMITS.premise) })).max(LIMITS.choices).optional(),
  expand: z.boolean(),
  status: taskStatus,
  chapterId: z.string().min(1).max(100).optional(),
  choiceIds: z.array(z.string().min(1).max(100)).max(LIMITS.choices).optional(),
  error: text(LIMITS.summary).optional(),
});

export const PlanTaskSchema = z.object({
  kind: z.literal("plan"),
  id: taskId,
  chapterId: z.string().min(1).max(100),
  depth: z.number().int().min(0).max(100),
  labels: z.array(text(LIMITS.label)).max(LIMITS.choices),
  add: z.number().int().min(0).max(LIMITS.choices),
  status: taskStatus,
  steps: z
    .array(z.object({ label: text(LIMITS.label), direction: text(LIMITS.premise), choiceId: z.string().min(1).max(100).optional() }))
    .max(LIMITS.choices * 2)
    .optional(),
  error: text(LIMITS.summary).optional(),
});

export const PictureTaskSchema = z.object({
  kind: z.literal("picture"),
  id: taskId,
  chapterId: z.string().min(1).max(100),
  slot: z.enum(["header", "footer"]),
  label: text(LIMITS.title).optional(),
  status: taskStatus,
  prompt: text(LIMITS.picturePrompt).optional(),
  negative: text(LIMITS.picturePrompt).optional(),
  jobId: z.string().min(1).max(100).optional(),
  error: text(LIMITS.summary).optional(),
});

export const TagsTaskSchema = z.object({
  kind: z.literal("tags"),
  id: taskId,
  chapterId: z.string().min(1).max(100),
  revision: z.number().int().min(1),
  label: text(LIMITS.title).optional(),
  status: taskStatus,
  found: z.number().int().min(0).optional(),
  error: text(LIMITS.summary).optional(),
});

export const RunTaskSchema = z.discriminatedUnion("kind", [WriteTaskSchema, PlanTaskSchema, PictureTaskSchema, TagsTaskSchema]);
export const RunTasksSchema = z.array(RunTaskSchema).max(LIMITS.runTasks);

export const RunOptionsSchema = z.object({
  length: z.enum(["short", "medium", "long"]).optional(),
  model: modelRef.nullable().optional(),
  suggestModel: modelRef.nullable().optional(),
  guidance: text(LIMITS.premise).optional(),
  endChoices: z.number().int().min(0).max(6).optional(),
  reviewPlan: z.boolean().optional(),
  models: z.enum(["group", "writing", "each"]).optional(),
  scope: z.enum(["children", "below"]).optional(),
  maxDepth: z.number().int().min(1).max(8).optional(),
  breadth: z.number().int().min(1).max(6).optional(),
  objective: text(LIMITS.premise).optional(),
  chapters: z.number().int().min(1).max(20).optional(),
  alternatives: z.number().int().min(0).max(3).optional(),
  slots: z.enum(["header", "footer", "both"]).optional(),
  useRefs: z.boolean().optional(),
  // Find tags: which chapters, from the start chapter (the whole story when there is none).
  tagScope: z.enum(["chapter", "path", "subtree", "story"]).optional(),
  // The depths whose plans the owner has already checked (D23), so a run that goes on doesn't stop there again.
  reviewedDepths: z.array(z.number().int().min(0).max(100)).max(100).optional(),
});

export type RunTask = z.infer<typeof RunTaskSchema>;
export type RunOptions = z.infer<typeof RunOptionsSchema>;
export type RunMode = (typeof RUN_MODES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type TaskCounts = Record<(typeof TASK_STATUSES)[number], number> & { total: number };

export type AiRun = {
  id: string;
  story_id: string;
  start_chapter_id: string | null;
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
  /** Another tab holds the run now (its lease hasn't run out). */
  leased: boolean;
};

/** A run in a list: its task counts instead of the tasks. */
export type AiRunSummary = Omit<AiRun, "tasks"> & {
  counts: TaskCounts;
  /** The chapters the run writes (its write tasks): how many are posted (done, or written and waiting for their summaries), of how many. */
  chapters: { done: number; total: number };
  story_title?: string;
  start_title?: string | null;
};

export const NewRunSchema = z
  .object({
    story_id: z.string().min(1),
    start_chapter_id: z.string().min(1).nullable().default(null),
    mode: z.enum(RUN_MODES),
    options: RunOptionsSchema.default({}),
    // The browser makes the tasks of every mode but "tags", whose tasks the server makes (any sent are ignored).
    tasks: RunTasksSchema.optional(),
  })
  .refine((v) => v.start_chapter_id !== null || v.mode === "pictures" || (v.mode === "tags" && (v.options.tagScope ?? "story") === "story"), {
    message: "start_chapter_id is needed unless the run is for pictures or for the whole story's tags",
    path: ["start_chapter_id"],
  })
  .refine((v) => v.mode === "tags" || v.tasks !== undefined, { message: "tasks are needed", path: ["tasks"] });

export const ClaimSchema = z.object({ token: z.string().min(8).max(100) });

export const UpdateRunSchema = z.object({
  token: z.string().min(8).max(100),
  version: z.number().int().min(1),
  tasks: RunTasksSchema.optional(),
  status: z.enum(RUN_STATUSES).optional(),
  review_depth: z.number().int().min(0).max(100).nullable().optional(),
  error: text(LIMITS.summary).nullable().optional(),
});

/** The owner's edits to a run waiting for them to check a level's plans (D23). */
export const ReviewRunSchema = z.object({
  version: z.number().int().min(1),
  tasks: z
    .array(
      z.object({
        id: taskId,
        label: text(LIMITS.label).min(1).optional(),
        direction: text(LIMITS.premise).optional(),
        /** Remove the chapter from the run (it is marked skipped). */
        remove: z.boolean().optional(),
      }),
    )
    .max(LIMITS.runTasks),
});

type Row = {
  id: string;
  story_id: string;
  start_chapter_id: string | null;
  mode: RunMode;
  options: string;
  tasks: string;
  status: RunStatus;
  review_depth: number | null;
  finished_at: number | null;
  error: string | null;
  version: number;
  lease_token: string | null;
  lease_until: number | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = `id, story_id, start_chapter_id, mode, options, tasks, status, review_depth, finished_at, error, version, lease_token, lease_until, created_at, updated_at`;

const leasedNow = (row: Pick<Row, "lease_token" | "lease_until">) => row.lease_token !== null && (row.lease_until ?? 0) > Date.now();

function countTasks(tasks: { status: string }[]): TaskCounts {
  const counts: TaskCounts = { todo: 0, written: 0, done: 0, failed: 0, skipped: 0, total: tasks.length };
  for (const t of tasks) if (t.status in counts) counts[t.status as (typeof TASK_STATUSES)[number]] += 1;
  return counts;
}

function toRun(row: Row): AiRun {
  const { options, tasks, lease_token, lease_until, ...rest } = row;
  void lease_token;
  void lease_until;
  return { ...rest, options: JSON.parse(options) as RunOptions, tasks: JSON.parse(tasks) as RunTask[], leased: leasedNow(row) };
}

function toSummary(row: Row & { story_title?: string; start_title?: string | null }): AiRunSummary {
  const { tasks, ...run } = toRun(row);
  const writes = tasks.filter((t) => t.kind === "write");
  return { ...run, counts: countTasks(tasks), chapters: { done: writes.filter((t) => t.status === "done" || t.status === "written").length, total: writes.length }, ...(row.story_title !== undefined && { story_title: row.story_title }), ...(row.start_title !== undefined && { start_title: row.start_title }) };
}

function rowOf(id: string): Row {
  const row = db().prepare(`SELECT ${COLUMNS} FROM ai_runs WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw new PostError("That run does not exist", 404);
  return row;
}

const writeTasks = (tasks: RunTask[]) => tasks.filter((t) => t.kind === "write").length;

function checkTasks(tasks: RunTask[]) {
  if (writeTasks(tasks) > LIMITS.runChapters) throw new PostError(`A run can write at most ${LIMITS.runChapters} chapters`, 400);
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new PostError(`tasks: the id ${t.id} is used twice`, 400);
    ids.add(t.id);
  }
}

/**
 * The tasks of a Find tags run: one per chapter in the scope (the start chapter, the way to it, it and everything below
 * it, or the whole story), in story order, leaving out the chapters already checked (every tag that is on for the story
 * is decided for them, as the review page's Find tags counts them).
 */
function tagTasks(storyId: string, startChapterId: string | null, scope: NonNullable<RunOptions["tagScope"]>): RunTask[] {
  const chapters = getStoryChapters(storyId);
  let chosen = chapters;
  if (startChapterId !== null && scope !== "story") {
    const byId = new Map(chapters.map((c) => [c.id, c]));
    if (!byId.has(startChapterId)) throw new PostError("That chapter is not in this story's tree", 404);
    if (scope === "chapter") chosen = [byId.get(startChapterId)!];
    else if (scope === "path") {
      chosen = [];
      for (let c = byId.get(startChapterId); c; c = c.parent_id ? byId.get(c.parent_id) : undefined) chosen.unshift(c);
    } else {
      const inside = new Set([startChapterId]);
      chosen = chapters.filter((c) => {
        if (c.id === startChapterId || (c.parent_id && inside.has(c.parent_id))) {
          inside.add(c.id);
          return true;
        }
        return false;
      });
    }
  }
  const on = storyTags(storyId);
  const decided = decidedTagIdsByChapter(storyId);
  return chosen
    .filter((c) => !on.every((tid) => (decided.get(c.id) ?? []).includes(tid)))
    .map((c, i) => ({ kind: "tags", id: `t${i + 1}`, chapterId: c.id, revision: c.revision, label: c.title.slice(0, LIMITS.title), status: "todo" }));
}

export function createRun(input: z.infer<typeof NewRunSchema>): { id: string } {
  if (!getStory(input.story_id)) throw new PostError("That story does not exist", 404);
  if (input.start_chapter_id !== null) {
    const chapter = getChapter(input.start_chapter_id);
    if (!chapter || chapter.story_id !== input.story_id) throw new PostError("That chapter is not in this story", 404);
  }
  const tasks: RunTask[] =
    input.mode === "tags" ? tagTasks(input.story_id, input.start_chapter_id, input.options.tagScope ?? (input.start_chapter_id === null ? "story" : "chapter")) : (input.tasks ?? []);
  if (tasks.length > LIMITS.runTasks) throw new PostError(`A run can have at most ${LIMITS.runTasks} tasks`, 400);
  checkTasks(tasks);
  const id = newId();
  const t = Date.now();
  db()
    .prepare(
      `INSERT INTO ai_runs (id, story_id, start_chapter_id, mode, options, tasks, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ready', 1, ?, ?)`,
    )
    .run(id, input.story_id, input.start_chapter_id, input.mode, JSON.stringify(input.options), JSON.stringify(tasks), t, t);
  return { id };
}

export function getRun(id: string): AiRun {
  return toRun(rowOf(id));
}

/** A story's runs, newest first, with task counts instead of tasks; for one start chapter and/or one mode when given. */
export function listRuns(storyId: string, filter: { startChapterId?: string; mode?: RunMode } = {}): AiRunSummary[] {
  const rows = db()
    .prepare(
      `SELECT ${COLUMNS} FROM ai_runs WHERE story_id = ? ${filter.startChapterId ? "AND start_chapter_id = ?" : ""} ${filter.mode ? "AND mode = ?" : ""}
        ORDER BY created_at DESC, rowid DESC`,
    )
    .all(storyId, ...(filter.startChapterId ? [filter.startChapterId] : []), ...(filter.mode ? [filter.mode] : [])) as Row[];
  return rows.map(toSummary);
}

const WITH_TITLES = `SELECT r.id, r.story_id, r.start_chapter_id, r.mode, r.options, r.tasks, r.status, r.review_depth, r.finished_at, r.error, r.version,
       r.lease_token, r.lease_until, r.created_at, r.updated_at, s.title AS story_title, c.title AS start_title
  FROM ai_runs r JOIN stories s ON s.id = r.story_id LEFT JOIN chapters c ON c.id = r.start_chapter_id`;

/** Every story's runs still going (queued, running, in review or paused), the latest 50: what the queue picks up on opening the app. */
export function listUnfinishedRuns(): AiRunSummary[] {
  const rows = db()
    .prepare(`${WITH_TITLES} WHERE r.status IN ('queued', 'running', 'review', 'paused') ORDER BY r.updated_at DESC, r.rowid DESC LIMIT 50`)
    .all() as Row[];
  return rows.map(toSummary);
}

/** Finished and stopped runs, newest first, for the queue page's History; `before` is the `finished_at` of the last one shown. */
export function listFinishedRuns(page: { before?: number; limit: number }): { runs: AiRunSummary[]; next: number | null } {
  const rows = db()
    .prepare(`${WITH_TITLES} WHERE r.status IN ('done', 'stopped') AND r.finished_at < ? ORDER BY r.finished_at DESC, r.rowid DESC LIMIT ?`)
    .all(page.before ?? Number.MAX_SAFE_INTEGER, page.limit + 1) as Row[];
  const shown = rows.slice(0, page.limit);
  return { runs: shown.map(toSummary), next: rows.length > page.limit ? (shown[shown.length - 1].finished_at ?? null) : null };
}

/**
 * Takes the run's lease for this tab: allowed when nobody holds it, it ran out, or `token` already holds it.
 * Returns the run's version, which the tab sends with its saves.
 */
export function claimRun(id: string, { token }: z.infer<typeof ClaimSchema>): { version: number } {
  return db().transaction(() => {
    const row = rowOf(id);
    if (leasedNow(row) && row.lease_token !== token) throw new PostError("This run is going in another tab or browser.", 409);
    db().prepare(`UPDATE ai_runs SET lease_token = ?, lease_until = ? WHERE id = ?`).run(token, Date.now() + LEASE_MS, id);
    return { version: row.version };
  })();
}

const RELEASING: RunStatus[] = ["review", "paused", "done", "stopped"];

/** Saves what a tab did: needs the lease and the version it last saw; bumps the version and renews the lease. */
export function updateRun(id: string, input: z.infer<typeof UpdateRunSchema>): AiRun {
  return db().transaction(() => {
    const row = rowOf(id);
    if (row.lease_token !== input.token) throw new PostError("This run is going in another tab or browser.", 409);
    if (row.version !== input.version) throw new PostError("This run changed elsewhere; reload it.", 409);
    if (input.tasks) checkTasks(input.tasks);
    const status = input.status ?? row.status;
    const release = RELEASING.includes(status);
    const t = Date.now();
    db()
      .prepare(
        `UPDATE ai_runs SET tasks = ?, status = ?, review_depth = ?, error = ?, finished_at = ?, version = version + 1, updated_at = ?,
                lease_token = ?, lease_until = ? WHERE id = ?`,
      )
      .run(
        input.tasks ? JSON.stringify(input.tasks) : row.tasks,
        status,
        input.review_depth === undefined ? row.review_depth : input.review_depth,
        input.error === undefined ? row.error : input.error,
        status === "done" || status === "stopped" ? (row.finished_at ?? t) : row.finished_at,
        t,
        release ? null : row.lease_token,
        release ? null : t + LEASE_MS,
        id,
      );
    return toRun(rowOf(id));
  })();
}

/**
 * The owner's edits to a run in `review` (D23): the text of write tasks at the level whose plans wait, and removing
 * some (they are marked skipped). The run goes back to `queued`; nothing runs it meanwhile, so no lease is needed.
 */
export function reviewRun(id: string, input: z.infer<typeof ReviewRunSchema>): AiRun {
  return db().transaction(() => {
    const row = rowOf(id);
    if (row.status !== "review") throw new PostError("That run is not waiting for a check of its plans", 409);
    if (row.version !== input.version) throw new PostError("This run changed elsewhere; reload it.", 409);
    const tasks = JSON.parse(row.tasks) as RunTask[];
    for (const edit of input.tasks) {
      const task = tasks.find((t) => t.id === edit.id);
      if (!task || task.kind !== "write" || task.status !== "todo" || task.depth !== row.review_depth) {
        throw new PostError(`tasks: ${edit.id} is not a chapter waiting at the level being checked`, 400);
      }
      if (edit.remove) task.status = "skipped";
      else {
        if (edit.label !== undefined) task.label = edit.label;
        if (edit.direction !== undefined) task.direction = edit.direction;
      }
    }
    const options = JSON.parse(row.options) as RunOptions;
    if (row.review_depth !== null) options.reviewedDepths = [...new Set([...(options.reviewedDepths ?? []), row.review_depth])];
    db()
      .prepare(`UPDATE ai_runs SET tasks = ?, options = ?, status = 'queued', review_depth = NULL, version = version + 1, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(tasks), JSON.stringify(options), Date.now(), id);
    return toRun(rowOf(id));
  })();
}

/** Marks every chapter the run wrote as reviewed (those already marked keep their time). */
export function markRunReviewed(id: string): { marked: number } {
  rowOf(id);
  const { changes } = db().prepare(`UPDATE chapters SET ai_reviewed_at = ? WHERE ai_run_id = ? AND ai_reviewed_at IS NULL`).run(Date.now(), id);
  return { marked: changes };
}

/** The ids of the chapters a run wrote (the ones marked with it). */
export function chapterIdsOfRun(runId: string): string[] {
  return (db().prepare(`SELECT id FROM chapters WHERE ai_run_id = ?`).all(runId) as { id: string }[]).map((r) => r.id);
}
