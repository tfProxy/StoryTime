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
  /** Writing work: ids of the items waiting for a step, in the order they go (a single Generate first, D16), and whether a step is running. */
  writing?: { waiting: string[]; active: boolean };
  /** Settings › Queue: "turns" = the AI and ComfyUI share one machine (D18); "together" = both go at once. */
  sharing?: "turns" | "together";
  switchMinutes?: number;
  /** 0 = no item limit. */
  switchItems?: number;
  /** The clock (ms since 1970), passed in so this stays pure. */
  now?: number;
  /** Who has the machine (when taking turns), since when, and how many items it has started since. */
  holder?: Holder;
};

/** The kind of work that has the machine, since when (ms), and how many items (writing steps, picture jobs) it started since then. */
export type Holder = { kind: "pictures" | "writing"; since: number; count: number } | null;

export type Action = { kind: "sendPicture"; key: string } | { kind: "startWriting"; id: string };

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
  return schedule(state).actions;
}

/** What to do now, and who has the machine afterwards (the provider keeps `holder` and passes it back next time). */
export type Plan = { actions: Action[]; holder: Holder };

/** Whether the holder's batch is used up: its time (`switchMinutes`) or its item limit (`switchItems`, 0 = none). */
export function batchUsedUp(holder: Holder, state: Pick<ScheduleState, "now" | "switchMinutes" | "switchItems">): boolean {
  if (!holder) return false;
  const minutes = state.switchMinutes ?? 10;
  const items = state.switchItems ?? 0;
  return (state.now ?? 0) - holder.since >= minutes * 60_000 || (items > 0 && holder.count >= items);
}

/**
 * The queue's decision. Writing among itself goes one step at a time (D16). Between writing and pictures,
 * with `sharing: "together"` both go at once; with "turns" (D18) the machine belongs to one kind at a time: pictures
 * while any job is in ComfyUI, writing while a step runs, and when the holder has waiting work and the other kind
 * does too, the holder keeps it until its batch is used up (D19), then finishes what is in flight and the other
 * kind takes over. With only one kind waiting it just goes on. While paused nothing starts.
 */
export function schedule(state: ScheduleState): Plan {
  const holder0 = state.holder ?? null;
  if (state.paused) return { actions: [], holder: holder0 };
  const pictures = waitingOrder(state.ready, state.lastPreset ?? null, state.group ?? false);
  const writing = state.writing ?? { waiting: [], active: false };
  const send = (job: ReadyPicture): Action => ({ kind: "sendPicture", key: job.key });

  if (state.sharing !== "turns" || !state.writing) {
    const actions: Action[] = pictures.map(send);
    if (!writing.active && writing.waiting.length > 0) actions.push({ kind: "startWriting", id: writing.waiting[0] });
    return { actions, holder: holder0 };
  }

  let holder: Holder = holder0 ? { ...holder0 } : null;
  const actions: Action[] = [];
  const picturesActive = state.inFlight.length > 0;
  const take = (kind: "pictures" | "writing") => {
    if (!holder || holder.kind !== kind) holder = { kind, since: state.now ?? 0, count: 0 };
  };
  const sendPictures = (hasWriting: boolean) => {
    for (const job of pictures) {
      // Used up and the other kind is waiting: the rest of the jobs wait their turn.
      if (hasWriting && batchUsedUp(holder, state)) break;
      actions.push(send(job));
      holder!.count += 1;
    }
  };

  if (writing.active) return { actions, holder }; // writing has the machine until its step ends
  if (picturesActive) {
    // A job found in ComfyUI on opening, or sent before: pictures hold the machine.
    take("pictures");
    sendPictures(writing.waiting.length > 0);
    return { actions, holder };
  }
  const hasPictures = pictures.length > 0;
  const hasWriting = writing.waiting.length > 0;
  if (!hasPictures && !hasWriting) return { actions, holder };

  const has = (k: "pictures" | "writing") => (k === "pictures" ? hasPictures : hasWriting);
  const current = holder0?.kind ?? null;
  let kind: "pictures" | "writing";
  if (!current) kind = hasPictures ? "pictures" : "writing";
  else {
    const other = current === "pictures" ? "writing" : "pictures";
    kind = has(current) && !(has(other) && batchUsedUp(holder0, state)) ? current : has(other) ? other : current;
  }
  take(kind);
  if (kind === "writing") {
    actions.push({ kind: "startWriting", id: writing.waiting[0] });
    holder!.count += 1;
  } else sendPictures(hasWriting);
  return { actions, holder };
}

/** The line at the top of the header list when taking turns and something waits: who has the machine, and for how long. Null when there is nothing to say. */
export function machineNote(state: { holder: Holder; sharing?: "turns" | "together"; switchMinutes?: number; switchItems?: number; waitingPictures: number; waitingWriting: number; timeText: (ms: number) => string }): string | null {
  if (state.sharing !== "turns" || !state.holder) return null;
  const { kind, since, count } = state.holder;
  const other = kind === "pictures" ? state.waitingWriting : state.waitingPictures;
  if (other === 0) return null;
  const items = state.switchItems ?? 0;
  const until = state.timeText(since + (state.switchMinutes ?? 10) * 60_000);
  const left = items > 0 ? Math.max(0, items - count) : 0;
  const limit = items > 0 ? `until ${until} or ${left} more ${kind === "writing" ? (left === 1 ? "step" : "steps") : left === 1 ? "picture job" : "picture jobs"}` : `until ${until}`;
  const next = kind === "writing" ? `${state.waitingPictures} ${state.waitingPictures === 1 ? "picture job" : "picture jobs"}` : `${state.waitingWriting} writing ${state.waitingWriting === 1 ? "item" : "items"}`;
  return `${kind === "writing" ? "Writing" : "Pictures"} ${limit}, then ${next}`;
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
