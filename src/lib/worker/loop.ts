// The worker's loop: reads the items, asks `schedule()` what to start (as `pump` in WorkQueue.tsx does) and starts it.
// Writing (Generates and runs) and pictures; `pump()` runs after every change to the
// items, when the queue is paused or resumed, and every 5 s.
import { getSettings } from "../settingsStore";
import { parseSettings } from "../settingsSchema";
import { schedule, waitingOrder } from "../workQueue/schedule";
import { publish, QUEUE_CHANNEL, subscribe, workerState } from "./bus";
import { genItemKey, runGenerate } from "./generate";
import { listItems, updateItem, type WorkRow } from "./items";
import { getPaused } from "./paused";
import { readyPictures, recoverGathering, recoverPictures, scanComfy, sendPicture } from "./pictures";
import { recoverRuns, runStep, watchPictureRuns } from "./runs";

export const PUMP_MS = 5000;
export const SCAN_MS = 60_000;

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
  // (Kept in the worker state, not here: every copy of this module Next loads has to see the same flags.)
  const state = workerState().pump;
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.again = false;
      pumpOnce();
    } while (state.again);
  } finally {
    state.running = false;
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
  const ready = readyPictures(items);
  const inFlight = items.filter((i) => i.type === "picture" && i.state === "working").map((i) => i.key);
  const plan = schedule({
    ready,
    inFlight,
    lastPreset: worker.lastPreset,
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
    if (action.kind === "sendPicture") {
      sendPicture(action.key);
      continue;
    }
    // The runners handle their own failures; the catch only keeps one that escapes from stopping the server.
    const draftKey = waitingGenerates.find((i) => i.key === action.id)?.data.draftKey;
    if (draftKey !== undefined) void runGenerate(draftKey).catch(() => {}).finally(pump);
    const runId = waitingRuns.find((i) => i.key === action.id)?.data.runId;
    if (runId !== undefined) void runStep(runId).catch(() => {}).finally(pump);
  }
  // A waiting Generate or run says why: the step going now, or pictures in ComfyUI while taking turns.
  const pictures = inFlight.length;
  const note = queue.sharing === "turns" && pictures > 0 ? `Waiting for pictures to finish (${pictures} left)` : active ? "Waiting for the step in progress" : undefined;
  for (const item of [...waitingGenerates, ...waitingRuns]) {
    if (item.data.note !== note) updateItem(item.key, { data: { note } });
  }
  // Pictures held back while taking turns say so on their place.
  if (queue.sharing === "turns" && !paused) {
    for (const item of items) {
      if (item.type === "picture" && item.state === "waiting" && (item.data.progress as { stage?: string } | undefined)?.stage === "gathering") {
        updateItem(item.key, { data: { progress: { stage: "held" } } });
      }
    }
  }
  const order = waitingOrder(ready, worker.lastPreset, queue.groupPictures).map((r) => r.key);
  publish(QUEUE_CHANNEL, {
    type: "machine",
    machine: { holder: worker.holder, waitingPictures: ready.length, waitingWriting: waiting.length },
    waiting: order,
    paused,
  });
}

/** Pumps on every change to the items, and every 5 s. */
export function startLoop() {
  const worker = workerState();
  recoverGenerates();
  recoverRuns();
  recoverGathering();
  void recoverPictures().catch(() => {});
  subscribe(QUEUE_CHANNEL, (event) => {
    if ((event as { type?: string }).type !== "machine") pump();
  });
  watchPictureRuns();
  worker.timers.push(setInterval(pump, PUMP_MS).unref());
  // ComfyUI is asked for jobs nothing here is watching, once a minute and on start (once the browser has moved over).
  const scan = () => {
    if (worker.scan.enabled) void scanComfy();
  };
  worker.timers.push(setInterval(scan, SCAN_MS).unref());
  scan();
  pump();
}
