// The work queue's worker, which runs inside the Next.js process (D1). `src/instrumentation.ts` starts it once when the
// server starts; routes call `getWorker()`, which starts it if this module copy was not the one instrumentation used (D2).
import { workerState, type WorkerState } from "./bus";
import { deleteOldUploads } from "./uploads";

const HOUR_MS = 60 * 60 * 1000;

/** Starts the worker if it is not running. Safe to call again. */
export function startWorker(): WorkerState {
  const worker = workerState();
  if (worker.started) return worker;
  worker.started = true;
  // Restart recovery (D12) comes with the work it recovers: pictures in 4.4, runs in 3.1, Generate in 2.2.
  deleteOldUploads();
  worker.timers.push(setInterval(deleteOldUploads, HOUR_MS).unref());
  return worker;
}

export function getWorker(): WorkerState {
  return startWorker();
}
