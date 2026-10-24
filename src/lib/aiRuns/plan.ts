// Planner for AI runs: pure functions that turn the owner's choices into a task list and pick the next task.
// No database, no network. Milestone 1 (Fill open choices) uses planFill; later modes add their own planners.

import type { AiRun, PlanTask, RunOptions, RunTask, WriteTask } from "./types";

/**
 * The part of the story tree the planner reads. The app's `TreeNode` (src/lib/tree.ts) fits this shape;
 * only ids, depths and choices are used, so extra fields on it are ignored.
 */
export type PlanNode = {
  id: string;
  depth: number;
  choices: { id: string; label: string; child: PlanNode | null }[];
};

/** Default for D5: choices suggested on the last chapters written. */
export const DEFAULT_END_CHOICES = 3;

/** Joins the author's guidance to a direction with a blank line; either may be empty. */
export function withGuidance(direction: string, guidance: string | undefined): string {
  return [direction, guidance ?? ""].map((s) => s.trim()).filter(Boolean).join("\n\n");
}

/** "t1", "t2", …: one more than the highest number in use. */
export function newTaskId(tasks: RunTask[]): string {
  let max = 0;
  for (const t of tasks) {
    const n = /^t(\d+)$/.exec(t.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `t${max + 1}`;
}

/**
 * Fill open choices (D4): for each chapter with unwritten choices (only the start chapter when
 * `scope` is "children", else every chapter in the tree), a plan task, then a write task per
 * unwritten choice. Breadth first: by depth, then in choice order.
 */
export function planFill(tree: PlanNode, opts: RunOptions): RunTask[] {
  const tasks: RunTask[] = [];
  const endChoices = opts.endChoices ?? DEFAULT_END_CHOICES;
  const queue: PlanNode[] = [tree];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const depth = node.depth - tree.depth + 1; // of the chapters its choices lead to
    const open = node.choices.filter((c) => !c.child);
    if (open.length) {
      const planId = newTaskId(tasks);
      const plan: PlanTask = { kind: "plan", id: planId, chapterId: node.id, depth, labels: open.map((c) => c.label), add: 0, status: "todo" };
      tasks.push(plan);
      for (const c of open) {
        const write: WriteTask = {
          kind: "write",
          id: newTaskId(tasks),
          slot: { kind: "choice", choiceId: c.id },
          label: c.label,
          direction: "",
          depth,
          choices: { given: [], suggest: endChoices },
          plannedBy: planId,
          parentChapterId: node.id,
          expand: false,
          status: "todo",
        };
        tasks.push(write);
      }
    }
    if (opts.scope === "children") break;
    for (const c of node.choices) if (c.child) queue.push(c.child);
  }
  return tasks;
}

/**
 * What a Fill run will cost before it starts. Each chapter written is about 3 requests (the chapter, its
 * summary, and the plan for its new choices); each plan step on an existing chapter is one more.
 */
export function estimateFill(tree: PlanNode, opts: RunOptions): { chapters: number; requests: number } {
  const tasks = planFill(tree, opts);
  const chapters = tasks.filter((t) => t.kind === "write").length;
  const plans = tasks.length - chapters;
  return { chapters, requests: chapters * 3 + plans };
}

/**
 * Copies a finished plan step's directions (with the run's guidance) into the write tasks it planned.
 * A step is matched by its `choiceId` (set once the runner has added a new choice) or else by its label;
 * each write task takes one step. Only tasks still `todo` change. Returns a new list.
 */
export function applyPlan(tasks: RunTask[], planTask: PlanTask, guidance = ""): RunTask[] {
  const taken = new Set<string>();
  const next = tasks.map((t) => ({ ...t })) as RunTask[];
  for (const step of planTask.steps ?? []) {
    const hit = next.find(
      (t): t is WriteTask =>
        t.kind === "write" &&
        t.plannedBy === planTask.id &&
        t.status === "todo" &&
        !taken.has(t.id) &&
        (step.choiceId ? t.slot.kind === "choice" && t.slot.choiceId === step.choiceId : t.label === step.label),
    );
    if (!hit) continue;
    taken.add(hit.id);
    hit.direction = withGuidance(step.direction, guidance);
  }
  return next;
}

const settled = (s: string) => s === "failed" || s === "skipped";

/**
 * The first `todo` task that can go, and the task list with any task whose dependency failed or was
 * skipped marked `skipped` (also returned, since the caller saves it). A write task waits for its
 * `plannedBy` plan task and, for a `fromTask` slot, for that task; both must be `done`.
 */
export function nextTask(tasks: RunTask[]): { task: RunTask | null; tasks: RunTask[] } {
  const list = tasks.map((t) => ({ ...t })) as RunTask[];
  const byId = new Map(list.map((t) => [t.id, t]));
  const deps = (t: RunTask): string[] => {
    if (t.kind !== "write") return [];
    const ids: string[] = [];
    if (t.plannedBy) ids.push(t.plannedBy);
    if (t.slot.kind === "fromTask") ids.push(t.slot.taskId);
    return ids;
  };
  // Skips can cascade (a skipped task's own dependents), so repeat until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of list) {
      if (t.status !== "todo") continue;
      if (deps(t).some((id) => settled(byId.get(id)?.status ?? "skipped"))) {
        t.status = "skipped";
        t.error = t.error ?? "Skipped because an earlier step did not finish.";
        changed = true;
      }
    }
  }
  const task = list.find((t) => t.status === "todo" && deps(t).every((id) => byId.get(id)?.status === "done")) ?? null;
  return { task, tasks: list };
}

/**
 * Whether the run should pause for the owner to check the plans (D23). True when `reviewPlan` is on, the
 * next depth to write (the lowest depth with a write task still `todo`) is not in `options.reviewedDepths`,
 * and every plan task at that depth has finished (failed or skipped ones count as finished) with at least
 * one `done`. The runner adds the depth to `reviewedDepths` when the owner presses Continue.
 */
export function needsReview(run: Pick<AiRun, "options" | "tasks">): boolean {
  if (!run.options.reviewPlan) return false;
  const waiting = run.tasks.filter((t): t is WriteTask => t.kind === "write" && t.status === "todo");
  if (!waiting.length) return false;
  const depth = Math.min(...waiting.map((t) => t.depth));
  if ((run.options.reviewedDepths ?? []).includes(depth)) return false;
  const plans = run.tasks.filter((t): t is PlanTask => t.kind === "plan" && t.depth === depth);
  if (!plans.length) return false;
  return plans.every((p) => p.status === "done" || settled(p.status)) && plans.some((p) => p.status === "done");
}

/** Where a write task's chapter goes: an existing choice, or a new choice to add to a chapter. */
export function resolveSlot(task: WriteTask, tasks: RunTask[]): { choiceId: string } | { parentChapterId: string; newLabel: string } {
  const slot = task.slot;
  if (slot.kind === "choice") return { choiceId: slot.choiceId };
  if (slot.kind === "new") return { parentChapterId: slot.parentChapterId, newLabel: slot.label };
  const from = tasks.find((t) => t.id === slot.taskId);
  if (!from || from.kind !== "write") throw new Error(`Task ${slot.taskId} not found.`);
  const choiceId = from.choiceIds?.[slot.choiceIndex];
  if (!choiceId) throw new Error(`Task ${slot.taskId} has no choice number ${slot.choiceIndex + 1}.`);
  return { choiceId };
}
