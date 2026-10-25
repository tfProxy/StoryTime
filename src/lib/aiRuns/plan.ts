// Planner for AI runs: pure functions that turn the owner's choices into a task list and pick the next task.
// No database, no network. Milestone 1 (Fill open choices) uses planFill; later modes add their own planners.

import { arcDirection } from "../ai/prompts";
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
  // Grow the tree: a level made by `expandAfter` has no plan task; its plans came with the chapters above, so it can be checked as soon as it exists.
  if (!plans.length) return waiting.filter((t) => t.depth === depth).every((t) => !t.plannedBy);
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

// ---- Grow the tree ----

/** The options Grow the tree reads (`maxDepth`, `breadth`, `endChoices`, `guidance` of `RunOptions`), with their defaults. */
function growOptions(opts: RunOptions) {
  return {
    depth: Math.max(1, opts.maxDepth ?? 3),
    breadth: Math.max(1, opts.breadth ?? 3),
    endChoices: opts.endChoices ?? DEFAULT_END_CHOICES,
    guidance: opts.guidance ?? "",
  };
}

/**
 * Grow the tree: fill the tree below the start chapter to `maxDepth` levels with `breadth` choices per chapter,
 * counting what is already there. Chapters from the start down to the level above the last are looked at; of each
 * chapter's choices, up to `breadth` are kept (written ones first). A chapter with an open choice among them, or
 * with fewer than `breadth` choices, gets a plan task (`labels` the open ones, `add` the choices it lacks) and a
 * write task per open choice among them. Written ones among them are looked at in turn. Choices past the first
 * `breadth` are left alone. Chapters that will be written get their own choices from the runner, planned together
 * (`expand`), and `expandAfter` adds their tasks once they exist.
 */
export function planTree(tree: PlanNode, opts: RunOptions): RunTask[] {
  const { depth: D, breadth: B, endChoices } = growOptions(opts);
  const tasks: RunTask[] = [];
  const visit = (node: PlanNode) => {
    const level = node.depth - tree.depth; // 0 for the start chapter
    const kept = [...node.choices.filter((c) => c.child), ...node.choices.filter((c) => !c.child)].slice(0, B);
    const open = kept.filter((c) => !c.child);
    const add = Math.max(0, B - node.choices.length);
    if (open.length > 0 || add > 0) {
      const planId = newTaskId(tasks);
      tasks.push({ kind: "plan", id: planId, chapterId: node.id, depth: level + 1, labels: open.map((c) => c.label), add, status: "todo" } satisfies PlanTask);
      for (const c of open) {
        tasks.push({
          kind: "write",
          id: newTaskId(tasks),
          slot: { kind: "choice", choiceId: c.id },
          label: c.label,
          direction: "",
          depth: level + 1,
          choices: { given: [], suggest: level + 1 < D ? B : endChoices },
          plannedBy: planId,
          parentChapterId: node.id,
          expand: level + 1 < D,
          status: "todo",
        } satisfies WriteTask);
      }
    }
    if (level + 1 < D) for (const c of kept) if (c.child) visit(c.child);
  };
  visit(tree);
  return tasks;
}

/**
 * The tasks to add once `done` is done: for a write task with `expand`, one write task per choice its chapter was
 * posted with (`choiceIds`, in the order of `planned`), each starting from what the plan said happens (D22); for a
 * plan task that added choices (`add`), a write task for each added choice with its plan. They follow the rules of
 * `planTree`: chapters at the last level aren't expanded, and their own choices are the D5 ones. `tasks` is the
 * current list (for ids). Pure.
 */
export function expandAfter(done: RunTask, tasks: RunTask[], opts: RunOptions): RunTask[] {
  const { depth: D, breadth: B, endChoices, guidance } = growOptions(opts);
  const out: RunTask[] = [];
  const make = (parentChapterId: string, depth: number, choiceId: string, label: string, direction: string) => {
    const all = [...tasks, ...out];
    out.push({
      kind: "write",
      id: newTaskId(all),
      slot: { kind: "choice", choiceId },
      label,
      direction: withGuidance(direction, guidance),
      depth,
      choices: { given: [], suggest: depth < D ? B : endChoices },
      parentChapterId,
      expand: depth < D,
      status: "todo",
    } satisfies WriteTask);
  };
  if (done.kind === "write" && done.status === "done" && done.expand && done.chapterId && done.depth < D) {
    (done.choiceIds ?? []).slice(0, B).forEach((choiceId, i) => {
      const plan = done.planned?.[i];
      make(done.chapterId!, done.depth + 1, choiceId, plan?.label ?? `Choice ${i + 1}`, plan?.direction ?? "");
    });
  } else if (done.kind === "plan" && done.status === "done" && done.add > 0 && done.depth <= D) {
    const given = new Set(done.labels);
    for (const step of done.steps ?? []) {
      if (!step.choiceId || given.has(step.label)) continue;
      make(done.chapterId, done.depth, step.choiceId, step.label, step.direction);
    }
  }
  return out;
}

/**
 * What a Grow the tree run will cost before it starts, counting the chapters `expandAfter` will add level by level
 * (each chapter written above the last level gets `breadth` choices, each written in turn). From a bare chapter,
 * depth 3 and breadth 3 is 3 + 9 + 27 = 39 chapters.
 */
export function estimateTree(tree: PlanNode, opts: RunOptions): { chapters: number; requests: number } {
  const { depth: D, breadth: B } = growOptions(opts);
  const tasks = planTree(tree, opts);
  const plans = tasks.filter((t) => t.kind === "plan").length;
  // Chapters to write at each level, and how many of them will have choices of their own to write.
  const at = new Map<number, number>();
  const bump = (d: number, n: number) => at.set(d, (at.get(d) ?? 0) + n);
  for (const t of tasks) {
    if (t.kind === "write") bump(t.depth, 1);
    else if (t.kind === "plan") bump(t.depth, t.add);
  }
  for (let d = 1; d < D; d++) bump(d + 1, (at.get(d) ?? 0) * B);
  const chapters = [...at.values()].reduce((a, b) => a + b, 0);
  return { chapters, requests: chapters * 3 + plans };
}

// ---- Reach a goal ----

/** One step of a Reach a goal plan: the choice that leads into the chapter, and what happens in it. */
export type ArcStep = { choice: string; direction: string };

/**
 * Reach a goal: a chain of write tasks, one chapter after another from `startChapterId`. The first goes into an
 * existing open choice (`startChoice`, whose text then replaces the first step's) or into a new choice on the
 * start chapter; each later one goes into the first choice of the chapter before it (`fromTask`), which is the
 * choice to the next step. A chapter's choices are the next step's (only that one, D6) plus `alternatives` more
 * from the AI; the last chapter's are the end choices. Directions come from `arcDirection` with the guidance.
 */
export function planArc(startChapterId: string, steps: ArcStep[], opts: RunOptions, startChoice?: { id: string; label: string }): RunTask[] {
  const objective = opts.objective ?? "";
  const alternatives = opts.alternatives ?? 0;
  const endChoices = opts.endChoices ?? DEFAULT_END_CHOICES;
  const tasks: RunTask[] = [];
  steps.forEach((step, k) => {
    const last = k === steps.length - 1;
    const id = newTaskId(tasks);
    const label = k === 0 && startChoice ? startChoice.label : step.choice;
    const slot: WriteTask["slot"] =
      k > 0 ? { kind: "fromTask", taskId: tasks[k - 1].id, choiceIndex: 0 } : startChoice ? { kind: "choice", choiceId: startChoice.id } : { kind: "new", parentChapterId: startChapterId, label };
    tasks.push({
      kind: "write",
      id,
      slot,
      label,
      direction: withGuidance(arcDirection(objective, step, k, steps.length, steps[k + 1]?.choice), opts.guidance),
      depth: k + 1,
      choices: last ? { given: [], suggest: endChoices } : { given: [steps[k + 1].choice], suggest: alternatives },
      ...(k === 0 && { parentChapterId: startChapterId }),
      expand: false,
      status: "todo",
    } satisfies WriteTask);
  });
  return tasks;
}

/** What a Reach a goal run will cost: each chapter is about 3 requests (the chapter, its summary, the plan for its choices); the plan itself is one more. */
export function estimateArc(steps: ArcStep[]): { chapters: number; requests: number } {
  return { chapters: steps.length, requests: steps.length * 3 + 1 };
}
