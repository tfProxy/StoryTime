// What the work queue should do next. Pure and deterministic: no React, no clocks, so it is unit-testable.
// The provider (`src/components/WorkQueue.tsx`) builds the state, calls `nextActions` and does what it returns.

/** A picture job that has finished gathering clicks and can be sent to ComfyUI. */
export type ReadyPicture = { key: string; targetKey: string; drawPreset: string | null; readyAt: number };

export type ScheduleState = {
  /** Jobs ready to send, in the order they became ready. */
  ready: ReadyPicture[];
  /** Keys of jobs sent to ComfyUI and not finished yet. */
  inFlight: string[];
};

export type Action = { kind: "sendPicture"; key: string };

/**
 * The order to send picture jobs that are held back in StoryTime (D21). With `group` on, jobs for the drawing
 * preset of the last job sent go first, so ComfyUI swaps checkpoints less; otherwise, and within each group,
 * the order they became ready. A target's (chapter's) own jobs always keep their order: a job never goes
 * before an earlier job of the same target, even if its preset matches. Pure: returns a new array.
 */
export function orderHeldPictures(held: ReadyPicture[], lastPreset: string | null, group: boolean): ReadyPicture[] {
  const byReady = held
    .map((job, i) => ({ job, i }))
    .sort((a, b) => a.job.readyAt - b.job.readyAt || a.i - b.i)
    .map(({ job }) => job);
  if (!group || lastPreset === null) return byReady;

  const rest = [...byReady];
  const out: ReadyPicture[] = [];
  while (rest.length > 0) {
    // The first job whose preset matches and that has no earlier job of its own target waiting.
    const at = rest.findIndex((job, i) => job.drawPreset === lastPreset && !rest.slice(0, i).some((r) => r.targetKey === job.targetKey));
    if (at >= 0) {
      out.push(...rest.splice(at, 1));
      continue;
    }
    // None matches: the next in order goes, and its preset becomes the one to group by.
    const [next] = rest.splice(0, 1);
    out.push(next);
    lastPreset = next.drawPreset;
  }
  return out;
}

/** What the queue should do now. Today's rule: send every ready picture job at once, in the order it became ready. */
export function nextActions(state: ScheduleState): Action[] {
  return state.ready
    .map((job, i) => ({ job, i }))
    .sort((a, b) => a.job.readyAt - b.job.readyAt || a.i - b.i)
    .map(({ job }) => ({ kind: "sendPicture", key: job.key }));
}
