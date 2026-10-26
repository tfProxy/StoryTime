# Plan: run the work queue on the server

Written 2026-10-25 for agents picking up this work. Read this whole file before starting a task, then only the code each task names. `CLAUDE.md` and `AGENTS.md` rules apply throughout (Edit/Write tools only, verification by size of change, one logical change per commit, "ship it" process).

## Goal

Today the work queue runs in the browser tab (`src/components/WorkQueue.tsx`, about 1,500 lines, mounted in the root layout). The tab sends picture jobs to ComfyUI, streams AI text from the providers, and steps AI runs (write ahead, fill missing pictures). When the tab closes or the phone sleeps, work stops.

After this plan, the StoryTime server (the Next.js process, one container on the NAS) does all of that. The browser only:

- asks for work (HTTP POST),
- shows the queue and progress (server-sent events),
- does what needs a canvas (resizing an uploaded file, Refine's flattened picture, rendering a painted mask) and uploads the result to the server.

The `useWorkQueue()` / `usePictureQueue()` hook API stays the same, so pages (`ComfyGenerate`, `ChapterEditor`, `RefinePromptPanel`, `WriteAhead`, `AiRunProgress`, `MissingPictures`, `QueuePage`, `WorkQueueStatus`) change little or not at all.

Out of scope (separate later work, listed at the end): the one-off AI calls made outside the queue (codex scan, tag suggestions, summaries, the Write prompt button), and loading ComfyUI pictures into the Refine canvas.

## How it works today (what to read, and where)

| Piece | File | Notes |
|---|---|---|
| Queue provider | `src/components/WorkQueue.tsx` | Items `PictureItem \| RunItem \| GenerateItem`. Key functions: `ask` (gathers quick clicks into one job, `GATHER_MS` 800, `MAX_BATCH` 8), `pump` (calls `schedule()`), `send` (calls `queueJob`), `finish` (calls `waitForPictures`, then `recordPictures`), `runStep` (one `runNextStep`), `runGenerate`, `saveGenerated`, `scan` (finds StoryTime jobs in ComfyUI), `pictureTick` / `askPicture` / `pictureMade` / `flushPictures` (Make missing pictures). |
| Scheduling (pure) | `src/lib/workQueue/schedule.ts` | `schedule()`, `waitingOrder`, `moveWaiting`, `machineNote`. Already free of React and clocks: reuse it unchanged on the server. Tests: `tests/unit/work-queue-schedule.test.mts`. |
| Picture job | `src/lib/comfy/makeJob.ts` | `JobInput` (has closures: `start.blob()`, `refs[].blob()`, `mask` is a `PaintedArea` rendered with a canvas), `sameJob`, `queueJob`. |
| ComfyUI HTTP/WebSocket | `src/lib/comfy/client.ts` | `queuePrompt`, `waitForPictures` (WebSocket, falls back to polling `/history`), `uploadImage`, `cancelPrompt`, `listTaggedJobs`, `fetchImage`. |
| Starting pictures | `src/lib/comfy/startPicture.ts` | `StartPicture`, `fromComfyImage`, `fromSaved`, `fromCodex`, `uploadStart` (uses `createImageBitmap`: browser only). |
| References | `src/lib/comfy/references.ts`, `src/components/References.tsx` | A file the author picks becomes `source: "upload:<name>"` with an in-memory blob. |
| AI client | `src/lib/ai/client.ts` | `streamChat`, `completeChat`. Plain `fetch`, so it works in Node. Its top comment ("API keys never touch the StoryTime server") is out of date: keys are already in the server's `settings` table. |
| Ollama memory | `src/lib/ai/ollama.ts` | `freeOllamaForPictures`, `freeOllamaMemory`. Plain `fetch`. |
| AI runs (server data) | `src/lib/aiRuns.ts`, `/api/ai-runs/...` | Runs and tasks are in the `ai_runs` table (migration 31) with a lease (`claimRun`, `LEASE_MS`). |
| AI runs (stepping) | `src/lib/aiRuns/runner.ts`, `writeChapter.ts`, `pictures.ts`, `api.ts` | `runNextStep(run, env)`. All data access goes through `api.ts` helpers that take a `fetch` and call **relative** URLs (`/api/chapters/...`). `pictures.ts` imports from `src/components/useEditModels` (must move to `src/lib`). |
| Drafts | `src/lib/drafts.ts` (browser fetch helpers), `src/lib/draftStore.ts` (server, SQLite), `src/lib/generatedDraft.ts` (pure) | `saveGenerated` in `WorkQueue.tsx` uses `getDraft`/`saveDraft` with `updatedAt` conflict checks. |
| Job log | `src/lib/pictureJobs.ts` | `recordPictureJob`, `knownPromptIds`, `markPictureJobsSeen`, unique index on `(chapter_id, prompt_id)`. |
| Settings | `src/lib/settingsStore.ts` (`getSettings()` on the server), `src/lib/settingsSchema.ts` | `settings.queue` (sharing, switchMinutes, switchItems, groupPictures), `settings.comfy`, connections. |
| Instance id | `src/lib/instance.ts` | Tags ComfyUI jobs as this StoryTime's. |
| Docs | `docs/illustrate.md` (the long "picture queue" bullet), `AGENTS.md` | Must be updated when behaviour changes. |
| Tests | `tests/e2e/fakeComfy.mjs`, `tests/e2e/browser.mjs` (`useMockAi`, port 3222), `tests/run.mjs` (starts `next start -p 3111`) | The fakes run on `localhost` on the same machine as the server, so the server can reach them too. |

Facts checked while writing this plan:

- Node in the container and sandbox is 22.x: global `fetch`, `WebSocket`, `Blob`, `FormData` and `AbortSignal.timeout` all exist.
- `next start -p <port>` sets `process.env.PORT` (`node_modules/next/dist/server/lib/start-server.js`), and the Docker image sets `PORT=3737`.
- Next.js 16 supports `src/instrumentation.ts` with `export async function register()`, called once per server start. Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md` before writing it.

## Decisions (the owner can override any; change this file if so)

- **D1. The worker runs inside the Next.js process.** It is started from `src/instrumentation.ts` (`if (process.env.NEXT_RUNTIME === "nodejs") { const { startWorker } = await import("./lib/worker"); startWorker(); }`). No second process, no Dockerfile change.
- **D2. One worker, held on `globalThis`.** Next may load a module more than once (the instrumentation bundle and route bundles are separate; `next dev` reloads modules). Keep the worker and its event bus on `globalThis.__storytimeWorker`, created once: route handlers and the worker must reach the same object through a `getWorker()` accessor. Never keep queue state in a plain module-level variable.
- **D3. Queue items live in SQLite** (new table `work_items`, migration 32), so a restart loses nothing. In-memory state is only what can be rebuilt: open WebSockets, AbortControllers, the scheduler's `holder`, text being streamed.
- **D4. The worker reuses the runner's HTTP helpers through a "self fetch"**: a `Fetch` that turns a relative `/api/...` URL into `http://127.0.0.1:${process.env.PORT ?? 3737}/api/...`. This keeps `runner.ts`, `writeChapter.ts`, `pictures.ts` and `api.ts` unchanged apart from the fetch passed in. Do not rewrite them to call SQLite directly (possible later; not needed).
- **D5. Live updates use server-sent events** (`text/event-stream` from a route handler, `EventSource` in the browser). One helper, `sseResponse(request, subscribe)` in `src/lib/worker/sse.ts`, used by every stream. Send `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, and a comment line (`: ping`) every 15 s. Remove the subscriber on `request.signal` abort.
- **D6. Pictures are described by source, not by blob.** A server-side job spec (`JobSpec`) carries each picture as a `source` string. The server fetches the bytes itself: `comfy:<subfolder/file>` from ComfyUI `/view`; `saved:<owner>:<slot>` and `codex:<picture id>` through self fetch of the URLs `savedPictureUrl` / `codexPictureUrl` already build. Pictures only the browser has (a picked file, Refine's flattened picture, a rendered mask) are first sent to `POST /api/queue/uploads` and referenced as `upload:<id>`.
- **D7. Image size on the server** comes from a small header reader (`src/lib/imageSize.ts`: PNG IHDR, JPEG SOF0/1/2, WebP VP8/VP8L/VP8X). No new npm dependency.
- **D8. Leases.** The worker claims runs with one token, `worker:<instance id>`. Browser-side claims go away: Retry, Skip, Stop and Resume become server routes that the worker carries out. The `elsewhere` run state is removed (every tab sees the same queue).
- **D9. Unseen.** The server records every finished job as unseen (except temporary and session jobs, as now). The browser marks jobs seen when it hands pictures to an open page or the author dismisses them (`markJobsSeen` already does this). The server no longer needs to know which pages are open.
- **D10. Pause lives on the server** (`settings` table key `queue_paused`, `GET`/`PUT /api/queue/paused`), so it is the same on every device. The `localStorage["storytime-queue-paused"]` key is read once on first load and, if set, sent to the server, then removed.
- **D11. Generate text.** While a Generate runs, the server saves the draft itself every 3 s and at the end (the logic of `saveGenerated`, with `draftStore.putDraft` and its `updatedAt` check) **whether or not a page is open**. A writing page open on the draft gets the text over SSE and shows it, but does not autosave the draft while its Generate is `working`, then reloads the draft when it ends. This removes the "page saves vs queue saves" split.
- **D12. Restart recovery** (worker start): a picture item that was `working` with a `prompt_id` is waited on again (`waitForPictures` polls `/history`); one without a `prompt_id` goes back to `waiting`. A run item that was `working` goes back to `waiting`. A Generate that was `working` is `failed` with "StoryTime restarted while writing; the text so far is in the draft."
- **D13. Safety limits.** A run pauses when a task fails twice (existing behaviour in `runner.ts`, keep it); a picture run's job is asked again once, then the run fails. A Generate is capped by the existing token limits. Pause stops everything new. Add no further limits unless the owner asks.
- **D14. Cut-over without a flag.** Phases 0 to 4 add server code that does nothing until something creates `work_items` rows (only new `/api/queue/...` routes do), so each phase can ship to `main` on its own with no visible change. Phase 5 switches the browser over in one step. Before it lands, the full browser suite must pass. Do not keep both queues working side by side: no setting to choose between them.
- **D15. Thumbnails stay in the browser.** `<img src={imageUrl(...)}>` from ComfyUI's `/view` needs no CORS and stays as is. So the browser still needs to reach ComfyUI to show pictures, but no longer to make them.

## The new pieces (names to use)

```
src/instrumentation.ts                 starts the worker (D1)
src/lib/worker/index.ts                startWorker(), getWorker() on globalThis (D2)
src/lib/worker/bus.ts                  tiny event bus: publish(channel, event), subscribe(channel, fn) -> unsubscribe
src/lib/worker/sse.ts                  sseResponse(request, subscribe) (D5)
src/lib/worker/selfFetch.ts            selfFetch: Fetch (D4)
src/lib/worker/items.ts                SQLite access for work_items (create, list, update, delete), zod schemas
src/lib/worker/loop.ts                 the pump: builds ScheduleState from items, calls schedule(), starts actions
src/lib/worker/pictures.ts             gather, send, wait, record, stop, scan ComfyUI
src/lib/worker/generate.ts             one Generate (port of runGenerate + saveGenerated)
src/lib/worker/runs.ts                 one run step (port of runStep), picture-run ticks (port of pictureTick etc.)
src/lib/worker/uploads.ts              work_uploads table access, resolveSource(source) -> Blob
src/lib/imageSize.ts                   imageSize(bytes) -> {width, height} | null (D7)
src/lib/comfy/jobSpec.ts               JobSpec (serializable JobInput), toSpec(), fromSpec()
src/app/api/queue/route.ts             GET items (the queue as the browser shows it)
src/app/api/queue/events/route.ts      SSE: every item change ("item", "removed", "machine")
src/app/api/queue/pictures/route.ts    POST ask (a click on Queue)
src/app/api/queue/items/[key]/route.ts DELETE dismiss; POST {action: "stop" | "move", how}
src/app/api/queue/paused/route.ts      GET / PUT (D10)
src/app/api/queue/uploads/route.ts     POST a picture (multipart or raw body), answers {source: "upload:<id>"}
src/app/api/queue/generate/route.ts    POST start, DELETE ?key= stop
src/app/api/queue/generate/events/route.ts  SSE ?key=<draft key>: text so far, then each piece, then done/error
src/app/api/ai-runs/[id]/events/route.ts    SSE: RunEvent and the saved run, for the run page
src/app/api/ai-runs/[id]/queue/route.ts     POST start/resume, DELETE stop (the worker does it)
```

Retry and Skip have no routes of their own today: `retryTask`/`skipTask` (`runner.ts`) claim the run and save it through `/api/ai-runs/<id>/claim` and `PATCH /api/ai-runs/<id>`. Add `POST /api/ai-runs/<id>/task` with `{taskId, action: "retry" | "skip"}`, which calls them on the server with the worker's token (D8) and, for a run the worker is stepping, waits for the current step to end first.

### Migration 32 (in `MIGRATIONS`, `src/lib/db.ts`)

```sql
CREATE TABLE work_items (
  key        TEXT PRIMARY KEY,          -- "job-<id>", "run:<run id>", "gen:<draft key>"
  type       TEXT NOT NULL CHECK (type IN ('picture', 'run', 'generate')),
  state      TEXT NOT NULL CHECK (state IN ('gathering', 'waiting', 'working', 'paused', 'done', 'failed')),  -- 'paused': a run the author stopped or that waits for its plan to be checked (agreed with the owner); the scheduler skips it
  target_key TEXT,                      -- pictures: targetKey(target); others null
  data       TEXT NOT NULL,             -- JSON: per type, see items.ts (spec, count, view, progress, prompt_id, pictures, message, run id, request...)
  moved      INTEGER NOT NULL DEFAULT 0,
  ready_at   INTEGER,                   -- when it finished gathering (scheduler order)
  ended_at   INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX work_items_state ON work_items(state, ready_at);
CREATE TABLE work_uploads (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,             -- MIME type
  bytes      BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
```

Uploads older than 24 hours are deleted when the worker starts and once an hour. Add a case to `tests/unit/migrations.test.mts` (see how earlier migrations are checked there). Restart the dev server after adding the migration (CLAUDE.md).

### `JobSpec` (src/lib/comfy/jobSpec.ts)

`JobSpec` is `JobInput` with every closure replaced by data:

- `start: { key: string; source: string } | null` (the `StartPicture` minus `thumb`, `blob`, `image`, `slot`; keep `image` and `slot` when present, they are plain data).
- `refs: (StoredReference & { key: string })[]` (no `thumb`, no `blob`).
- `mask: { source: string; id: string; width: number; height: number } | null`: the browser renders the mask PNG with `renderMask`, uploads it, and passes `upload:<id>`. `id` stays the `PaintedArea.id`, because `sameJob` uses it.

`toSpec(input, uploaded)` runs in the browser (`uploaded` maps a picture key to its `upload:<id>` source for pictures that need uploading). `fromSpec(spec, resolveSource)` runs on the server and rebuilds a `JobInput` whose `blob()` calls `resolveSource(source)`. `queueJob` then works unchanged, except `uploadStart`, which must use `imageSize` instead of `createImageBitmap` when `createImageBitmap` is undefined. Keep `sameJob` working on both (it reads only data fields).

Which sources need uploading: `upload:` (picked files), Refine's flattened picture (its `source` is the original's, so use `key` starting `refine:` to detect it), and masks. Everything else the server fetches (D6).

### Events (SSE payloads, JSON in `data:`)

- `/api/queue/events`: on connect, `{"type":"items","items":[...]}` (the full list, same shape as `WorkItem` in `WorkQueue.tsx` today), then `{"type":"item","item":{...}}` on each change, `{"type":"removed","key":"..."}`, and `{"type":"machine","machine":{holder,waitingPictures,waitingWriting},"waiting":[keys],"paused":bool}`.
- `/api/queue/generate/events?key=`: `{"type":"text","text":"<all so far>","base":{title,body}}` on connect if anything is written, then `{"type":"text",...}` at most every 250 ms, then `{"type":"done","after":{...}}` or `{"type":"error","message":"..."}`.
- `/api/ai-runs/<id>/events`: `{"type":"event","event":RunEvent}` and `{"type":"run","run":AiRun}`.

Throttle `item` events for progress to at most 4 per second per item.

## Phases and tasks

Each task is one commit unless it says otherwise. Each task lists what to do, what not to touch, and how to check it. Ship to `main` at the end of each phase (CLAUDE.md "ship it"), unless the task says not to.

### Phase 0: make the shared code run in Node (no visible change)

**0.1 Self fetch (done).** Add `src/lib/worker/selfFetch.ts`: `export const selfFetch: Fetch = (input, init) => fetch(typeof input === "string" && input.startsWith("/") ? `${selfBase()}${input}` : input, init)`, with `selfBase()` = `process.env.STORYTIME_SELF_URL ?? \`http://127.0.0.1:${process.env.PORT ?? 3737}\``. Unit test: relative and absolute URLs. Check: `npx tsc --noEmit`, `node tests/run.mjs unit`.

**0.2 Move edit-model helpers out of components (done).** `src/lib/aiRuns/pictures.ts` imports `drawPresetFamily`, `drawPresetIpAdapter`, `toEditModels`, `EditModels` from `src/components/useEditModels`. Move those (pure, non-hook) exports into `src/lib/comfy/editModelsData.ts` (or into `editModels.ts` if they fit there), re-export them from `useEditModels` so other imports keep working, and change `pictures.ts` to import from `src/lib`. Then `grep -rn "components/" src/lib` must print nothing. Check: tsc, `npx next build`, unit tests, `node tests/run.mjs e2e missing-pictures illustrate-families`.

**0.3 imageSize (done).** `src/lib/imageSize.ts` (D7) plus `tests/unit/image-size.test.mts` with tiny hand-built PNG and JPEG headers (`fakeComfy.mjs` already builds PNGs; copy its approach). Change `uploadStart` (`startPicture.ts`) to fall back to `imageSize` when `typeof createImageBitmap === "undefined"`. Check: unit tests, `node tests/run.mjs e2e illustrate-start`.

**0.4 JobSpec (done).** (Found while doing it, agreed with the owner: `queueJob` was not unchanged. Its mask upload drew the strokes on a canvas, so `PaintedArea` got an optional `render?: () => Promise<Blob>`, set by `fromSpec` to fetch the uploaded PNG, and `uploadMask` in `makeJob.ts` uses it when set. `SpecStart` and `SpecRef` also have an optional `fetch` source: the bytes come from the upload, while `source` is still what the job log records, as for Refine's flattened picture.) Add `src/lib/comfy/jobSpec.ts` as above, with `tests/unit/job-spec.test.mts`: `sameJob(fromSpec(toSpec(x)))` equals `sameJob(x)` for a drawing job, an edit job with a start, a redraw with a mask, and a job with refs; `blob()` of a rebuilt start calls the resolver with the right source. No caller uses it yet.

**0.5 A shared fake AI server for tests (done).** Several e2e files each build their own fake AI server on port 3222. Add `tests/fakeAi.mjs` (`startFakeAi({port, reply, delay})`, OpenAI-compatible `/v1/chat/completions` with streaming, and the Ollama `/api/ps` and `/api/generate` endpoints; copy from `tests/e2e/write-ahead.e2e.mjs` lines ~18–53). Don't change existing e2e files to use it (CLAUDE.md: no unrequested fixture changes); the new API tests below use it.

**0.6 Node smoke test of the clients (done).** (Nothing browser-only needed fixing. Note for later API tests: `fakeComfy`'s `uploaded(name)` returns the file plus the form fields after it, so compare by prefix.) `tests/unit/node-clients.test.mts`: start `fakeComfy.mjs` on a free port (e.g. 3556) and the fake AI. From Node, call `queueJob` (via `fromSpec` with a resolver that returns a small PNG blob) and `waitForPictures`, and check pictures come back both with `ws: true` and `ws: false`. Call `streamChat` against the fake AI. This proves D4/D6 before any worker exists. If `waitForPictures` or `queueJob` uses anything browser-only, fix it here (Node has a global `WebSocket` in 22; if it is missing, fall back to polling).

Ship Phase 0.

### Phase 1: the worker skeleton (idle)

**1.1 Migration 32 and `items.ts` (done).** Add the tables above, `src/lib/worker/items.ts` (zod schemas for each item's `data`, `createItem`, `getItem`, `listItems` (oldest first, leaving out `done`/`failed` items older than 7 days), `updateItem(key, patch)`, `deleteItem`), and the migration test. Check: `npm test`.

**1.2 Bus, SSE, worker start (done).** (As built: the events carry the stored row, `{type: "item", item: row}`, not yet the browser's `WorkItem`; that mapping needs the scheduler's waiting order and progress, so it is written with the picture work in Phase 4. `GET /api/queue/events` sends `items` on connect but no `machine` event yet; that comes with the loop. The test-only route is `/api/queue/test-items`, on only when `STORYTIME_TEST=1`, which `tests/run.mjs` sets for the server it starts. `worker/uploads.ts` has only `deleteOldUploads` so far; `resolveSource` is 1.3. The bus and the worker state live in `worker/bus.ts`, on `globalThis.__storytimeWorker`, so `items.ts` can publish without importing `worker/index.ts`.) `bus.ts`, `sse.ts`, `worker/index.ts` (`startWorker()` creates the `globalThis` singleton once, runs restart recovery (D12; nothing to recover yet), schedules upload clean-up; `getWorker()` returns it, starting it if needed, so routes work even if instrumentation ran in another module copy), `src/instrumentation.ts`. `GET /api/queue` and `GET /api/queue/events` (`export const dynamic = "force-dynamic"`, `runtime = "nodejs"`). Write `tests/api/queue.test.mjs`: connect to the events route with `fetch` and read the body stream, check the first `items` event arrives, then create an item through a test-only path (or wait for 1.3) and check an `item` event arrives within 1 s, which proves events aren't buffered. Check: `npx next build` (watch for warnings about instrumentation), `node tests/run.mjs api queue`, and the Docker CI job after pushing (health check must still pass).

**1.3 Pause and uploads routes.** `GET/PUT /api/queue/paused` (D10) and `POST /api/queue/uploads` (≤ 20 MB, image MIME types only, answers `{source: "upload:<id>"}`), plus `resolveSource()` in `uploads.ts` for all four source kinds (D6). API tests for each.

Ship Phase 1.

### Phase 2: Generate on the server

**2.1 `generate.ts` and routes.** Port `runGenerate` and `saveGenerated` from `WorkQueue.tsx` into `src/lib/worker/generate.ts`. Use `getSettings()` at the start of each Generate, `draftStore.getDraft/putDraft` instead of the browser `drafts.ts` helpers (match the conflict handling: one retry after a conflict, then fail keeping `text`), and publish text on the bus channel `gen:<draft key>` (D11). `POST /api/queue/generate` takes the `GenerateRequest` body (validate it with zod; the `ctx` part can be loose `z.unknown()`-based but bounded in size) and creates a `generate` item in `waiting`. `DELETE ?key=` stops it (abort; text so far stays in the draft). `GET /api/queue/generate/events?key=`.

**2.2 The loop, writing only.** `loop.ts`: `pump()` reads items, builds `ScheduleState` (as `pump` in `WorkQueue.tsx` does), calls `schedule()`, and starts `startWriting` actions. A Generate goes before waiting runs (D16 in the old plan: already in `schedule()`'s input order). Call `pump()` after every item change and every 5 s. API test with the fake AI: post a Generate, follow its events, check the draft is saved with the text (`GET /api/drafts/...`), check Stop keeps the partial text.

Ship Phase 2 (nothing in the browser uses it yet).

### Phase 3: AI runs on the server

**3.1 Run steps.** Port `runStep` to `src/lib/worker/runs.ts`: claim with the worker token (D8), `runNextStep(run, { settings: getSettings(), token, signal, onEvent, deps: { fetch: selfFetch }, promptsAhead })`, the same outcome handling (waiting / done / review → paused "Plan ready to check" / failed / paused), publishing `RunEvent`s on `run:<id>` and the saved run. Routes: `POST /api/ai-runs/<id>/queue` (start or resume: set the run `queued`, create or reset its `run:<id>` item), `DELETE` (stop: abort, `finish(run, "paused")`). Retry and Skip: `POST /api/ai-runs/<id>/task` (see "The new pieces"). `GET /api/ai-runs/<id>/events`.

**3.2 Picture runs.** Port `pictureTick`, `askPicture`, `pictureMade`, `pictureFailed`, `flushPictures`, `stopPictures` into `runs.ts`, asking for pictures through Phase 4's `askPicture` (so 3.2 lands after 4.1, or stub it and finish it in 4.3). Keep "a failed job is asked again once, then the run fails".

API tests: `tests/api/queue-runs.test.mjs` with the fake AI: a fill run of two chapters goes to done; Stop pauses it; Resume finishes it; a server restart is not tested here (see 4.4).

Ship Phase 3.

### Phase 4: pictures on the server

**4.1 Ask and gather.** `POST /api/queue/pictures` takes `{target, spec: JobSpec, view}` (the same fields as `AskRequest`, with `input` as a `JobSpec`). Gathering quick clicks (`GATHER_MS`, `MAX_BATCH`, `sameJob`, `comfy.batchClicks`) moves to the server: a click joins the `gathering` item with the same target and `sameJob` key, otherwise a new item is made. A timer per gathering item marks it `waiting` with `ready_at`. Port carefully from `ask`/`markReady` in `WorkQueue.tsx`.

**4.2 Send, wait, record, stop.** Port `send`, `finish`, `record`/`recordPictures`, `failed`, `stop` into `worker/pictures.ts`: `fromSpec` → `queueJob` (with `beforeQueue: () => freeOllamaForPictures(getSettings().connections)`, the instance id from `src/lib/instance.ts` directly, and an upload cache kept on the worker) → save `prompt_id` on the item at once → `waitForPictures` → `recordPictureJob` (call the lib function directly, not the HTTP route) → item `done` with its pictures. Keep the "one after another, each once the one before is queued" chain. Stop: abort, and `cancelPrompt` when a `prompt_id` is known. Move (`moveWaiting`) and pause are applied in `pump()`. `machine` events are published after every pump.

**4.3 Scan ComfyUI.** Port `scan` (find StoryTime jobs in ComfyUI with `listTaggedJobs`, record those the log doesn't have, show those being made) to run on worker start and every 60 s. Only this StoryTime's jobs (`instance`), exactly as now (see the "Jobs are tagged in ComfyUI" bullet in `docs/illustrate.md`). Do not start the scan until Phase 5 lands, or the browser and the server would both record the same jobs: put it behind `if (getWorker().clientsOnServer)` that Phase 5 turns on, or add it in 5.x.

**4.4 Restart recovery.** Implement D12 in `startWorker()`. API test: start a picture job against `fakeComfy` with a slow `stepDelay`, restart the server inside the test (the API runner owns the process; if that is awkward, call a test-only `POST /api/queue/__restart` that reruns recovery when `STORYTIME_TEST=1`), and check the job still finishes and is recorded once.

API tests: `tests/api/queue-pictures.test.mjs` with `fakeComfy`: two quick asks with the same spec make one job of 2; a different spec makes two jobs; pause holds jobs; move reorders; Stop cancels on ComfyUI (`comfy.calls` has `/interrupt` or a queue delete); a failed job (`fail: "error"`) ends `failed` with ComfyUI's message; an upload source reaches ComfyUI's `/upload/image` with the same bytes.

Ship Phase 4. The server can now do everything, but the browser still uses its own queue.

### Phase 5: switch the browser over (the one visible change)

Do this on a branch (`server-queue`), not in small pieces on `main`. Push to `main` only when the whole browser suite passes.

**5.1 New provider.** Rewrite `WorkQueue.tsx` as a client of the server, keeping the exported types and the `WorkQueueApi` shape:

- State: the items from `/api/queue/events` (one `EventSource` per tab, reconnect with backoff; on reconnect the `items` event replaces the list).
- `ask(req)`: upload pictures that need it (D6; Refine's flattened picture, masks via `renderMask`, `upload:` refs), `toSpec`, `POST /api/queue/pictures`. Upload once per picture key per tab (a small map), like today's upload cache.
- `stop`, `dismiss`, `move`, `setPaused`: the routes above. `paused` comes from `machine` events.
- `listen(target, listener)` and `listenSession(sessionId, listener)`: purely in the browser. When an item for that target (or session) is `done` or `failed`, hand its pictures or error to the listener, then `markJobsSeen` and dismiss it (as `ended`/`adopt`/`keep` do today). The rule "a session's jobs never reach a page's `listen`er and are never ready in the header" stays.
- `generate`, `stopGenerate`, `listenDraft`: the generate routes; `listenDraft` opens `/api/queue/generate/events?key=`.
- `startRun`, `stopRun`, `resumeRun`, `listenRun`: the run routes; `listenRun` opens `/api/ai-runs/<id>/events`.
- Remove: `TAB_TOKEN`, leases from the browser, the `elsewhere` state, `beforeunload`, the wake lock, the ComfyUI scan, `loadRuns`, the picture-run tick functions, `localStorage` pause (migrate once, D10).
- Keep `window.__storytimeQueue` for tests, pointing at the new state.

**5.2 Writing page.** In `ChapterEditor.tsx` (grep `listenDraft`, around line 312): while its Generate is `working`, do not autosave; when it ends, reload the draft from the server (D11). Only touch that part of the file.

**5.3 Pages that read run state.** `WriteAhead.tsx`, `AiRunProgress.tsx`, `MissingPictures.tsx`, `QueuePage.tsx`, `WorkQueueStatus.tsx`: remove anything about `elsewhere` and the tab lease; otherwise they should keep working through the hook. Check each with its e2e file.

**5.4 Turn on the server scan** (4.3).

**5.5 Tests.** Run the whole browser suite (`npm run test:e2e`, in a cloud session `E2E_EXECUTABLE=/opt/pw-browsers/chromium`). Expected breakage and what to do:
- Tests that wait for work to stop when a page closes, or test `elsewhere`, `beforeunload` or the wake lock: change them to the new behaviour (work continues), don't delete them.
- Tests that check "kept in this tab only" for Refine sessions: the server now keeps them; update.
- Tests that set the pause flag in `localStorage`: use `PUT /api/queue/paused`, and set it back at the end (tests share one server, AGENTS.md).
- Tests that leave items in the queue change what later files see: dismiss or delete items a test creates (`DELETE /api/queue/items/<key>`).
- Never skip or delete a test to get green. If a test's expectation is wrong for the new design, change it and say why in the commit message.

**5.6 Docs.** Update `docs/illustrate.md` (the "picture queue", "Make missing pictures" and "Jobs are tagged" bullets, and its first paragraph: "All ComfyUI calls are made from the browser" is no longer true), `AGENTS.md` ("AI calls made from the browser" in `CLAUDE.md`'s first line too: ask the owner before editing `CLAUDE.md`), the stale comment at the top of `src/lib/ai/client.ts`, and `TODO.md` (remove this item; note under the Review plan's stage 5 that the server can now make AI calls).

**5.7 Settings note.** In Settings, near each connection's URL and ComfyUI's URL, add one line of help: "The StoryTime server uses this address, so it must work from the NAS (not `localhost` unless the service runs in the same container)." Add a "Test from server" check: `GET /api/queue/check?url=` that fetches ComfyUI `/system_stats` or the provider's models list from the server and reports success or the error. Small UI change: one e2e file and a phone screenshot.

Ship Phase 5, then tell the owner the manual checks below.

## Manual checks for the owner (cannot be done in a cloud session)

1. On the NAS, before Phase 5 ships: `docker exec -it storytime node -e "fetch('http://<comfy-ip>:8188/system_stats').then(r=>r.text()).then(console.log)"`, and the same for Ollama (`http://<ollama-ip>:11434/api/ps`). Both must print JSON. If not, the server can't reach them and the Settings URLs need changing (or the NAS firewall or Docker network does).
2. After Phase 5: queue 4 pictures on the phone, lock the phone, wait, unlock. The pictures should be ready.
3. Start a write-ahead run, close every tab, reopen later. The run should have continued.
4. During a long picture job, do Compose Pull and Compose Up. The job should be found again and recorded once.

## Later (not part of this plan)

- Route the remaining one-off AI calls (codex scan, tag suggestions, summaries, Write prompt, Refine's prompt) through a server `POST /api/ai/chat` stream, so the browser never calls providers and no CORS setup is needed.
- A `/api/comfy/view` proxy so the Refine canvas can load ComfyUI pictures without CORS.
- Nightly or after-save runs (Review stage 5 in `TODO.md`).
- Rewriting `src/lib/aiRuns/api.ts` callers to use SQLite directly instead of self fetch.

## Notes for agents

- Work one task at a time, in order. Before a task, read the files it names (grep for the function, then Read with offset/limit). Don't read the whole of `WorkQueue.tsx` at once; it is long.
- When porting from `WorkQueue.tsx`, keep the behaviour and the user-facing messages word for word. Port the comments that explain why.
- Server code must not import from `src/components/` or anything that touches `window`, `document`, `localStorage` or `createImageBitmap` without a guard. A quick check: `grep -rn "components/" src/lib/worker src/lib/aiRuns`.
- Route handlers: `export const dynamic = "force-dynamic"`, validate bodies with zod (see `src/lib/api.ts` `handlePost`), and keep `?` placeholders matched to parameters.
- After changing app code, `npx next build` before running API or browser tests (they run the existing build).
- If a decision above turns out wrong in practice (for example SSE is buffered, or `instrumentation.ts` runs twice), stop, write what you found under the decision in this file, and ask the owner before choosing another way.
- After each task, tick it here (add "(done)" after its title, with the commit's short hash) so the next agent knows where to start.
