"use client";

// The write-ahead page's body: an unfinished run to pick up, the form that starts a Fill run, or the run in progress.
// The form is built so later modes (grow the tree, reach a goal) can join "What to write" as more options.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { arcPlanPrompt, generatePrompt, parseIdeas, SYSTEM_ARC_PLAN, SYSTEM_CHAPTER, type StoryContext } from "@/lib/ai/prompts";
import { claim, finish } from "@/lib/aiRuns/runner";
import { estimateArc, estimateFill, estimateTree, planArc, planFill, planTree, DEFAULT_END_CHOICES, type ArcStep, type PlanNode } from "@/lib/aiRuns/plan";
import { completeChat } from "@/lib/ai/client";
import type { RunOptions } from "@/lib/aiRuns/types";
import { LIMITS } from "@/lib/limits";
import { usableRef, useSettings, type ModelRef } from "@/lib/settings";
import AiRunProgress from "./AiRunProgress";
import ModelPicker from "./ModelPicker";
import NumberInput from "./NumberInput";
import PromptButton from "./PromptButton";
import { useWorkQueue } from "./WorkQueue";

/** A chapter's own choices that nobody has written: counted down the tree when `below`. */
const openIn = (node: PlanNode, below: boolean): number =>
  node.choices.filter((c) => !c.child).length + (below ? node.choices.reduce((n, c) => n + (c.child ? openIn(c.child, true) : 0), 0) : 0);

/** Asking before a run this big (D7). */
const CONFIRM_OVER = 20;

type Props = {
  chapter: { id: string; title: string };
  storyId: string;
  tree: PlanNode;
  context: StoryContext;
  /** The run being shown (`?run=`). */
  runId: string | null;
  /** A run from this chapter that has not finished. */
  unfinished: { id: string; done: number; total: number; status: string } | null;
};

export default function WriteAhead({ chapter, storyId, tree, context, runId, unfinished }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const { startRun } = useWorkQueue();
  const [what, setWhat] = useState<"fill" | "tree" | "arc">("fill");
  // Reach a goal: what should happen, in how many chapters, where to start, and the plan the author edits.
  const [objective, setObjective] = useState("");
  const [arcCount, setArcCount] = useState(3);
  const [alternatives, setAlternatives] = useState(0);
  const [startChoiceId, setStartChoiceId] = useState("new");
  const [steps, setSteps] = useState<ArcStep[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [maxDepth, setMaxDepth] = useState(3);
  const [breadth, setBreadth] = useState(3);
  const [scope, setScope] = useState<"children" | "below">("children");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [writeModel, setWriteModel] = useState<ModelRef | null>(null);
  const [suggestModel, setSuggestModel] = useState<ModelRef | null>(null);
  const [guidance, setGuidance] = useState("");
  const [endChoices, setEndChoices] = useState(DEFAULT_END_CHOICES);
  const [models, setModels] = useState<"group" | "writing" | "each">("group");
  const [reviewPlan, setReviewPlan] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: RunOptions = useMemo(
    () => ({
      length,
      model: usableRef(settings, writeModel),
      suggestModel: usableRef(settings, suggestModel),
      guidance: guidance.trim() || undefined,
      endChoices,
      reviewPlan,
      models,
      ...(what === "tree" ? { maxDepth, breadth } : what === "arc" ? { objective: objective.trim(), chapters: arcCount, alternatives } : { scope }),
    }),
    [settings, length, writeModel, suggestModel, guidance, endChoices, reviewPlan, models, scope, what, maxDepth, breadth, objective, arcCount, alternatives],
  );
  const openHere = openIn(tree, false);
  const openBelow = openIn(tree, true);
  const openChoices = tree.choices.filter((c) => !c.child);
  const startChoice = openChoices.find((c) => c.id === startChoiceId);
  const estimate = useMemo(
    () => (what === "tree" ? estimateTree(tree, options) : what === "arc" ? estimateArc(steps ?? Array.from({ length: arcCount }, () => ({ choice: "", direction: "" }))) : estimateFill(tree, options)),
    [what, tree, options, steps, arcCount],
  );
  // Nothing to write: no open choices (Fill), the tree already has everything to that depth and breadth (Grow the tree), or no plan yet (Reach a goal).
  const none = what === "tree" ? estimate.chapters === 0 : what === "arc" ? !steps || steps.length === 0 : (scope === "children" ? openHere : openBelow) === 0;
  const tooMany = estimate.chapters > LIMITS.runChapters;

  /** The prompt of the first chapter the run would write, for View prompt. */
  const firstPrompt = () => {
    const walk = (n: PlanNode): PlanNode[] => [n, ...n.choices.flatMap((c) => (c.child ? walk(c.child) : []))];
    const first = walk(tree).find((n) => n.choices.some((c) => !c.child));
    if (!first || (what === "fill" && scope === "children" && first.id !== tree.id)) {
      throw new Error(what === "tree" ? "The first choices are made by the plan before any chapter is written, so there is no chapter prompt yet." : "There is no open choice to write.");
    }
    const label = first.choices.find((c) => !c.child)!.label;
    // Only the start chapter's story-so-far is known here; a deeper chapter's prompt has more path.
    return {
      system: SYSTEM_CHAPTER,
      message: generatePrompt({ ...context, choiceLabel: label }, options.guidance ?? "", length, settings.contextTokens),
    };
  };

  /** The story so far for the plan, following the choice the author starts from when there is one. */
  const planContext: StoryContext = { ...context, choiceLabel: startChoice?.label ?? null, siblingChoices: startChoice ? [] : context.siblingChoices };
  const planRequest = () => ({
    system: SYSTEM_ARC_PLAN,
    message: arcPlanPrompt(planContext, objective.trim(), arcCount, settings.contextTokens),
  });

  /** Asks the writing model for the steps to the goal; the author edits them before anything is written. */
  async function planChapters() {
    setPlanning(true);
    setError(null);
    try {
      const request = planRequest();
      const reply = await completeChat(settings, { system: request.system, messages: [{ role: "user", content: request.message }], role: "main", model: usableRef(settings, writeModel) });
      const found = parseIdeas(reply, arcCount);
      if (found.length === 0) throw new Error("The model's plan could not be read. Try Plan again.");
      setSteps(found.map((i) => ({ choice: i.choice.slice(0, LIMITS.label), direction: i.direction })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const tasks =
        what === "tree" ? planTree(tree, options) : what === "arc" ? planArc(chapter.id, steps ?? [], { ...options, chapters: steps?.length }, startChoice && { id: startChoice.id, label: startChoice.label }) : planFill(tree, options);
      const res = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story_id: storyId, start_chapter_id: chapter.id, mode: what, options, tasks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't start the run (${res.status})`);
      router.replace(`/c/${chapter.id}/write-ahead?run=${data.id}`);
      await startRun(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function stopUnfinished(id: string) {
    setBusy(true);
    try {
      const token = `stop-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      const run = await claim(id, token);
      await finish(run, "stopped", token);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (runId) return <AiRunProgress runId={runId} chapterId={chapter.id} />;

  return (
    <>
      {unfinished && (
        <section className="write-ahead-unfinished" aria-label="Unfinished run">
          <p>
            A run from here is unfinished: {unfinished.done} of {unfinished.total} written.
          </p>
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                router.replace(`/c/${chapter.id}/write-ahead?run=${unfinished.id}`);
                void startRun(unfinished.id);
              }}
            >
              Resume
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void stopUnfinished(unfinished.id)}>
              Stop it
            </button>
          </div>
        </section>
      )}

      <form
        className="write-ahead-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (estimate.chapters > CONFIRM_OVER && !confirming) return setConfirming(true);
          void start();
        }}
      >
        <fieldset>
          <legend>What to write</legend>
          <label className="inline-label">
            <input type="radio" name="what" style={{ width: "auto" }} checked={what === "fill"} onChange={() => setWhat("fill")} />
            <span>Fill open choices</span>
          </label>
          {what === "fill" && (
            <div className="write-ahead-sub">
              <label className="inline-label">
                <input type="radio" name="scope" style={{ width: "auto" }} checked={scope === "children"} onChange={() => setScope("children")} />
                <span>This chapter&apos;s open choices ({openHere})</span>
              </label>
              <label className="inline-label">
                <input type="radio" name="scope" style={{ width: "auto" }} checked={scope === "below"} onChange={() => setScope("below")} />
                <span>Every open choice below this chapter ({openBelow})</span>
              </label>
            </div>
          )}
          <label className="inline-label">
            <input type="radio" name="what" style={{ width: "auto" }} checked={what === "tree"} onChange={() => setWhat("tree")} />
            <span>Grow the tree</span>
          </label>
          {what === "tree" && (
            <div className="write-ahead-sub">
              <label>
                Depth <small>(levels below this chapter, 1–8)</small>
                <input type="number" min={1} max={8} value={maxDepth} onChange={(e) => setMaxDepth(Math.max(1, Math.min(8, Math.round(Number(e.target.value) || 1))))} />
              </label>
              <label>
                Choices per chapter <small>(1–6)</small>
                <input type="number" min={1} max={6} value={breadth} onChange={(e) => setBreadth(Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))))} />
              </label>
              <p className="meta">Keeps the chapters and choices already there, and writes what is missing to that depth.</p>
            </div>
          )}
          <label className="inline-label">
            <input type="radio" name="what" style={{ width: "auto" }} checked={what === "arc"} onChange={() => setWhat("arc")} />
            <span>Reach a goal</span>
          </label>
          {what === "arc" && (
            <div className="write-ahead-sub">
              <label>
                Goal <small>(what should happen by the end of the chain)</small>
                <textarea rows={3} value={objective} maxLength={LIMITS.premise} onChange={(e) => { setObjective(e.target.value); setSteps(null); }} />
              </label>
              <label>
                Chapters <small>(1–20)</small>
                <NumberInput min={1} max={20} integer value={arcCount} onChange={(v) => { if (v !== null) { setArcCount(v); setSteps(null); } }} />
              </label>
              <label>
                Start with
                <select value={startChoiceId} onChange={(e) => { setStartChoiceId(e.target.value); setSteps(null); }}>
                  <option value="new">A new choice on this chapter</option>
                  {openChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      Its open choice “{c.label}”
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Other choices along the way <small>(0–3 more besides the next step; they stay unwritten)</small>
                <NumberInput min={0} max={3} integer value={alternatives} onChange={(v) => v !== null && setAlternatives(v)} />
              </label>
              <div className="row" style={{ alignItems: "center" }}>
                <button type="button" disabled={planning || !objective.trim()} onClick={() => void planChapters()}>
                  {planning ? "Planning…" : steps ? "Plan again" : "Plan the chapters"}
                </button>
                <PromptButton label="Plan the chapters" build={planRequest} disabled={!objective.trim()} note="Sent to the writing model." />
              </div>
              {steps && (
                <ol className="ai-run-tasks" aria-label="The plan">
                  {steps.map((s, i) => (
                    <li key={i} className="ai-run-task">
                      <label>
                        Choice text for chapter {i + 1}
                        <input value={s.choice} maxLength={LIMITS.label} onChange={(e) => setSteps((p) => p && p.map((x, j) => (j === i ? { ...x, choice: e.target.value } : x)))} />
                      </label>
                      <label>
                        What happens
                        <textarea rows={2} value={s.direction} onChange={(e) => setSteps((p) => p && p.map((x, j) => (j === i ? { ...x, direction: e.target.value } : x)))} />
                      </label>
                      <button type="button" className="picture-queue-text-button" aria-label={`Remove chapter ${i + 1}`} onClick={() => setSteps((p) => p && p.filter((_, j) => j !== i))}>
                        ✕ Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {steps && steps.length === 0 && <p className="meta">The plan has no chapters left. Plan again.</p>}
            </div>
          )}
          {none && what !== "arc" && (
            <p className="meta">
              {what === "tree"
                ? "There is nothing to write: the tree below this chapter already has that many choices and levels."
                : `There are no open choices ${scope === "children" ? "on this chapter" : "below this chapter"}: every choice already has its chapter.`}
            </p>
          )}
        </fieldset>

        <details className="write-ahead-settings">
          <summary>Settings for every chapter</summary>
          <label>
            Length
            <select value={length} onChange={(e) => setLength(e.target.value as typeof length)}>
              <option value="short">Short (about 300 words)</option>
              <option value="medium">Medium (about 600 words)</option>
              <option value="long">Long (about 1000 words)</option>
            </select>
          </label>
          <div className="row" style={{ alignItems: "center" }}>
            <ModelPicker label="Writing model" role="main" use="write" value={writeModel} onChange={setWriteModel} />
            <ModelPicker label="Model for choices and summaries" role="cheap" use="suggest" value={suggestModel} onChange={setSuggestModel} />
          </div>
          <label>
            Guidance for every chapter <small>([bracket notes] work as on the writing page)</small>
            <textarea rows={3} value={guidance} maxLength={LIMITS.premise} onChange={(e) => setGuidance(e.target.value)} />
          </label>
          <label>
            {what === "tree" ? "Choices on the last chapters" : what === "arc" ? "Choices on the last chapter" : "Choices on each new chapter"} <small>(0–6, so the story doesn&apos;t end there)</small>
            <input type="number" min={0} max={6} value={endChoices} onChange={(e) => setEndChoices(Math.max(0, Math.min(6, Math.round(Number(e.target.value) || 0))))} />
          </label>
          <fieldset>
            <legend>Models</legend>
            {(
              [
                ["group", "Group by model, fewer model loads"],
                ["writing", "Use the writing model for everything"],
                ["each", "One chapter at a time"],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className="inline-label">
                <input type="radio" name="models" style={{ width: "auto" }} checked={models === value} onChange={() => setModels(value)} />
                <span>{text}</span>
              </label>
            ))}
          </fieldset>
        </details>

        {what !== "arc" && (
          <label className="inline-label">
            <input type="checkbox" style={{ width: "auto" }} checked={reviewPlan} onChange={(e) => setReviewPlan(e.target.checked)} />
            <span>Let me check the plan first</span>
          </label>
        )}

        {!none && (
          <p className="meta" aria-live="polite">
            Writes {estimate.chapters} {estimate.chapters === 1 ? "chapter" : "chapters"}, about {estimate.requests} AI requests, one at a time.
          </p>
        )}
        {tooMany && <p className="error">That is more than {LIMITS.runChapters} chapters, the most one run can write. Choose fewer.</p>}
        {confirming && !tooMany && (
          <p className="error" role="alert">
            That is a lot: {estimate.chapters} chapters and about {estimate.requests} requests. Press Start again to go ahead.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ alignItems: "center" }}>
          <button type="submit" disabled={busy || none || tooMany}>
            {confirming ? `Yes, write ${estimate.chapters} chapters` : what === "arc" ? (steps ? `Write ${steps.length} ${steps.length === 1 ? "chapter" : "chapters"}` : "Write chapters") : "Start"}
          </button>
          {what !== "arc" && (
            <PromptButton label="First chapter" build={firstPrompt} disabled={none} note="The first chapter the run would write. Its direction comes from the plan made first, so it isn't in this prompt." />
          )}
          {what === "arc" && !steps && <span className="meta">Plan the chapters first, then edit the plan.</span>}
          {confirming && (
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </>
  );
}
