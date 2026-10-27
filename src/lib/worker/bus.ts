// The worker's event bus, and the worker's state, held on `globalThis` (D2): Next may load this module more than once
// (the instrumentation bundle and each route bundle are separate, and `next dev` reloads modules), and every copy has to
// reach the same bus. Never keep queue state in a plain module-level variable.
import type { UploadCache } from "../comfy/makeJob";
import type { Holder } from "../workQueue/schedule";

export type Listener = (event: unknown) => void;

export type Bus = {
  publish: (channel: string, event: unknown) => void;
  /** Calls `fn` with each event published on the channel from now on; returns the way to stop. */
  subscribe: (channel: string, fn: Listener) => () => void;
};

export function createBus(): Bus {
  const channels = new Map<string, Set<Listener>>();
  return {
    publish(channel, event) {
      // A copy, so a listener that stops listening while it is called doesn't skip the next one.
      for (const fn of [...(channels.get(channel) ?? [])]) {
        try {
          fn(event);
        } catch {
          // a listener that fails (a closed connection) must not hold up the others, or the code that published
        }
      }
    },
    subscribe(channel, fn) {
      let set = channels.get(channel);
      if (!set) channels.set(channel, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
        if (set.size === 0 && channels.get(channel) === set) channels.delete(channel);
      };
    },
  };
}

export type WorkerState = {
  bus: Bus;
  /** `startWorker` has run. */
  started: boolean;
  /** Intervals the worker keeps, so they can be stopped. */
  timers: ReturnType<typeof setInterval>[];
  /** The Generates going now, by draft key: the text so far, and how to stop it. */
  generates: Map<string, { text: string; ctl: AbortController }>;
  /** The loop's pump is going, and was asked again meanwhile (see `pump` in loop.ts). */
  pump: { running: boolean; again: boolean };
  /** The picture job quick clicks can still join: its key, what it must match, how many pictures it has, and the timer that closes it. */
  gathering: { key: string; targetKey: string; signature: string; count: number; timer: ReturnType<typeof setTimeout> } | null;
  /** The picture jobs sent to ComfyUI and not ended: how to stop each, ComfyUI's id for it once known, and ComfyUI's address. */
  pictures: Map<string, { ctl: AbortController; promptId: string | null; url: string }>;
  /** Jobs are sent one after another, each once the one before is queued on ComfyUI, so ComfyUI gets them in the order chosen. */
  sendChain: Promise<void>;
  /** The starting picture last uploaded to ComfyUI, so the next job from it doesn't send it again. */
  uploads: UploadCache;
  /** The drawing preset of the last job sent, for grouping jobs by it. */
  lastPreset: string | null;
  /** The run steps going now, by run id: how to stop it, and a promise that settles when the step has ended. */
  runs: Map<string, { ctl: AbortController; done: Promise<void> }>;
  /** Who has the machine when pictures and writing take turns (`schedule()` passes it back each time). */
  holder: Holder;
};

declare global {
  var __storytimeWorker: WorkerState | undefined;
}

/** The one worker state of this process, made on first use. */
export function workerState(): WorkerState {
  return (globalThis.__storytimeWorker ??= { bus: createBus(), started: false, timers: [], generates: new Map(), runs: new Map(), pump: { running: false, again: false }, gathering: null, pictures: new Map(), sendChain: Promise.resolve(), uploads: { current: null }, lastPreset: null, holder: null });
}

export const publish = (channel: string, event: unknown) => workerState().bus.publish(channel, event);
export const subscribe = (channel: string, fn: Listener) => workerState().bus.subscribe(channel, fn);

/** The channel every change to the queue's items is published on. */
export const QUEUE_CHANNEL = "queue";
