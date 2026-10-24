import { applyPlan, estimateFill, needsReview, newTaskId, nextTask, planFill, resolveSlot, withGuidance, type PlanNode } from "../../src/lib/aiRuns/plan.ts";
import type { PlanTask, RunTask, WriteTask } from "../../src/lib/aiRuns/types.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const leaf = (id: string, depth: number, labels: string[] = []): PlanNode => ({
  id, depth, choices: labels.map((l, i) => ({ id: `${id}-c${i}`, label: l, child: null })),
});

// root (depth 0): a -> A (written), b open, c open
//   A (depth 1): a1 -> A1 (written), a2 open
//     A1 (depth 2): a1x open, a1y open
const A1 = leaf("A1", 2, ["a1x", "a1y"]);
const A: PlanNode = { id: "A", depth: 1, choices: [{ id: "A-c0", label: "a1", child: A1 }, { id: "A-c1", label: "a2", child: null }] };
const root: PlanNode = { id: "R", depth: 0, choices: [{ id: "R-c0", label: "a", child: A }, { id: "R-c1", label: "b", child: null }, { id: "R-c2", label: "c", child: null }] };

// Scope "children": only the start chapter.
let t = planFill(root, { scope: "children" });
ok(t.map((x) => x.kind).join() === "plan,write,write", "children: one plan task then a write task per open choice");
ok((t[0] as PlanTask).labels.join() === "b,c" && (t[0] as PlanTask).add === 0 && (t[0] as PlanTask).chapterId === "R", "children: the plan covers b and c");
ok(t.slice(1).every((x) => x.kind === "write" && x.plannedBy === t[0].id && x.depth === 1 && x.direction === "" && !x.expand), "children: write tasks wait for the plan, depth 1, no direction yet");

// Scope "below": breadth first.
t = planFill(root, { scope: "below", endChoices: 2 });
ok(t.map((x) => (x.kind === "plan" ? `P:${x.chapterId}` : (x as WriteTask).label)).join() === "P:R,b,c,P:A,a2,P:A1,a1x,a1y", "below: breadth first, a plan task before each chapter's write tasks");
ok(new Set(t.map((x) => x.id)).size === t.length, "task ids are unique");
const writes = t.filter((x): x is WriteTask => x.kind === "write");
ok(writes.map((w) => w.depth).join() === "1,1,2,3,3", "below: depths are relative to the start chapter: " + writes.map((w) => w.depth).join());
ok(writes.every((w) => w.choices.suggest === 2 && w.choices.given.length === 0 && w.slot.kind === "choice"), "endChoices becomes choices.suggest");
ok(planFill(root, { scope: "below" }).filter((x): x is WriteTask => x.kind === "write")[0].choices.suggest === 3, "endChoices defaults to 3 (D5)");
ok((writes[2].slot as { choiceId: string }).choiceId === "A-c1", "slot points at the choice");
ok(planFill(leaf("X", 0, []), { scope: "below" }).length === 0, "nothing open gives no tasks");

// A tree whose start chapter is not at depth 0 still numbers from 1.
const sub = planFill(A, { scope: "below" }).filter((x): x is WriteTask => x.kind === "write");
ok(sub.map((w) => w.depth).join() === "1,2,2", "depth is relative to the start chapter");

// Estimate counts plan requests too.
const est = estimateFill(root, { scope: "below" });
ok(est.chapters === 5 && est.requests === 5 * 3 + 3, `estimate: ${JSON.stringify(est)}`);
ok(estimateFill(root, { scope: "children" }).chapters === 2 && estimateFill(root, { scope: "children" }).requests === 7, "estimate for children");

// withGuidance
ok(withGuidance("x", "y") === "x\n\ny" && withGuidance("", "y") === "y" && withGuidance("x", "") === "x" && withGuidance("", "") === "" && withGuidance("x", undefined) === "x", "withGuidance joins with a blank line");

// newTaskId
ok(newTaskId([]) === "t1" && newTaskId(t) === "t9", "newTaskId is one past the highest: " + newTaskId(t));

// applyPlan
const planTask = { ...(t[0] as PlanTask), status: "done" as const, steps: [{ label: "c", direction: "C happens" }, { label: "b", direction: "B happens" }, { label: "zzz", direction: "new one" }] };
let applied = applyPlan(t, planTask, "Keep it dark");
const dirOf = (list: RunTask[], label: string) => (list.find((x) => x.kind === "write" && x.label === label) as WriteTask).direction;
ok(dirOf(applied, "b") === "B happens\n\nKeep it dark" && dirOf(applied, "c") === "C happens\n\nKeep it dark", "applyPlan copies directions with guidance, matched by label");
ok(dirOf(applied, "a2") === "" && dirOf(t, "b") === "", "applyPlan leaves other tasks and the input alone");
applied = applyPlan(t, { ...planTask, steps: [{ label: "whatever", direction: "by id", choiceId: "R-c2" }] });
ok(dirOf(applied, "c") === "by id" && dirOf(applied, "b") === "", "applyPlan matches by choiceId when the step has one");

// nextTask
let r = nextTask(t);
ok(r.task?.id === t[0].id, "nextTask starts with the first plan task");
const doneAll = (list: RunTask[], ids: string[]) => list.map((x) => (ids.includes(x.id) ? { ...x, status: "done" as const } : x)) as RunTask[];
r = nextTask(doneAll(t, [t[0].id]));
ok(r.task?.id === t[1].id, "after the plan is done, its first write task");
r = nextTask(t.map((x, i) => (i === 0 ? x : { ...x, status: "done" as const })) as RunTask[]);
ok(r.task?.id === t[0].id, "a write task is never picked ahead of an unfinished plan");
const failedPlan = t.map((x) => (x.id === t[0].id ? { ...x, status: "failed" as const } : x)) as RunTask[];
r = nextTask(failedPlan);
const stat = (id: string) => r.tasks.find((x) => x.id === id)!.status;
ok(stat(t[1].id) === "skipped" && stat(t[2].id) === "skipped", "a failed plan skips its write tasks");
ok(r.task?.id === t[3].id && r.task.kind === "plan", "…and the next plan goes on");
ok(failedPlan[1].status === "todo", "nextTask does not change its input");
ok(nextTask(t.map((x) => ({ ...x, status: "done" as const })) as RunTask[]).task === null, "nothing left gives null");

const arc: RunTask[] = [
  { kind: "write", id: "t1", slot: { kind: "new", parentChapterId: "R", label: "go" }, label: "go", direction: "", depth: 1, choices: { given: ["x", "y"], suggest: 0 }, expand: false, status: "todo" },
  { kind: "write", id: "t2", slot: { kind: "fromTask", taskId: "t1", choiceIndex: 0 }, label: "x", direction: "", depth: 2, choices: { given: [], suggest: 0 }, expand: false, status: "todo" },
  { kind: "write", id: "t3", slot: { kind: "fromTask", taskId: "t2", choiceIndex: 0 }, label: "z", direction: "", depth: 3, choices: { given: [], suggest: 0 }, expand: false, status: "todo" },
];
ok(nextTask(arc).task?.id === "t1", "fromTask: the first task goes first");
ok(nextTask(arc.map((x) => (x.id === "t1" ? { ...x, status: "done" as const } : x)) as RunTask[]).task?.id === "t2", "fromTask: t2 can go once t1 is done");
r = nextTask(arc.map((x) => (x.id === "t1" ? { ...x, status: "failed" as const } : x)) as RunTask[]);
ok(r.task === null && r.tasks[1].status === "skipped" && r.tasks[2].status === "skipped", "a failed fromTask skips its dependents, and theirs");

// resolveSlot
const posted = arc.map((x) => (x.id === "t1" ? { ...x, status: "done" as const, choiceIds: ["cx", "cy"] } : x)) as RunTask[];
ok(JSON.stringify(resolveSlot(t[1] as WriteTask, t)) === '{"choiceId":"R-c1"}', "resolveSlot: choice");
ok(JSON.stringify(resolveSlot(arc[0] as WriteTask, arc)) === '{"parentChapterId":"R","newLabel":"go"}', "resolveSlot: new");
ok(JSON.stringify(resolveSlot(posted[1] as WriteTask, posted)) === '{"choiceId":"cx"}', "resolveSlot: fromTask");
let threw = false;
try { resolveSlot(arc[1] as WriteTask, arc); } catch { threw = true; }
ok(threw, "resolveSlot: fromTask with no posted choices throws");

// needsReview
const run = (reviewPlan: boolean, tasks: RunTask[], reviewedDepths?: number[]) => ({ options: { reviewPlan, reviewedDepths }, tasks });
const planned = planFill(root, { scope: "below" });
ok(!needsReview(run(false, planned)), "review off: never");
ok(!needsReview(run(true, planned)), "review on, plans not done yet: no");
const plansDone = planned.map((x) => (x.kind === "plan" ? { ...x, status: "done" as const } : x)) as RunTask[];
ok(needsReview(run(true, plansDone)), "review on, plans at the next depth done: yes");
const level1Done = plansDone.map((x) => (x.kind === "write" && x.depth === 1 ? { ...x, status: "done" as const } : x)) as RunTask[];
ok(!needsReview(run(true, plansDone, [1])), "depth 1 reviewed: no review at depth 1 (the next depth to write is still 1)");
ok(needsReview(run(true, level1Done)), "after depth 1 is written, depth 2's plans wait for review");
ok(!needsReview(run(true, level1Done, [2])), "…until the owner continues");
ok(!needsReview(run(true, planned.map((x) => ({ ...x, status: "done" as const })) as RunTask[])), "nothing left to write: no review");
