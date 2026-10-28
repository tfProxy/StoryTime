# The server's work queue: rules the code doesn't show locally

- **One worker, on `globalThis.__storytimeWorker`** (`workerState()` in `bus.ts`). Next.js loads modules more than once (the instrumentation bundle and the route bundles; `next dev` reloads), so never keep queue state in a module-level variable. Routes reach the worker through `getWorker()`, which starts it if instrumentation ran in another copy.
- **Items live in SQLite** (`work_items`, `items.ts`), so a restart loses nothing; memory holds only what can be rebuilt (sockets, AbortControllers, the scheduler's `holder`, text being streamed). Restart recovery is in `startLoop()`: a picture job sent to ComfyUI is found again by its tag, one not yet sent goes back in line, a run goes back in line, and a Generate fails with its text kept in the draft.
- **Server code must not import code from `src/components/`** (`import type` is fine) or touch browser APIs. Check with `grep -rn "components/" src/lib/worker src/lib/aiRuns`.
- **AI runs call the app's own API through `selfFetch`** (relative `/api/...` → `http://127.0.0.1:$PORT`), so `src/lib/aiRuns/` is shared with the browser unchanged. The worker claims runs with the token `worker:<instance id>`.
- **Scheduling is the pure `src/lib/workQueue/schedule.ts`**; `pump()` in `loop.ts` builds its input. Picture jobs are sent one after another, each once the one before is queued, so ComfyUI gets them in the queue's order.
- **Session jobs** (a Refine screen's, a picture run's `pictures:<run id>`) never reach a page's `listen`er and are never "ready" in the header.
- **Live updates are server-sent events** (`sse.ts`; `no-transform`, `X-Accel-Buffering: no`, a ping every 15 s). A proxy that buffers `text/event-stream` breaks them.
- **Keep user-facing messages word for word** when changing this code; tests and the browser match them.
- **Tests:** test-only routes (`/api/queue/test-*`) exist only when `STORYTIME_TEST=1`, which `tests/run.mjs` sets; it also empties the queue before each browser file. Files: `tests/api/queue*.test.mjs`, `tests/unit/worker-*.test.mts`, `tests/unit/work-queue-schedule.test.mts`, browser `work-queue`, `picture-queue*`, `write-ahead`, `missing-pictures`, `queue-page`.
- Not yet tried on the NAS: see "To try on the real machines" in `TODO.md`.
