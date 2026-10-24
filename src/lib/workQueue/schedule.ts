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

/** What the queue should do now. Today's rule: send every ready picture job at once, in the order it became ready. */
export function nextActions(state: ScheduleState): Action[] {
  return state.ready
    .map((job, i) => ({ job, i }))
    .sort((a, b) => a.job.readyAt - b.job.readyAt || a.i - b.i)
    .map(({ job }) => ({ kind: "sendPicture", key: job.key }));
}
