import { applyPlan, estimateFill, estimateTree, expandAfter, planTree, needsReview, newTaskId, nextTask, planFill, resolveSlot, withGuidance, type PlanNode } from "../../src/lib/aiRuns/plan.ts";
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

// ---- Grow the tree ----
{
  // root: a -> A (written; A has one open choice a1), b open, c open.
  const A2: PlanNode = { id: "A", depth: 1, choices: [{ id: "A-c0", label: "a1", child: null }] };
  const R: PlanNode = { id: "R", depth: 0, choices: [{ id: "R-c0", label: "a", child: A2 }, { id: "R-c1", label: "b", child: null }, { id: "R-c2", label: "c", child: null }] };
  const tt = planTree(R, { maxDepth: 2, breadth: 3, endChoices: 2 });
  const desc = tt.map((x) => (x.kind === "plan" ? `P:${x.chapterId}[${x.labels.join("+")}]+${x.add}@${x.depth}` : `W:${(x as WriteTask).label}@${(x as WriteTask).depth}${(x as WriteTask).expand ? "*" : ""}`)).join(" ");
  ok(desc === "P:R[b+c]+0@1 W:b@1* W:c@1* P:A[a1]+2@2 W:a1@2", "planTree: a plan and write tasks per level; a chapter with one choice is topped up (add 2); only the last level isn't expanded: " + desc);
  const w = tt.filter((x): x is WriteTask => x.kind === "write");
  ok(w[0].choices.suggest === 3 && w[2].choices.suggest === 2, "chapters above the last level get `breadth` suggested choices, the last level the end choices");
  ok(w.every((x) => x.plannedBy && x.parentChapterId && x.slot.kind === "choice" && x.direction === ""), "…each waits for its plan, knows its parent, and has no direction yet");

  // Written ones are kept first, open ones fill the rest up to breadth; past that is left alone.
  const many: PlanNode = { id: "M", depth: 0, choices: [
    { id: "m0", label: "open1", child: null }, { id: "m1", label: "done1", child: { id: "D1", depth: 1, choices: [] } },
    { id: "m2", label: "open2", child: null }, { id: "m3", label: "open3", child: null }, { id: "m4", label: "open4", child: null } ] };
  const mt = planTree(many, { maxDepth: 1, breadth: 3 });
  ok((mt[0] as PlanTask).labels.join() === "open1,open2" && (mt[0] as PlanTask).add === 0 && mt.filter((x) => x.kind === "write").length === 2, "with more choices than breadth, the written one counts first and the open ones after it fill what is left");
  ok(planTree(leaf("Z", 0, ["x", "y", "z"]), { maxDepth: 2, breadth: 2 }).filter((x) => x.kind === "write").length === 2, "…and choices past the first `breadth` are not written");
  // Depth 1 looks only at the start chapter.
  ok(planTree(R, { maxDepth: 1, breadth: 3 }).every((x) => x.kind !== "plan" || x.chapterId === "R"), "depth 1 plans only the start chapter's choices");
  // A bare chapter: one plan task adding `breadth` choices, no write tasks yet.
  const bare = planTree(leaf("B0", 0, []), { maxDepth: 3, breadth: 3 });
  ok(bare.length === 1 && bare[0].kind === "plan" && bare[0].add === 3 && bare[0].labels.length === 0, "a bare chapter gets one plan task that adds `breadth` choices");
  ok(planTree(leaf("S", 3, ["q"]), { maxDepth: 2, breadth: 1 }).filter((x) => x.kind === "write").map((x) => (x as WriteTask).depth).join() === "1", "depths are relative to the start chapter");
  ok(planTree(R, { maxDepth: 2, breadth: 3 }).length === tt.length && JSON.stringify(planTree(R, { maxDepth: 2, breadth: 3, endChoices: 2 })) === JSON.stringify(tt), "the same tree gives the same tasks");

  // Estimates.
  const e39 = estimateTree(leaf("B1", 0, []), { maxDepth: 3, breadth: 3 });
  ok(e39.chapters === 39 && e39.requests === 39 * 3 + 1, "estimate: depth 3, breadth 3 from a bare chapter is 39 chapters: " + JSON.stringify(e39));
  ok(estimateTree(leaf("B2", 0, []), { maxDepth: 2, breadth: 2 }).chapters === 6, "…depth 2, breadth 2 is 6");
  ok(estimateTree(leaf("B3", 0, []), { maxDepth: 8, breadth: 6 }).chapters > 200, "…a 6 × 8 tree is far over the limit");
  const withExisting = estimateTree(R, { maxDepth: 2, breadth: 3 });
  // b, c expand to 3 each (6), a1 is last level (1), A gains 2 (last level): 6 + 1 + 2 + 2 + 2 ... b and c's 3 choices each at depth 2, plus b,c, a1, +2 new on A.
  ok(withExisting.chapters === 2 + 6 + 1 + 2, "the estimate counts open choices, the choices they will grow and the ones added to a short chapter: " + withExisting.chapters);
  ok(estimateTree(R, { maxDepth: 2, breadth: 3 }).requests === withExisting.chapters * 3 + 2, "…with a request per plan task too");

  // expandAfter.
  const done: WriteTask = {
    kind: "write", id: "t9", slot: { kind: "choice", choiceId: "c" }, label: "Go", direction: "", depth: 1, choices: { given: [], suggest: 3 }, expand: true, status: "done",
    chapterId: "CH", choiceIds: ["k1", "k2", "k3"], planned: [{ label: "One", direction: "First plan" }, { label: "Two", direction: "Second plan" }, { label: "Three", direction: "Third plan" }],
  };
  const grown = expandAfter(done, [done], { maxDepth: 3, breadth: 3, endChoices: 2, guidance: "Light." });
  ok(grown.length === 3 && grown.every((x) => x.kind === "write" && x.depth === 2 && x.parentChapterId === "CH" && x.expand === true), "expandAfter: a write task per choice of the new chapter, one level down");
  ok((grown[1] as WriteTask).label === "Two" && (grown[1] as WriteTask).direction === "Second plan\n\nLight." && (grown[1] as WriteTask).slot.kind === "choice" && ((grown[1] as WriteTask).slot as { choiceId: string }).choiceId === "k2", "…each with its plan as the direction (with the guidance), and its choice");
  ok(new Set([done.id, ...grown.map((x) => x.id)]).size === 4, "…and new ids");
  const last = expandAfter({ ...done, depth: 2 }, [done], { maxDepth: 3, breadth: 3, endChoices: 2 });
  ok(last.length === 3 && last.every((x) => (x as WriteTask).depth === 3 && !(x as WriteTask).expand && (x as WriteTask).choices.suggest === 2), "…the last level's tasks aren't expanded and suggest the end choices");
  ok(expandAfter({ ...done, depth: 3, expand: false }, [done], { maxDepth: 3, breadth: 3 }).length === 0, "expandAfter stops at depth D");
  ok(expandAfter({ ...done, status: "written" }, [done], { maxDepth: 3, breadth: 3 }).length === 0 && expandAfter({ ...done, expand: false }, [done], { maxDepth: 3, breadth: 3 }).length === 0, "…and does nothing for a task that isn't done or isn't expanded");
  const planDone: PlanTask = { kind: "plan", id: "t1", chapterId: "R", depth: 1, labels: ["b"], add: 2, status: "done", steps: [{ label: "b", direction: "plan b", choiceId: "R-c1" }, { label: "New 1", direction: "plan n1", choiceId: "n1" }, { label: "New 2", direction: "plan n2", choiceId: "n2" }] };
  const fromPlan = expandAfter(planDone, [planDone], { maxDepth: 3, breadth: 3 });
  ok(fromPlan.length === 2 && fromPlan.map((x) => (x as WriteTask).label).join() === "New 1,New 2" && (fromPlan[0] as WriteTask).direction === "plan n1" && (fromPlan[0] as WriteTask).depth === 1 && (fromPlan[0] as WriteTask).parentChapterId === "R", "a plan task that added choices gives write tasks for those, with their plans, and not for the given ones");
  ok(expandAfter({ ...planDone, add: 0 }, [planDone], { maxDepth: 3, breadth: 3 }).length === 0, "…none when it added nothing");
}
