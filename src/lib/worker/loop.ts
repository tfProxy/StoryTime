// The worker's loop: reads the items, asks `schedule()` what to start (as `pump` in WorkQueue.tsx does) and starts it.
// So far only writing (Generate); pictures and runs join in later phases. `pump()` runs after every change to the
// items, when the queue is paused or resumed, and every 5 s.
import { getSettings } from "../settingsStore";
import { parseSettings } from "../settingsSchema";
import { schedule } from "../workQueue/schedule";
import { publish, QUEUE_CHANNEL, subscribe, workerState } from "./bus";
import { genItemKey, runGenerate } from "./generate";
import { listItems, updateItem, type WorkRow } from "./items";
import { getPaused } from "./paused";
import { recoverGathering } from "./pictures";
import { recoverRuns, runStep } from "./runs";

export const PUMP_MS = 5000;

let pumping = false;
let again = false;

/** A Generate that was going when the server stopped cannot go on: it fails, and says where its text is. */
export function recoverGenerates() {
  for (const item of listItems()) {
    if (item.type === "generate" && item.state === "working") {
      updateItem(item.key, { state: "failed", data: { error: "StoryTime restarted while writing; the text so far is in the draft." } });
    }
  }
}

/** Starts what the scheduler says should start now, and tells the watchers who has the machine. */
export function pump() {
  // Starting something changes items, which pumps again: that is run once more after this one, not inside it.
  if (pumping) {
    again = true;
    return;
  }
  pumping = true;
  try {
    do {
      again = false;
      pumpOnce();
    } while (again);
  } finally {
    pumping = false;
  }
}

function pumpOnce() {
  const worker = workerState();
  const queue = (getSettings() ?? parseSettings({})).queue;
  const paused = getPaused();
  const items = listItems();
  // Generates take their turns in the order they were asked; a Generate goes before the next steps of runs (D16).
  const waitingGenerates = items.filter((i): i is WorkRow<"generate"> => i.type === "generate" && i.state === "waiting" && i.key === genItemKey(i.data.draftKey));
  // Runs follow, the one that has waited longest first: a run goes back in line after each step, so they take turns.
  const waitingRuns = items.filter((i): i is WorkRow<"run"> => i.type === "run" && i.state === "waiting").sort((a, b) => a.updatedAt - b.updatedAt);
  const waiting = [...waitingGenerates, ...waitingRuns].map((i) => i.key);
  const active = worker.generates.size > 0 || worker.runs.size > 0;
  const plan = schedule({
    ready: [],
    inFlight: [],
    paused,
    group: queue.groupPictures,
    writing: { waiting, active },
    sharing: queue.sharing,
    switchMinutes: queue.switchMinutes,
    switchItems: queue.switchItems,
    now: Date.now(),
    holder: worker.holder,
  });
  worker.holder = plan.holder;
  for (const action of plan.actions) {
    if (action.kind !== "startWriting") continue;
    // The runners handle their own failures; the catch only keeps one that escapes from stopping the server.
    const draftKey = waitingGenerates.find((i) => i.key === action.id)?.data.draftKey;
    if (draftKey !== undefined) void runGenerate(draftKey).catch(() => {}).finally(pump);
    const runId = waitingRuns.find((i) => i.key === action.id)?.data.runId;
    if (runId !== undefined) void runStep(runId).catch(() => {}).finally(pump);
  }
  // A waiting Generate or run says why.
  const note = worker.generates.size > 0 || worker.runs.size > 0 ? "Waiting for the step in progress" : undefined;
  for (const item of [...waitingGenerates, ...waitingRuns]) {
    if (item.data.note !== note) updateItem(item.key, { data: { note } });
  }
  publish(QUEUE_CHANNEL, {
    type: "machine",
    machine: { holder: worker.holder, waitingPictures: 0, waitingWriting: waiting.length },
    waiting,
    paused,
  });
}

/** Pumps on every change to the items, and every 5 s. */
export function startLoop() {
  const worker = workerState();
  recoverGenerates();
  recoverRuns();
  recoverGathering();
  subscribe(QUEUE_CHANNEL, (event) => {
    if ((event as { type?: string }).type !== "machine") pump();
  });
  worker.timers.push(setInterval(pump, PUMP_MS).unref());
  pump();
}
