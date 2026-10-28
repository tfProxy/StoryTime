// "Check new and edited chapters automatically" (Settings > Tags): after a chapter is saved, queue a review run for it
// on the server (tags, facts, continuity and the summary check, with "Check new and edited chapters automatically",
// and the codex check, with autoCodex). It never fails the save that triggers it.
import { createRun, getRun, listUnfinishedRuns, reviewTasks } from "./aiRuns";
import { LIMITS } from "./limits";
import { getWorker } from "./worker";
import { endRun, queueRun } from "./worker/runs";
import { parseSettings } from "./settingsSchema";
import { getSettings } from "./settingsStore";
import { getChapter } from "./stories";

export const AUTO_REVIEW_CHECKS = ["tags", "facts", "continuity", "summaries"] as const;

/** The checks an automatic review makes, from the settings: the review's four, and the codex check. */
function autoChecks(): ("tags" | "facts" | "continuity" | "summaries" | "codex")[] {
  const s = getSettings() ?? parseSettings({});
  return [...(s.autoReview ? AUTO_REVIEW_CHECKS : []), ...(s.autoCodex ? (["codex"] as const) : [])];
}

const sameChecks =(a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && b.every((c) => a.includes(c));

const runGoing = (runId: string) => {
  try {
    const status = getRun(runId).status;
    return status !== "done" && status !== "stopped";
  } catch {
    return false; // the run is gone
  }
};

// One at a time, so two quick saves of a chapter do not both end and make a run.
let chain: Promise<void> = Promise.resolve();

async function review(chapterId: string) {
  const checks = autoChecks();
  if (checks.length === 0) return;
  const chapter = getChapter(chapterId);
  if (!chapter) return;
  // While the AI run that wrote the chapter is still going, it is checked after the run (E2), not here. Once the run
  // has ended, an edit by hand is checked like any other.
  if (chapter.ai_run_id !== null && runGoing(chapter.ai_run_id)) return;
  // Nothing to check (all done at this revision): no run.
  if (reviewTasks(chapter.story_id, chapterId, "chapter", checks).length === 0) return;
  getWorker();
  // Its tasks were made for the old revision, so an unfinished run for this chapter is ended and made again.
  for (const r of listUnfinishedRuns()) {
    if (r.mode === "review" && r.options.automatic && r.start_chapter_id === chapterId && r.options.tagScope === "chapter" && sameChecks(r.options.checks, checks)) {
      await endRun(r.id).catch((e) => console.error("auto review: could not end the earlier run", e));
    }
  }
  const { id } = createRun({ story_id: chapter.story_id, start_chapter_id: chapterId, mode: "review", options: { tagScope: "chapter", checks, automatic: true } });
  await queueRun(id);
}

// Runs whose chapters have been handed to a review already, so a run that ends is checked once.
const handledRuns = new Set<string>();

const sameIds = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && b.every((id) => a.includes(id));

async function reviewRun(runId: string) {
  if (handledRuns.has(runId)) return;
  const checks = autoChecks();
  if (checks.length === 0) return;
  const run = getRun(runId);
  if (run.mode !== "fill" && run.mode !== "tree" && run.mode !== "arc") return;
  if (run.status !== "done" && run.status !== "stopped") return;
  handledRuns.add(runId);
  const chapterIds = [...new Set(run.tasks.flatMap((t) => (t.kind === "write" && t.chapterId && (t.status === "done" || t.status === "written") ? [t.chapterId] : [])))].slice(0, LIMITS.runTasks);
  if (chapterIds.length === 0) return;
  const options = { tagScope: "chapters" as const, chapterIds, checks, automatic: true };
  // The same chapters are already waiting for a review: no second run.
  if (listUnfinishedRuns().some((r) => r.mode === "review" && r.story_id === run.story_id && r.options.tagScope === "chapters" && sameIds(r.options.chapterIds, chapterIds))) return;
  // Nothing to check (all done at these revisions): no run.
  if (reviewTasks(run.story_id, null, "chapters", options.checks, chapterIds).length === 0) return;
  getWorker();
  const { id } = createRun({ story_id: run.story_id, start_chapter_id: null, mode: "review", options });
  await queueRun(id);
}

/** Queues one automatic review for the chapters a fill, grow-the-tree or reach-a-goal run wrote, once it has ended. Does not wait for the work and never throws. */
export function queueAutoReviewForRun(runId: string): Promise<void> {
  const next = chain.then(() => reviewRun(runId)).catch((e) => console.error("auto review of a run failed", e));
  chain = next;
  return next;
}

/** Queues the automatic review of a saved chapter, if the setting is on. Does not wait for the work and never throws. */
export function queueAutoReview(chapterId: string): Promise<void> {
  const next = chain.then(() => review(chapterId)).catch((e) => console.error("auto review failed", e));
  chain = next;
  return next;
}
