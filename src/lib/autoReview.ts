// "Check new and edited chapters automatically" (Settings > Tags): after a chapter is saved, queue a review run for it
// on the server (tags, facts, continuity and the summary check). It never fails the save that triggers it.
import { createRun, getRun, listUnfinishedRuns, reviewTasks } from "./aiRuns";
import { getWorker } from "./worker";
import { endRun, queueRun } from "./worker/runs";
import { parseSettings } from "./settingsSchema";
import { getSettings } from "./settingsStore";
import { getChapter } from "./stories";

export const AUTO_REVIEW_CHECKS = ["tags", "facts", "continuity", "summaries"] as const;

const sameChecks = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && b.every((c) => a.includes(c));

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
  if (!(getSettings() ?? parseSettings({})).autoReview) return;
  const chapter = getChapter(chapterId);
  if (!chapter) return;
  // While the AI run that wrote the chapter is still going, it is checked after the run (E2), not here. Once the run
  // has ended, an edit by hand is checked like any other.
  if (chapter.ai_run_id !== null && runGoing(chapter.ai_run_id)) return;
  // Nothing to check (all done at this revision): no run.
  if (reviewTasks(chapter.story_id, chapterId, "chapter", [...AUTO_REVIEW_CHECKS]).length === 0) return;
  getWorker();
  // Its tasks were made for the old revision, so an unfinished run for this chapter is ended and made again.
  for (const r of listUnfinishedRuns()) {
    if (r.mode === "review" && r.start_chapter_id === chapterId && r.options.tagScope === "chapter" && sameChecks(r.options.checks, AUTO_REVIEW_CHECKS)) {
      await endRun(r.id).catch((e) => console.error("auto review: could not end the earlier run", e));
    }
  }
  const { id } = createRun({ story_id: chapter.story_id, start_chapter_id: chapterId, mode: "review", options: { tagScope: "chapter", checks: [...AUTO_REVIEW_CHECKS] } });
  await queueRun(id);
}

/** Queues the automatic review of a saved chapter, if the setting is on. Does not wait for the work and never throws. */
export function queueAutoReview(chapterId: string): Promise<void> {
  const next = chain.then(() => review(chapterId)).catch((e) => console.error("auto review failed", e));
  chain = next;
  return next;
}
