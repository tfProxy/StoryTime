// What the work queue should do next. Pure and deterministic: no React, no clocks, so it is unit-testable.
// The provider (`src/components/WorkQueue.tsx`) builds the state, calls `nextActions` and does what it returns.

/** A picture job that has finished gathering clicks and can be sent to ComfyUI. */
export type ReadyPicture = {
  key: string;
  targetKey: string;
  drawPreset: string | null;
  readyAt: number;
  /** The owner moved the waiting jobs by hand (Move up/down, Do next): such jobs keep the order they were given, which beats grouping. */
  moved?: boolean;
};

export type ScheduleState = {
  /** Jobs ready to send. Moved jobs are in the order the owner gave; the others are ordered by `nextActions`. */
  ready: ReadyPicture[];
  /** Keys of jobs sent to ComfyUI and not finished yet. */
  inFlight: string[];
  /** Pause queue: nothing new is sent (what is running finishes). */
  paused?: boolean;
  /** The drawing preset of the last job sent, and whether to group by it (Settings › Queue). */
  lastPreset?: string | null;
  group?: boolean;
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

/**
 * The order the ready jobs will go in, which the queue page shows as Waiting: jobs the owner moved by hand first,
 * in the order given, then the rest as `orderHeldPictures` puts them. A job never ends up before an earlier job
 * of its own target.
 */
export function waitingOrder(ready: ReadyPicture[], lastPreset: string | null = null, group = false): ReadyPicture[] {
  const moved = ready.filter((r) => r.moved);
  return [...moved, ...orderHeldPictures(ready.filter((r) => !r.moved), lastPreset, group)];
}

/**
 * What the queue should do now: while paused, nothing; otherwise send every ready picture job at once, in the
 * order of `waitingOrder` (so, with nothing moved or grouped, the order they became ready).
 */
export function nextActions(state: ScheduleState): Action[] {
  if (state.paused) return [];
  return waitingOrder(state.ready, state.lastPreset ?? null, state.group ?? false).map((job) => ({ kind: "sendPicture", key: job.key }));
}

/**
 * The waiting jobs (as `waitingOrder` gives them) after the owner moves one, every job marked as moved so the
 * order is theirs from then on. "up"/"down" swap with the neighbour, unless that is a job of the same target
 * (a target's own jobs keep their order); "next" takes the job, with the earlier jobs of its own target, to the
 * front. Returns the same order when the move isn't possible. Pure: returns a new array.
 */
export function moveWaiting(order: ReadyPicture[], key: string, how: "up" | "down" | "next"): ReadyPicture[] {
  const at = order.findIndex((r) => r.key === key);
  const list = order.map((r) => ({ ...r }));
  if (at < 0) return list;
  const result = (l: ReadyPicture[]) => l.map((r) => ({ ...r, moved: true }));
  if (how === "next") {
    const front = list.filter((r, i) => i === at || (i < at && r.targetKey === list[at].targetKey));
    return result([...front, ...list.filter((r) => !front.includes(r))]);
  }
  const to = how === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= list.length || list[to].targetKey === list[at].targetKey) return list;
  [list[at], list[to]] = [list[to], list[at]];
  return result(list);
}
