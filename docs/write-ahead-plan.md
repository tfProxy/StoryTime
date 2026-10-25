# AI runs: write ahead and fill missing pictures (implementation plan)

A plan for agents to build in small pieces. Read `CLAUDE.md` and `AGENTS.md` first and follow them (Edit/Write tools only, the Verification rules, one logical change per commit). Each **milestone** is shipped to `main` on its own ("ship it" in `CLAUDE.md`) before the next starts; each **task** in it is one agent's job and one commit.

## What the owner asked for

From a chapter, the AI does many steps without the owner doing each one:

1. **Fill open choices** (`fill`): every unwritten choice on this chapter, or anywhere below it, gets its chapter written.
2. **Grow the tree** (`tree`): fill the tree below this chapter to a depth (say 5) with a number of choices per chapter (say 3 or 4), counting what is already there.
3. **Reach a goal** (`arc`): the owner says what should happen and in how many chapters; the AI plans the steps, the owner edits the plan, then the AI writes the chain.
4. **Fill missing pictures** (`pictures`, a separate feature): make the header and/or footer picture for every chapter of a branch or story that lacks one.

## Decisions (agreed with the owner, 2026-10-24)

| # | Question | Decision |
|---|---|---|
| D1 | Order | **Milestone 0** first: the picture queue becomes the one **work queue**, with pictures behaving exactly as now. Then milestone 1, Fill open choices, which adds writing to it (runs, runner, the take-turns settings, marks). After that any order: 2 Grow the tree, 3 Reach a goal, 4 Fill missing pictures, 5 the writing page's Generate in the queue. Suggested: 0, 1, 5, 2, 3, 4. |
| D14 | One work queue | Pictures and writing are **one queue, in code and on screen** (the owner chose a full merge): the picture queue (`src/components/PictureQueue.tsx`) becomes `WorkQueue`, app-wide in the root layout, holding picture jobs and writing items, so work goes on while the owner moves to other pages of the app. A full reload or closed tab still stops writing; runs resume from the server (Resume, never by themselves). |
| D15 | What the queue holds | Picture jobs (as now), write-ahead and picture runs, and the writing page's **Generate** (milestone 5): leave the page mid-chapter and it finishes into the draft. Revise and passage rewrites stay on the page as now. |
| D16 | Order inside writing | One writing request at a time, in the order started. A single Generate goes before a run's next chapter (the run waits after the chapter it is on), so it isn't stuck behind a long run. |
| D17 | Header | **One** queue button (today's pictures button, `PictureQueueStatus`) for everything: a spinner and count while working, "N ready", ⚠ for failed or paused items. Its list has the picture jobs and the writing items together, newest first, each with its own buttons (picture jobs as now; writing: Stop, Resume, Open, Dismiss). |
| D18 | Sharing the machine | A setting, **Settings › Queue › Writing and pictures**: "Take turns (same machine)" or "At the same time (different machines)". The owner's machine runs both, so **take turns** is the default. Taking turns: while ComfyUI has one of our jobs, no AI request starts, and while an AI request runs, no picture job is sent to ComfyUI. |
| D19 | How turns switch | **Finish a batch, then switch**: keep doing the kind that has the machine while it has waiting work, until the batch limit (Settings › Queue: "Switch after" N minutes, default 10, and/or N items, default 0 = no item limit), then let the other kind go if it has waiting work. The existing memory settings (a connection's `freeComfy`, Ollama's `freeForPictures`) do the unloading; the queue only decides the order. |
| D20 | Models inside a run | A run setting, **Models**: "Use the writing model for everything" (choices and summaries too, so a local server never swaps models) or "Group by model" (default): the chapters at one level are written first with the writing model, then their summaries and choices with the cheaper one, then the next level. Plain "one chapter at a time" stays available as a third choice. |
| D22 | Planning | **One level ahead**: a written chapter's choices are planned together (choice text plus what happens), from its real text, and the next chapters follow those plans. Not a whole-tree outline (it would drift from what gets written), not winging it (siblings repeat each other). Reach a goal keeps its up-front plan. |
| D23 | Reviewing the plan | A run checkbox, **Let me check the plan first** (off by default): the run pauses each time a level's plans are made, shows them on the run page to edit (choice text, what happens; remove one), and goes on with **Continue**. |
| D24 | Queue page | `/queue` ("Queue", linked from the header list and the site menu): which kind has the machine and until when; working; waiting, in order, with **Move up / Move down / Do next**; held pictures; finished and failed; **Pause queue** (nothing new starts, what is running finishes) and **Resume queue**; and **History**, kept on the server. |
| D21 | Grouping pictures | Among picture jobs waiting their turn (not yet sent to ComfyUI), those for the drawing preset (checkpoint) of the last job sent go first, so ComfyUI swaps checkpoints less; each target's (chapter's) own jobs keep their order. A Settings › Queue checkbox, on by default. |
| D2 | Where it starts | The chapter reading page's ☰ menu (`PageMenu` in `src/app/c/[id]/page.tsx`): **Write ahead with AI…** opens `/c/<id>/write-ahead`. No button under the choices, nothing on the outline. |
| D3 | Review | Chapters are posted straight away, marked "Written by AI, not reviewed" until the owner presses **Mark reviewed**. Editing or reading a chapter doesn't count as reviewing it. |
| D3a | The AI mark | A **robot icon**, everywhere an AI-written chapter appears: in the chapter page's meta line, on the choice card that leads to it (the parent chapter's "What happens next?"), and in the outline. The mark **stays after review**: unreviewed is a filled, accent-coloured robot (title "Written by AI, not reviewed"); reviewed is a quiet outline robot in the muted colour (title "Written by AI"). Only chapters are marked, not the unwritten choices a run adds. In the outline it is a new part, **AI-written**, in Settings › Outline, **on by default**. |
| D4 | What Fill writes | Unwritten choices only (a choice with no chapter). Brainstorm ideas never added as choices are not included. |
| D5 | Choices on the last chapters written | 3 unwritten choices suggested by the AI (a run setting, 0–6), so the story doesn't end there. |
| D6 | Choices along a Reach a goal chain | Only the next step's choice; "Other choices along the way" (0–3, default 0) adds AI-suggested unwritten ones. |
| D7 | Size limits | At most 200 chapters per run (`LIMITS.runChapters`), depth 1–8, choices per chapter 1–6, Reach a goal 1–20 chapters. Over 20 chapters asks to confirm. |
| D8 | Requests at once | One AI request at a time (a local Ollama can't run several). |
| D9 | Codex | Not updated by a run. The run page says so. |
| D10 | Pictures: which one is used | One picture per slot, saved as the header/footer straight away. No choosing. |
| D11 | Pictures: which slots | A run setting: Header, Footer, or Both (default Header). |
| D12 | Pictures: references | A run setting, **off by default** (the owner doesn't trust the reference workflow yet). On: the story's style picture plus, for a footer, the chapter's header. |

## How it works (all milestones)

- **AI calls run in the browser** (`src/lib/ai/client.ts`; keys never reach the server), and so do ComfyUI calls. Work is held by the app-wide **work queue** (D14), so it goes on across pages of the app while the tab is open, and the queue decides when writing and pictures each get the machine (D18–D21). To survive a reload or closed tab, **a run's task list is kept on the server** (`ai_runs`) and can be resumed.
- A run is a **list of tasks**. A planner (pure functions) turns the owner's choices into tasks; the **runner** does one task at a time and saves the list after each; the queue calls it task by task, so a Generate can go in between (D16).
- A written chapter is posted with the existing `POST /api/chapters`, as the writing page posts one (title, body, choices, summary, path_summary), plus the run's id for the D3 mark. Writing it repeats the writing page's steps from `ChapterEditor.tsx` without its UI: older path summaries (`neededSummaryIndex` + `ensurePathSummaries`), `generatePrompt` with `SYSTEM_CHAPTER` streamed with `streamChat` (main model), `parseChapterOutput`, `summarizeChapter` (cheap model; a failure doesn't stop the post), and the next level's plan (below).
- **Planning one level ahead (D22).** Each chapter is written from a short plan of what happens in it, made from the real text of its parent: a **plan step** (cheap model, `planStepsPrompt`) takes a written chapter and returns, for each of its choices to be written, one or two sentences on what happens in the chapter it leads to, planned together so siblings differ; it can also add new choices with their plans (Grow the tree, and the suggested choices on new chapters). The plan becomes the child tasks' `direction`. With **Let me check the plan first** (D23), the run stops after a level's plans are made and waits for the owner to edit them. Reach a goal plans the whole chain up front instead (the owner asked for that).
- Counts grow fast: 3 choices × 5 levels is 3 + 9 + 27 + 81 + 243 = 363 chapters, about 3 AI requests each. The form shows the count before starting and refuses over the limit.

## Shared types (`src/lib/aiRuns/types.ts`, created in task 1.2; task 1.1 copies the shapes into zod)

Milestone 1 needs only `WriteTask` and the `fill` options; later milestones add the rest. Keep the field names so later tasks fit.

```ts
export type RunMode = "fill" | "tree" | "arc" | "pictures";

/** Where a write task's chapter goes. */
export type Slot =
  | { kind: "choice"; choiceId: string }                       // an existing unwritten choice
  | { kind: "new"; parentChapterId: string; label: string }    // a new choice on an existing chapter (arc)
  | { kind: "fromTask"; taskId: string; choiceIndex: number }; // the n-th choice an earlier task's chapter was posted with (arc)

/** `written`: posted, its summaries and planned choices still to come (D20 "Group by model"). */
export type TaskStatus = "todo" | "written" | "done" | "failed" | "skipped";

export type WriteTask = {
  kind: "write";
  id: string;            // "t1", "t2", … unique in the run
  slot: Slot;
  label: string;         // the choice text (shown, and sent as "The reader chose")
  direction: string;     // what happens in this chapter; "" leaves it to the AI
  depth: number;         // 1 = a child of the start chapter
  /** The new chapter's choices: `given` first (in order), then `suggest` more from the AI, each planned by a plan step (D22). */
  choices: { given: string[]; suggest: number };
  /** The plan task that writes this task's `direction`; the task waits for it (Fill). */
  plannedBy?: string;
  /** Grow the tree: queue a task for each of the new chapter's choices (milestone 2). */
  expand: boolean;
  status: TaskStatus;
  chapterId?: string;    // set when done
  choiceIds?: string[];  // from POST /api/chapters, same order as the choices sent
  error?: string;
};

/**
 * A plan step (D22) on a chapter that exists: what happens after each of `labels` (its unwritten choices to be
 * written), plus `add` new choices with their plans (Grow the tree tops a chapter up to its width). The result is
 * kept in `steps` and copied into the waiting write tasks' `direction`; new choices are added to the chapter.
 */
export type PlanTask = {
  kind: "plan"; id: string; chapterId: string; depth: number;
  labels: string[]; add: number;
  status: TaskStatus;
  steps?: { label: string; direction: string; choiceId?: string }[];
  error?: string;
};

/** Fill missing pictures (milestone 4): one picture for one slot of one chapter. */
export type PictureTask = { kind: "picture"; id: string; chapterId: string; slot: "header" | "footer"; status: TaskStatus; prompt?: string; negative?: string; jobId?: string; error?: string };

export type RunTask = WriteTask | PlanTask | PictureTask;

export type RunOptions = {
  // writing modes
  length?: "short" | "medium" | "long";
  model?: ModelRef | null;        // writing model; null = the default main model
  suggestModel?: ModelRef | null; // choices, summaries and picture prompts; null = the default cheap model
  guidance?: string;              // added to every chapter's direction ([bracket notes] allowed)
  endChoices?: number;            // D5
  reviewPlan?: boolean;           // D23, default false
  models?: "group" | "writing" | "each"; // D20, default "group"
  scope?: "children" | "below";   // fill, and pictures ("below" = this chapter and everything under it)
  maxDepth?: number; breadth?: number;                         // tree
  objective?: string; chapters?: number; alternatives?: number; // arc
  // pictures
  slots?: "header" | "footer" | "both";
  useRefs?: boolean;              // D12, default false
};

/** `queued`: waiting its turn in a tab's work queue. `running` with a lapsed lease means the tab that ran it is gone. */
/** `review`: waiting for the owner to check a level's plans (D23); `AiRun.reviewDepth` says which. */
export type RunStatus = "ready" | "queued" | "running" | "review" | "paused" | "done" | "stopped";

export type AiRun = {
  id: string; story_id: string;
  start_chapter_id: string | null;  // null = the whole story (pictures)
  mode: RunMode; options: RunOptions; tasks: RunTask[];
  status: RunStatus; review_depth: number | null; error: string | null; version: number; finished_at: number | null;
  created_at: number; updated_at: number;
};
```

---

## Milestone 0: one work queue (ship to `main` when done; pictures work exactly as now)

The picture queue becomes the app's one work queue (D14), still holding only picture jobs, so this milestone can be checked against the existing picture tests before any writing is added. Read `docs/illustrate.md` first (`CLAUDE.md` requires it: the picture queue is described under **The picture queue**) and update that bullet in the same change.

### Task 0.1: rename and reshape, no change in behaviour

**Files:** `src/components/PictureQueue.tsx` → `src/components/WorkQueue.tsx`, `src/components/PictureQueueStatus.tsx` → `src/components/WorkQueueStatus.tsx`, `src/app/layout.tsx`, every importer of `usePictureQueue` (grep), `docs/illustrate.md`, `src/app/globals.css` if class names change.

- `WorkQueueProvider` and `useWorkQueue()`. Its items are a union tagged by `type` (picture jobs already have a `kind` from `PictureTarget`): `{type: "picture", ...today's QueueJob}` for now (task 1.4 adds `"run"`, milestone 5 `"generate"`). (Done in task 0.1.) Keep `usePictureQueue()` as a thin hook over it with exactly today's API (`jobs`, `ask`, `stop`, `dismiss`, `listen`, `listenSession`), so `ComfyGenerate`, the Refine screen and the other callers don't change.
- Pull the decision of what to do next into a pure module, `src/lib/workQueue/schedule.ts`: `nextActions(state, settings) → Action[]` (for now: which gathered picture jobs to send to ComfyUI; today that is "all of them, at once"). The provider does what it returns. This is where task 1.4 and D18–D21 go, and it is unit-testable.
- The header button and list: same look, same behaviour; the list's region is renamed "Queue" (today "Picture jobs"; update the two picture-queue browser files for the new name and nothing else).
- **Check:** shared code (root layout): `npx tsc --noEmit`, `npx next build`, `npm test`, the whole browser suite (every `illustrate-*`, `picture-queue*`, `refine-*` and `cover-make` file must pass unchanged apart from the region name), one phone and one desktop screenshot of the header list. A unit test for `schedule.ts` that today's rule holds.

### Task 0.2: the Queue settings and grouping pictures (after 0.1)

(Done in task 0.2: `settings.queue`, the Settings › Queue tab, `orderHeldPictures` in `schedule.ts` with unit tests, `tests/e2e/settings-queue.e2e.mjs`. The rule is written and tested but not called by the provider; task 1.4 calls it when the queue holds jobs back.)

**Files:** `src/lib/settingsSchema.ts`, `src/components/SettingsForm.tsx`, `src/lib/workQueue/schedule.ts`, `src/components/WorkQueue.tsx`, unit tests, a browser test.

- `settings.queue`: `{ sharing: "turns" | "together" (default "turns"), switchMinutes: number (default 10, 1–120), switchItems: number (default 0 = no limit, 0–100), groupPictures: boolean (default true) }`. Settings saved before have none: read them as the defaults (see how `outline` is filled). A **Queue** section in Settings (look at how the Outline section is laid out), with a line under Writing and pictures: "Take turns when the AI model and ComfyUI run on the same machine, so they don't run out of memory."
- **Grouping pictures (D21):** jobs only wait in StoryTime when the queue holds them back (task 1.4: taking turns). With nothing to wait for, jobs still go straight to ComfyUI as today, so this milestone changes nothing visible unless pictures are held. Write the rule now in `schedule.ts` with unit tests (held jobs of the last-sent preset first, a target's own jobs in order); the provider uses it from task 1.4.
- **Check:** settings schema is shared code: `npx tsc --noEmit`, `npx next build`, `npm test`, the whole browser suite, a screenshot of the Settings › Queue section at phone width.

### Task 0.3: the queue page (after 0.2)

(Done in task 0.3, for pictures only: the page, Pause/Resume, moving, History and its API. Writing items, runs and “which kind has the machine” join in task 1.4.)

**Files:** `src/app/queue/page.tsx` (new), `src/components/QueuePage.tsx` (new), `src/components/WorkQueue.tsx`, `src/components/WorkQueueStatus.tsx`, `src/lib/workQueue/schedule.ts`, `src/components/SiteMenu.tsx`, `src/app/api/picture-jobs/route.ts` (History), `tests/e2e/queue-page.e2e.mjs` (new), `docs/illustrate.md`.

`/queue` (D24), titled "Queue", linked as **Open queue** at the bottom of the header list and from the site menu. Built from the queue's own state, so it shows what this tab is doing; task 1.4 adds the writing items and runs from other tabs.
- **At the top:** which kind has the machine and until when (after task 1.4; until then, "Pictures"), and **Pause queue** / **Resume queue**: paused, nothing new is sent or started, what is running finishes, and the header button shows "Paused". Kept in this browser (`localStorage`, try/catch), so a reload stays paused; say so on the page.
- **Working** (with progress and Stop), **Waiting** in the order they will go (`schedule.ts` gives that order, so the page and the queue agree), each with **Move up**, **Move down** and **Do next**, **Finished** and **Failed** (as in the header list, with Open and Dismiss, and **Clear finished**). Moving changes the queue's order; `schedule.ts` respects it (an explicit order beats the grouping of D21, and a target's own picture jobs still keep their order among themselves). Picture jobs already in ComfyUI can't be moved (ComfyUI has them); say so on them. With nothing held back (milestone 0 sends pictures at once), Waiting only has jobs still gathering quick clicks.
- **History:** finished work kept on the server, newest first, paged ("Show more"): picture jobs from the job log (`GET /api/picture-jobs?recent=1&limit=&before=`, every story, temporary jobs left out; a new option on the existing route, with an API test) with thumbnail, chapter and when; task 1.4 adds finished runs (`GET /api/ai-runs?finished=1`) with their counts and a link to the run page. Generates (milestone 5) aren't kept: their result is in the draft.
- **e2e:** with the fake ComfyUI, two jobs show as working and finished; Pause holds a new Queue click (nothing reaches ComfyUI) until Resume; Move up and Do next change the order the held jobs are sent in; History lists the jobs after a reload. Phone and desktop screenshots.
- **Check:** `npx tsc --noEmit`, `npx next build`, `npm test`, `node tests/run.mjs e2e queue-page picture-queue illustrate-comfy`.

**Then ship milestone 0.**

---

## Milestone 1: Fill open choices (ship to `main` when done)

### Task 1.1: server (no UI)

(Done in task 1.1. Choices made: `needsReview`'s flag is `options.reviewedDepths` (`reviewRun` adds the level it checked, so the runner doesn't stop there again); `reviewRun` takes `tasks: [{id, label?, direction?, remove?}]`; `getSubtree` depths are relative, chapters one level past the limit are stubs with `choices: []`; run lists carry `leased`, and `GET /api/ai-runs` needs `unfinished=1` or `finished=1`.)

**Files:** `src/lib/db.ts` (migration 31), `src/lib/aiRuns.ts` (new), `src/lib/stories.ts`, `src/lib/tree.ts`, `src/lib/limits.ts`, `scripts/adminCore.mjs`, new routes, `tests/api/ai-runs.test.mjs` (new), `tests/api/admin-cli.test.mjs`.

1. **Migration 31** (append to `MIGRATIONS` with a numbered comment like the others). The `mode` check already lists all four modes so later milestones need no table rebuild:
   ```sql
   CREATE TABLE ai_runs (
     id               TEXT PRIMARY KEY,
     story_id         TEXT NOT NULL REFERENCES stories(id),
     start_chapter_id TEXT,                   -- no FK (the admin script deletes chapters); null = whole story
     mode             TEXT NOT NULL CHECK (mode IN ('fill', 'tree', 'arc', 'pictures')),
     options          TEXT NOT NULL,          -- JSON RunOptions
     tasks            TEXT NOT NULL,          -- JSON RunTask[]
     status           TEXT NOT NULL CHECK (status IN ('ready', 'queued', 'running', 'review', 'paused', 'done', 'stopped')),
     review_depth     INTEGER,                -- the level whose plans wait for the owner (status 'review')
     finished_at      INTEGER,                -- for the queue page's History (D24)
     error            TEXT,
     version          INTEGER NOT NULL DEFAULT 1,
     lease_token      TEXT,
     lease_until      INTEGER,
     created_at       INTEGER NOT NULL,
     updated_at       INTEGER NOT NULL
   );
   CREATE INDEX ai_runs_story ON ai_runs(story_id, created_at);
   -- D3: the run that wrote a chapter (null = written by the owner) and when the owner marked it reviewed.
   ALTER TABLE chapters ADD COLUMN ai_run_id TEXT;
   ALTER TABLE chapters ADD COLUMN ai_reviewed_at INTEGER;
   ```
   Restart the dev server after adding it. Add `ai_run_id` and `ai_reviewed_at` to the `Chapter` type and every `SELECT` that builds one (grep `summary, path_summary` in `stories.ts`).
2. **Posting with the mark:** `NewChapterSchema` gets an optional `ai_run_id` (a run of the same story, else 400); `createChapter` stores it. Nothing else changes for the writing page.
3. **Mark reviewed:** `POST /api/chapters/[id]/reviewed` (sets `ai_reviewed_at` now), `POST /api/chapters/[id]/reviewed?path=1` (that chapter and every AI chapter on its root-to-chapter path), `POST /api/ai-runs/[id]/reviewed` (every chapter the run wrote). Each returns `{ marked: n }`. Functions in `stories.ts` (`markReviewed`, `markPathReviewed`) and `aiRuns.ts` (`markRunReviewed`).
4. **`scripts/adminCore.mjs` `deleteItem`:** deleting a story also deletes its `ai_runs`; deleting chapters deletes runs whose `start_chapter_id` is among them. (Foreign keys are on, so a story delete fails without this.) One case in `admin-cli.test.mjs`.
5. **`LIMITS`:** `runChapters: 200`, `runTasks: 2000`.
6. **`src/lib/aiRuns.ts`:** zod schemas for `RunOptions` and `RunTask` (all three task kinds; strings bounded by `LIMITS.label`, directions and guidance by `LIMITS.premise`, at most `LIMITS.runTasks` tasks), and:
   - `createRun({story_id, start_chapter_id, mode, options, tasks}) → { id }` (404 if the chapter isn't in that story).
   - `getRun(id)`; `listRuns(storyId, startChapterId?)`, newest first, each with task counts by status instead of the tasks.
   - `claimRun(id, token)`: takes the lease (2 minutes) when none is held, it ran out, or `token` holds it; else `PostError` 409 "This run is going in another tab or browser." Returns `{ version }`.
   - `updateRun(id, { token, version, tasks?, status?, review_depth?, error? })`: 409 if the lease isn't `token`'s or `version` differs; bumps `version`, renews the lease, sets `updated_at`; `review`/`paused`/`done`/`stopped` release the lease; `done`/`stopped` set `finished_at`.
   - `reviewRun(id, { version, tasks })`: the owner's edits to a run in `review` (only the `direction` and `label` of `todo` write tasks at `review_depth`, and removing them, which marks them `skipped`); sets it `queued` again. No lease needed (nothing is running it).
7. **The mark's state where chapters are listed** (D3a): a shared type `AiMark = null | "unreviewed" | "reviewed"` (null = written by the owner) and a helper `aiMarkOf({ai_run_id, ai_reviewed_at})`. `TreeNode` gets `ai: AiMark` (so the outline has it); `Choice` gets `child_ai: AiMark` (`getChoices` joins the child chapter's two columns), so the choice cards can show it.
   **`getSubtree(chapterId, maxDepth)`** in `tree.ts`: the chapter as a `TreeNode` with children down to `maxDepth` levels (reuse `getStoryTree`'s query and building; depths relative, start = 0).
8. **Routes** (check `node_modules/next/dist/docs/01-app/` for route handler `params` if unsure):
   - `GET /api/chapters/[id]/context` → `{ story: {id, title, premise, style}, path: getPath(id) as {id, revision, depth, title, body, summary, path_summary}[], codex: getContextCodex(id), choices: getChoices(id) }`; 404 when missing.
   - `GET /api/chapters/[id]/subtree?depth=N` (0–8, default 1).
   - `POST /api/ai-runs` → 201 `{ id }`; `GET` and `PATCH /api/ai-runs/[id]`; `POST /api/ai-runs/[id]/claim {token}`; `GET /api/stories/[id]/ai-runs?start=<chapterId>&mode=<mode>`.
   - `GET /api/ai-runs?unfinished=1`: every story's runs that are `queued`, `running`, `review` or `paused` (latest 50, with story title, start chapter title, task counts and whether the lease is held: `leased: boolean`), for the queue on opening the app.
   - `GET /api/ai-runs?finished=1&before=<finished_at>&limit=N`: finished and stopped runs, newest first, for the queue page's History (D24).
   - `POST /api/ai-runs/[id]/review {version, tasks}` → `reviewRun`.
9. **Tests** `tests/api/ai-runs.test.mjs` (setup copied from `tests/api/stories.test.mjs`): create, get and list a run; a second claim with another token is 409; a stale version is 409; `done` releases the lease; a chapter posted with `ai_run_id` is `"unreviewed"` (in the subtree and in its parent's choices' `child_ai`) until marked, then `"reviewed"`, and the path and run variants mark the right chapters; a chapter posted without it is `null`; a bad `ai_run_id` is 400; context and subtree shapes.

**Check:** shared code (db.ts, migration): `npx tsc --noEmit`, `npx next build`, `npm test`, and the whole browser suite (`E2E_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` in a cloud session).

### Task 1.2: types and the Fill planner (pure code; can run beside 1.1)

(Done in task 1.2, a separate commit. Choices made: `applyPlan(tasks, plan, guidance = "")`; `nextTask` returns `{task, tasks}`; `parseIdeas(text, max = 6)` takes a limit, use 12 for plan steps; `planFill` has its own minimal `PlanNode` tree type; depths in tasks are relative to the start chapter; `estimateFill` requests = chapters × 3 + plan tasks.)

**Files:** `src/lib/aiRuns/types.ts`, `src/lib/aiRuns/plan.ts`, `src/lib/ai/prompts.ts` (one addition), `tests/unit/ai-runs-plan.test.mts`, `tests/unit/prompts.test.mts`.

- `types.ts`: the shared types above (`ModelRef` from `settingsSchema`).
- **The plan prompt (D22):** `SYSTEM_PLAN_STEPS` and `planStepsPrompt(ctx, chapter, labels, add, contextTokens)` in `prompts.ts`, built like `ideasPrompt` (`storyHeader`, `CHOICE_QUALITY`): "Here is the chapter that was just written: … These choices are offered at its end: “a”, “b”. For each, say in one or two sentences what happens in the chapter it leads to, so the chapters differ in kind. Then suggest `add` new choices to offer as well, with what happens after each." Reply: a JSON array of `{choice, direction}`, the given labels first, in their order, unchanged. Read it with `parseIdeas`; `matchSteps(labels, ideas)` pairs them by order (and by text when the AI reordered), keeps the extras as new choices, and gives a given label with no plan an empty direction. With `add` only and no labels it replaces `choicesPrompt` for a new chapter's suggested choices.
- `planFill(tree, opts)`: for each chapter with unwritten choices (only the start chapter when `scope = "children"`, else every chapter in the tree), one `PlanTask` (`labels` = those choices, `add: 0`), then a write task per choice with `plannedBy` = that plan task, `slot: {kind: "choice"}`, `direction: ""` until planned, `choices: {given: [], suggest: endChoices}`, `expand: false`. Breadth first (by depth, then choice order).
- `applyPlan(tasks, planTask)`: copies each step's direction (with `withGuidance`) into the write tasks it planned; a new choice's step gets its `choiceId` once the runner has added it.
- `withGuidance(direction, guidance)`: joins the two with a blank line, either may be empty.
- `nextTask(tasks)`: the first `todo` task that can go. A `fromTask` slot needs that task `done`; `plannedBy` needs that plan task `done`; if either is `failed`/`skipped`, the dependent becomes `skipped` (return the updated list too).
- `needsReview(run)`: with `reviewPlan` on, true when every plan task at the next depth to write is done and its write tasks haven't been reviewed (keep a `reviewed` depth list on the run's options, or a flag per task; pick one and say which).
- `resolveSlot(task, tasks)` → `{ choiceId } | { parentChapterId, newLabel }`.
- `estimateFill(tree, opts)` → `{ chapters, requests }` (requests ≈ chapters × 3).
- `newTaskId(tasks)`.
- **Tests:** a hand-built tree with a written branch and unwritten choices at two depths: both scopes, breadth-first order, a plan task before each chapter's write tasks, the estimate (plan requests counted); `nextTask` waits for the plan and skips the dependents of a failed one, and of a failed `fromTask`; `resolveSlot` for all three slot kinds; `matchSteps` with the replies in order, reordered, with a missing plan and with extras; `planStepsPrompt` names every label and asks for `add` more.

**Check:** `npx tsc --noEmit`, `npm test`.

### Task 1.3: the runner (after 1.1 and 1.2)

(Done in task 1.3. Choices made: the runner and its parts take injectable `deps` (`fetch`, `stream`) so they are tested against a fake server and AI; `WriteTask` gained `parentChapterId` (set by `planFill`, so a task knows the chapter it continues from) and `planned`; a plan task fails (rather than writing without a plan) when its reply can't be read, while the plan for a chapter's new choices falls back to the given choices; `finish` only ends a run (status done/stopped/paused/queued) and `retryTask`/`skipTask` claim the lease themselves and leave the run paused for the caller to resume; in group mode, plans run when nothing can be written at the lowest open depth. Not tried against a real model.)

**Files:** `src/lib/aiRuns/writeChapter.ts`, `src/lib/aiRuns/runner.ts`, `src/lib/aiRuns/api.ts` (fetch helpers for the routes), `tests/unit/ai-runs-runner.test.mts`. Don't change `ChapterEditor.tsx` (sharing its code is a separate refactor; ask the owner first).

1. **`writeOneChapter(settings, { context, label, direction, choices, options, signal, onText, onStatus })`** → `{ title, body, choices: string[], summary?, path_summary? }`:
   - `StoryContext` from the `/context` reply: `choiceLabel: label`, `siblingChoices` = the parent's choice labels.
   - Path summaries as `prepareContext` in `ChapterEditor.tsx` does (a failure falls back silently).
   - `SYSTEM_CHAPTER` + `generatePrompt(ctx, direction, options.length ?? "medium", settings.contextTokens)`, `streamChat` with `role: "main"`, `model: options.model`; `parseChapterOutput`; no title → `label`; an empty body throws.
   - Choices and their plans (D22): `given`, plus `suggest` more, with one `planStepsPrompt` call (cheap model, `completeChat`, `matchSteps`): the given labels are planned and the new ones suggested with their plans together; drop blanks and repeats; at most `LIMITS.choices`. The plans are kept on the task (`planned`: `{label, direction}[]`, add it to `WriteTask`), so the children a later milestone expands into start from them. A failed call leaves just `given`, unplanned.
   - Summaries: `summarizeChapter` with `previous` = the parent's `path_summary`; a failure leaves them out.
2. **The runner works one step at a time** so the work queue (task 1.4) can put other work in between and give the machine to pictures: `claim(runId, token)`, `runNextStep(run, { settings, token, signal, onEvent }) → { run, more: boolean }` (does one step and saves the run), and `finish(run, status)`. Split `writeOneChapter` so each part can be called on its own: `writeText` (main model), `planNext` (choices and their plans), `summarize`. A **plan task** is one step: `GET /context` for the chapter, `planStepsPrompt` (cheap model), add any new choices (`POST /api/chapters/<id>/choices`, then `GET /context` for their ids), `applyPlan`, `done`. **Review (D23):** before writing a depth, if `needsReview(run)`, set the run `review` with `review_depth` and return `more: false`; the queue shows it as "Plan ready to check" and the run page's review (task 1.5) sends it back to `queued`. Later milestones add their task kinds to `runNextStep`.
   - The caller makes the token and claims the run; `runNextStep` sets `running` and renews the lease every 30 s while working.
   - **Models (D20)**, from `options.models`:
     - `"each"`: a step is a whole task, as described below (text, choices, summaries, post).
     - `"writing"`: the same, with `suggestModel` replaced by `model`, so every request uses the writing model.
     - `"group"` (default): a step is one request. While any `todo` task at the lowest depth with work left can be written, write it with the main model and post it **without** suggested choices or summaries (given choices only; status `written`). When none can, take the `written` tasks at that depth one by one with the cheap model: summaries (`PUT /api/chapters/<id>/summary`, as `BulkSummaries.tsx` does), then the planned choices (one `planStepsPrompt` call; `POST /api/chapters/<id>/choices` per new label, then `GET /context` for their ids), then `done`; plan tasks at that depth go in the same cheap-model phase. Then the next depth. A child is never written before its parent is `done`, so its prompt has the parent's summary.
   - `nextTask` picks the task. For a write task: `resolveSlot`; `GET /context` of the parent. **Don't write twice after a crash:** if the choice already has a chapter, or (new slot) the parent has a written choice with that label, mark the task done with that chapter. Otherwise `writeOneChapter`, then `POST /api/chapters` with `choice_id` (or `parent_chapter_id` + `new_choice_label`), `choices`, the summaries, `codex_changes: []` and `ai_run_id`. A 409 "already written" counts as done (read `/context` again for the id).
   - After each task: set `done`, `chapterId`, `choiceIds`, then `PATCH` the run.
   - A failure: try the task once more; a second failure marks it `failed` with the error, pauses the run and returns. Stop (abort) pauses. No `todo` left → `done`.
   - `onEvent`: task started, streamed text, status lines, task done, paused/done, errors.
   - `retryTask(runId, taskId)` (failed → todo) and `skipTask` (→ skipped) PATCH the run.
3. **Unit test** with a fake `fetch` and fake AI replies (see `tests/unit/ai-client.test.mts` for faking the client): two fill tasks post two chapters with `ai_run_id`; a task left `todo` after its chapter was posted isn't posted again; an AI call failing twice pauses the run with the task failed; with `"group"` the requests go main, main, cheap, cheap… (record the model of each fake call); with `"writing"` every call uses the writing model; a `written` task left after a reload gets its summaries and choices, not a second chapter; a fill run's chapter prompts contain the planned direction; with `reviewPlan` the run stops in `review` after the plans and goes on after `reviewRun`, using the edited directions.

**Check:** `npx tsc --noEmit`, `npm test`.

### Task 1.4: writing in the work queue, and taking turns (after 1.3 and milestone 0)

(Done in task 1.4. Choices made: run items are kept apart from the picture list in the provider and joined in `items`; `GET /api/ai-runs?unfinished=1` rows now carry `chapters: {done, total}` for “12 of 39”; the queue page lists runs too; a header count part for runs in another tab (`↗`); the test hook is `window.__storytimeQueue`, set when `window.__STORYTIME_TEST__` is set before the app loads; the header's run row links to `/c/<start>/write-ahead?run=<id>`, which task 1.5 builds. The `Generate` item (D16, milestone 5) isn't there yet, so writing is runs only.)

**Files:** `src/components/WorkQueue.tsx`, `src/components/WorkQueueStatus.tsx`, `src/lib/workQueue/schedule.ts`, `docs/illustrate.md` (the picture queue bullet: how pictures now wait their turn), `src/app/globals.css`, `tests/unit/work-queue-schedule.test.mts`, `tests/e2e/work-queue.e2e.mjs` (new).

1. **Run items:** `{type: "run", runId, storyTitle, startTitle, mode, done, total, current?: label, state: "waiting" | "working" | "paused" | "done" | "failed" | "elsewhere", error?}`, in memory beside the picture jobs (`WorkItem` in `WorkQueue.tsx`; `jobsRef`/`update` hold only picture items today, so widen them to `WorkItem` and keep `usePictureQueue()` filtering to pictures); milestone 5 adds `{type: "generate", ...}`.
2. **API** on `useWorkQueue()`: `startRun(runId)` (adds it, sets the run `queued` on the server, claims it when its turn comes), `stopRun(runId)` (aborts the current request; the run is `paused`), `resumeRun(runId)`, `dismiss(id)` (shared with picture jobs), `listenRun(runId, listener) → unsubscribe` (the run page gets streamed text, status lines and task updates while it is open). Errors and pauses stay on the item for the header.
3. **The schedule** (`schedule.ts`, pure, unit-tested; the provider does what it says):
   - **Writing among itself (D16):** one writing step at a time: the oldest waiting `generate` first, else the oldest waiting run, which does one `runNextStep` and goes back in line.
   - **Writing and pictures (D18):** with `sharing: "together"`, writing goes on and picture jobs are sent to ComfyUI as soon as asked (as today). With `"turns"`, the machine belongs to one kind at a time: **pictures** while any of our jobs is in ComfyUI (sent and not finished); **writing** while a writing step runs. A gathered picture job is held in StoryTime ("Waiting its turn" on its place and in the header) while writing has the machine, and writing waits while pictures have it.
   - **Switching (D19):** when one kind has the machine and the other has waiting work, the holder keeps it until its batch limit (`switchMinutes` since it took the machine, or `switchItems` writing steps / picture jobs, whichever comes first) or until it has nothing waiting; then it finishes what is in flight (the writing step; the jobs already in ComfyUI) and the other kind takes over. Picture jobs asked for meanwhile wait unless pictures hold the machine. With only one kind waiting, it just goes on.
   - **Grouping pictures (D21):** when held jobs are released, `groupPictures` sends those of the last-sent drawing preset first, keeping each target's order.
   - Unit tests for each rule, with a fake clock.
4. **On opening the app** (and when it comes back into view, at most every 10 s, as the picture queue already checks ComfyUI): `GET /api/ai-runs?unfinished=1`. Runs not in this tab's list are added: `leased` ones as "elsewhere" ("Running in another tab or browser", Open only), the others as "paused" with **Resume**. Nothing starts by itself. A picture job found running in ComfyUI on opening counts as pictures holding the machine.
5. **Header** (the one queue button, D17): writing items join the list, newest first with the picture jobs: the story and start chapter, the mode in words ("Fill open choices"), "12 of 39", the current choice, Stop / Resume / Open (the run page) / Dismiss. The button's count and the tab title count both kinds. When turns are on and something is held, a line at the top of the list says which kind has the machine and why ("Writing until 14:20, then 3 pictures").
6. **Closing the tab** while writing is working or pictures are held asks first (`beforeunload`, as `ChapterEditor.tsx` does).
7. **e2e** `tests/e2e/work-queue.e2e.mjs` with a slow fake AI and the fake ComfyUI (`tests/e2e/fakeComfy.mjs`): a run started through the API and `startRun` (the run page comes in task 1.5; use a small test hook only if there is no other way, and say so) keeps going when moving to another page; two runs go one after the other; Stop then Resume; after a reload the run shows as paused; a second tab shows it as elsewhere. Turns: with a run writing, a Queue click on the Illustrate page is held (ComfyUI gets nothing) until the batch limit (set `switchItems` to 1 for the test), then the picture goes and the next chapter waits for it; with `"together"` both go at once.

**Check:** shared code: the whole browser suite (picture tests included), `npx tsc --noEmit`, `npx next build`, `npm test`, phone and desktop screenshots of the header list with a run and a held picture in it.

### Task 1.5: the page and the review mark (after 1.4)

**Files:** `src/app/c/[id]/write-ahead/page.tsx` (new), `src/components/WriteAhead.tsx` (new, the form), `src/components/AiRunProgress.tsx` (new, shared by milestone 4), `src/components/AiReviewNotice.tsx` (new), `src/components/AiMark.tsx` (new), `src/app/c/[id]/page.tsx`, `src/app/s/[id]/outline/page.tsx`, `src/lib/settingsSchema.ts`, `src/app/globals.css`, `tests/e2e/write-ahead.e2e.mjs` (new).

Split this task in two commits if it gets large: first the marks (items 1 and 2, testable with chapters posted through the API with `ai_run_id`), then the page.

1. **The mark** (D3a). `AiMark.tsx`: a robot icon as inline SVG (draw it to match the line icons in `PictureIcons.tsx`: same viewBox, stroke width and `currentColor`), taking `mark: AiMark` and rendering nothing for null; `"unreviewed"` filled in the accent colour, `"reviewed"` an outline in the muted colour; `role="img"` with the two titles as its accessible name. Use it:
   - On the chapter page, in the meta line beside the date.
   - On each written choice card under "What happens next?" (`choice-written` links in `src/app/c/[id]/page.tsx`), from `child_ai`.
   - In the outline: a new part `aiWritten` in `OutlineOptions`, `OUTLINE_PARTS` (label "AI-written", hint "a robot on chapters the AI wrote by itself, filled until you mark them reviewed") and `DEFAULT_OUTLINE` (on). Check that settings saved before this, which have no `aiWritten`, read it as on (see how the schema fills the other parts). Shown in the outline's `[...]` section like the other parts (look at how `review` is done in `src/app/s/[id]/outline/page.tsx`). `settingsSchema.ts` is shared code, so run the whole browser suite.
2. **Review on the chapter page:** for an unreviewed AI chapter, `AiReviewNotice` at the top: "Written by AI, not reviewed yet." with **Mark reviewed** and, when chapters above it on the path are unreviewed too, **Mark this path reviewed**; after marking, `router.refresh()` (the notice goes, the robot turns to the reviewed look). A **Write ahead with AI…** item in `PageMenu` (D2).
3. **Page `/c/<id>/write-ahead`** (`?run=<id>` shows that run): crumbs back to the chapter, heading "Write ahead with AI", the chapter's title. Loads the story, the subtree (depth 8), and earlier runs from this chapter. An unfinished run is offered first: "A run from here is unfinished: 12 of 39 written. Resume / Stop it".
4. **Form** (`WriteAhead.tsx`), built so milestones 2 and 3 can add their modes as more options in the same picker (radio group "What to write"): for now only **Fill open choices**: "This chapter's open choices (k)" or "Every open choice below this chapter (m)". With none, say so. **Settings for every chapter** (a `<details>`, closed): Length (default medium), Writing model and Model for choices and summaries (`ModelPicker`, as on the writing page), Guidance for every chapter (textarea), Choices on each new chapter (0–6, default 3), **Models** (D20: "Group by model, fewer model loads" (default), "Use the writing model for everything", "One chapter at a time"). **Estimate:** "Writes 7 chapters, about 21 AI requests, one at a time." Over 20 asks to confirm; over the limit the button is off with the reason. A `PromptButton` ("View prompt") for the first chapter's prompt. Starting: `planFill`, `POST /api/ai-runs`, `router.replace(?run=<id>)`, `useWorkQueue().startRun(id)`. With another item working, the run shows "Waiting its turn (1 ahead)".
5. **Progress** (`AiRunProgress.tsx`): a view of the queue's item (`listenRun`), falling back to the run as saved on the server when this tab's queue doesn't have it. "3 of 7 written. Now: “Run away”", the status line, a collapsible live preview, **Stop** / **Resume** (through the queue), and the task list (written ones link to `/c/<id>`; failed ones show the error with **Try again** / **Skip**). A note: "This runs in this browser tab: you can use other pages of StoryTime meanwhile, but keep the tab open. On a phone, keep the screen on." While the queue is working, it asks for a screen wake lock (`navigator.wakeLock.request("screen")` in try/catch, released when idle; put this in the provider, task 1.4, if it isn't there yet). A paused run doesn't restart by itself on load. Done: "Wrote 7 chapters, marked not reviewed. Mark all reviewed · Open in outline", and the D9 note. Each task in the list shows its planned "what happens" under its choice text.
5a. **Checking the plan (D23):** the form has a **Let me check the plan first** checkbox (off). A run in `review` shows "The plan for the next N chapters is ready" and, per chapter, its choice text and what happens as editable boxes with a ✕ to leave it out, then **Continue** (`POST /api/ai-runs/<id>/review`, then `resumeRun`). The queue's list says "Plan ready to check" with Open.
6. **e2e** `tests/e2e/write-ahead.e2e.mjs` with its own fake AI on port 3222 (copy the server from `tests/e2e/chapters.e2e.mjs`); `useMockAi` and `restore()` at the end. Cover: Fill on a chapter with two unwritten choices writes both, and the chapter page then shows both as written, each card with the unreviewed robot; the new chapter shows the notice and the robot in its meta line, and the outline shows the robot; Mark reviewed removes the notice and turns the robot to the reviewed look in all three places; unticking AI-written in Settings › Outline hides it in the outline only; a chapter the owner wrote has no robot; Stop, reload, Resume finishes without duplicates; with Let me check the plan first, the run stops with the plans, an edited plan's text reaches the chapter prompt (check the fake AI's received prompt), and a removed one isn't written.

**Check:** settings schema changed, so: `npx tsc --noEmit`, `npx next build`, `npm test`, the whole browser suite, and screenshots (`node tests/shot.mjs`) of the form, a run in progress, a parent chapter with an AI choice card, an unreviewed chapter and the outline, at desktop and phone width; describe them (is the robot readable at phone width, do the two looks differ clearly).

**Then ship milestone 1.**

---

## Milestone 2: Grow the tree (ship when done)

### Task 2.1: planner and prompt

**Files:** `src/lib/ai/prompts.ts`, `src/lib/aiRuns/plan.ts`, `tests/unit/ai-runs-plan.test.mts`, `tests/unit/prompts.test.mts`.

- `planTree(tree, opts)` (depth D, breadth B): walk existing chapters at depth 0…D-1. For each, take its choices in order, written ones first, up to B. If it has unwritten ones among those B, or fewer than B choices, a `PlanTask` (`labels` = the unwritten ones, `add` = B minus its choice count, at least 0). A write task (depth = chapter depth + 1) per unwritten choice among those B, `plannedBy` that plan task, with `choices: {given: [], suggest: depth + 1 < D ? B : endChoices}` and `expand: depth + 1 < D`. Recurse into the written ones among those B. Choices past the first B are left alone.
- `expandAfter(task, result)`: for a done write task with `expand`, a write task per returned choice id, each with its plan from the task's `planned` (D22) as `direction`; for a done `PlanTask` with `add > 0`, write tasks for the choices it added, with their plans. Same rules as `planTree`.
- `estimateTree(tree, opts)`: includes what `expandAfter` will add (per level, B × the chapters at the level above, minus what exists). D=3, B=3 from a bare chapter is 39.
- **Tests:** the planner on a tree with one written branch and a chapter with 1 choice when B = 3 (a plan task with `add: 2`); the estimates; `expandAfter` stops at depth D and carries each child's plan as its direction.

### Task 2.2: runner and form

**Files:** `src/lib/aiRuns/runner.ts`, `src/components/WriteAhead.tsx`, `tests/unit/ai-runs-runner.test.mts`, `tests/e2e/write-ahead.e2e.mjs`.

- Runner: after a task is done, append `expandAfter(...)` before saving; refuse to go past `LIMITS.runChapters` write tasks (stop with a message). Plan tasks with `add` already work (task 1.3); check the new choices stop at `LIMITS.choices`.
- Form: **Grow the tree** in the picker: Depth (1–8, default 3), Choices per chapter (1–6, default 3), "Keeps the chapters and choices already there.", Choices on the last chapters (the D5 setting), the estimate.
- e2e: depth 2, 2 choices from a bare chapter writes 6 chapters; a 6 × 8 tree is refused by the estimate.

**Check:** as task 1.5, then **ship milestone 2.**

---

## Milestone 3: Reach a goal (ship when done)

### Task 3.1: prompts and planner

**Files:** `src/lib/ai/prompts.ts`, `src/lib/aiRuns/plan.ts`, unit tests.

- `SYSTEM_ARC_PLAN` and `arcPlanPrompt(ctx, objective, chapters, contextTokens)`: uses `storyHeader` like `ideasPrompt`; asks for exactly `chapters` steps from the end of the last chapter to the objective, each `{"choice": button text under 12 words for the choice that leads into that chapter, "direction": one or two sentences on what happens in it}`; only the last step reaches the objective; reply with only a JSON array. Read the reply with `parseIdeas`.
- `arcDirection(objective, step, index, total, nextChoice?)`: "This chapter is part N of M of a stretch of the story heading toward: <objective>. In this chapter: <direction>." Before the last: "Don't reach that goal yet; end where “<nextChoice>” is a natural next step." The last: "This chapter reaches that goal."
- `planArc(startChapterId, steps, opts, startChoice?)`: t1's slot is `{kind: "choice"}` when the owner picked an existing unwritten choice (its label replaces step 1's), else `{kind: "new", parentChapterId, label: steps[0].choice}`; task k > 1 is `{kind: "fromTask", taskId: t(k-1), choiceIndex: 0}`. Choices `{given: [steps[k].choice], suggest: alternatives}`, the last `{given: [], suggest: endChoices}`. `expand: false`. Direction from `arcDirection` + `withGuidance`.
- **Tests:** the chain links t2 to t1's choice 0; `arcPlanPrompt` names the objective and the count; `arcDirection` wording for middle and last.

### Task 3.2: form

**Files:** `src/components/WriteAhead.tsx`, `tests/e2e/write-ahead.e2e.mjs`.

- **Reach a goal** in the picker: Goal (textarea), Chapters (`NumberInput` 1–20, default 3), Start with: a new choice (default) or one of this chapter's unwritten choices. **Plan the chapters** (main model, with a `PromptButton`) shows the steps as editable rows (choice text, what happens, remove; **Plan again**); **Write N chapters** starts the run. Other choices along the way (D6).
- e2e: the fake AI answers the plan prompt with a JSON array of `{choice, direction}`; a 2-chapter goal shows an editable plan and writes a chain of 2, the second under the first's choice.

**Check:** as task 1.5, then **ship milestone 3.**

---

## Milestone 4: Fill missing pictures (its own page; after milestone 1, since it uses the runs and the work queue)

Read `docs/illustrate.md` before starting (`CLAUDE.md` requires it) and add a bullet to it describing this feature in the same change.

**Where:** a story page `/s/<id>/pictures` ("Make missing pictures"), in the story's menu, and `/s/<id>/pictures?from=<chapter>` from a **Make missing pictures…** item in the chapter page's ☰ menu (scope: this chapter and everything below it). A finished write-ahead run links to it for its chapters (`?run=<id>`: only the chapters that run wrote).

### Task 4.1: planner and page

**Files:** `src/lib/aiRuns/plan.ts` (`planPictures`), `src/app/s/[id]/pictures/page.tsx`, `src/components/MissingPictures.tsx`, the menu items, `AiRunProgress.tsx` (picture rows), tests.

- `planPictures(chapters, opts)`: chapters (with their saved header and footer versions, from `chapterImageVersions`) in outline order (parents first), one `PictureTask` per missing slot chosen (D11).
- The form: Scope (whole story / from a chapter / a run's chapters), Slots (Header, Footer, Both; default Header), **Use reference pictures** (off; D12) with a line saying the preset must support them, Model for prompts (`ModelPicker`, cheap). The estimate: "Makes 14 pictures, one at a time, with 14 prompt requests." Start creates a run with `mode: "pictures"`, `start_chapter_id` null for the whole story. Progress uses `AiRunProgress`, showing a thumbnail per finished task linked to the chapter's Illustrate page.

### Task 4.2: the picture runner

**Files:** `src/lib/aiRuns/pictures.ts` (new), `src/lib/aiRuns/runner.ts`, possibly `src/components/PictureQueue.tsx`, tests.

For each `PictureTask`:
1. Skip it (done) if the slot already has a picture (it was made by hand meanwhile).
2. **Prompt:** `writeImagePrompt` (`src/lib/ai/imagePrompt.ts`) with the chapter's path and codex from `/context`, `moment` start for a header and end for a footer, `direction: ""`, the chapter's drawing preset's `promptStyle` and its always-include text as `fixed` (see `picture-preset` and `picture-fixed` routes). Save the result as that moment's prompt boxes (`PUT /api/chapters/:id/picture-draft`) so the Illustrate page shows what was used.
3. **Job:** build the `JobInput` exactly as `ComfyGenerate.ask` does for one picture of a text-to-image job (`grep -n "ask" src/components/ComfyGenerate.tsx`): `combinePrompts` of the preset prompt, the always-include text and the prompt, the story's art style (`withArtStyle`), the preset's negative, the chapter's or story's preset (`drawPresetFor`), its LoRAs, the family check, size from settings, count 1, no starting picture, no edit. References only when `useRefs` is on and the preset can use them (`ipAdapterProblem`, `describeWorkflow(...).refs`): the story's style picture, and for a footer the chapter's saved header; otherwise none and no error. Factor the shared part out of `ComfyGenerate` only if it is small and the Illustrate tests still pass; otherwise write a separate builder and say so in the commit.
4. Send it through the app's picture queue (`usePictureQueue().ask`) so it is recorded in the job log and shows in the header. Route its pictures back to the runner the way the Refine screen does (`JobInput.session` = `pictures:<run id>`, `listenSession`), not marked temporary. Wait for it. The picture run is a run item in the work queue, and its steps are of two kinds for the schedule (task 1.4): the prompt (step 2) is **writing** (an AI request), the job is **pictures**. So with turns on, a picture run writes a batch of prompts while writing has the machine and draws them while pictures have it, rather than switching every picture: let the runner write prompts ahead (up to the batch limit) and keep them on the tasks (`prompt`, `negative` fields on `PictureTask`), then send the jobs together, grouped by preset (D21).
5. **Save** the picture as the slot, as `usePictureSaver` does (`PUT /api/chapters/:id/images/:slot?job=<id>&index=0` with the image), which also pins it. Store `jobId` on the task.
6. A failure (AI, ComfyUI, the save) retries once, then pauses the run with the error, as for chapters. On resume after a reload, a task whose job finished while the page was closed may make a second picture; accept that and note it in `docs/illustrate.md`.

**Tests:** unit tests for `planPictures` and the job input builder; e2e `tests/e2e/missing-pictures.e2e.mjs` with the fake ComfyUI (`tests/e2e/fakeComfy.mjs`) and fake AI: a story of three chapters, one with a header, fills the other two headers; Both fills footers too; the references box off sends no IP-Adapter nodes; Stop and Resume. Run the `illustrate-*` and `picture-queue*` browser files too if `ComfyGenerate` or `PictureQueue` changed.

**Check:** as task 1.5 plus those files, then **ship milestone 4.**

---

## Milestone 5: the writing page's Generate in the queue (ship when done; any time after milestone 1)

Today **Generate chapter** on the writing page (`runAi("generate")` in `src/components/ChapterEditor.tsx`) streams into the page's own state, so leaving the page stops it. Move that one action into the work queue (D15) so it finishes into the draft wherever the owner goes. Revise and passage rewrites stay as they are. `ChapterEditor.tsx` is large: grep for the functions named here and read only those parts (`CLAUDE.md`).

### Task 5.1: applying a generated chapter to a draft (pure code)

**Files:** `src/lib/generatedDraft.ts` (new), `tests/unit/generated-draft.test.mts` (new), `src/components/ChapterEditor.tsx` (use it).

- `applyGenerated(draft, { title, body }) → Draft`: exactly what the page does now when a Generate starts and streams (`pushUndo`, `startVersion`, then title and body). Move `pushUndo` and `startVersion` (and `MAX_VERSIONS`, `MAX_UNDO`) out of the component into this file and have the component import them, with no change in behaviour.
- `applyAfterGenerate(draft, { choiceLabel?, suggestions? })`: sets `newChoiceLabel` only when it is still empty, and `suggestions` only when the author has no choices typed (the rules in `runAi`).
- **Tests:** a draft with text keeps it as the previous version and in undo; an empty draft doesn't add an empty version; the choice text and suggestions rules.
- **Check:** `npx tsc --noEmit`, `npm test`, `node tests/run.mjs e2e chapters drafts` (the editor's behaviour mustn't change).

### Task 5.2: Generate through the queue (after 5.1)

**Files:** `src/components/WorkQueue.tsx`, `src/components/WorkQueueStatus.tsx`, `src/lib/workQueue/schedule.ts`, `src/components/ChapterEditor.tsx`, `tests/e2e/work-queue.e2e.mjs`. A Generate is a writing step for the schedule (D18, D19), so with turns on it can wait for pictures; the writing page then shows "Waiting for pictures to finish (2 left)" with Stop.

1. **Queue item** `{type: "generate", key: draftKey, href: resumeHref, label: draftLabel, request: PromptParts, model, context: StoryContext, after: {choiceText: boolean, suggestChoices: boolean}, text: string, state}`, in memory like the runs. `generate(item)`, `stopGenerate(key)`, `listenDraft(key, {onText, onDone, onError}) → unsubscribe` (a listener that joins late first gets the text so far). It goes before waiting runs (D16).
2. **Doing it:** `streamChat` as `runAi` does now; then, as `runAi` does, the choice text (`fillChoiceText`'s request, cheap model) when `after.choiceText`, and the suggested choices (`choicesRequest`) when `after.suggestChoices`. Move the request builders the queue needs out of the component if they are tied to its state (pass `ready` context and the draft in).
3. **Who saves the draft:** while the writing page for that draft is open and listening, the page applies the text to its own state as now and its autosave saves it; the queue doesn't save. When no page is listening (the owner left, or never came back), the queue saves: `getDraft(key)`, `applyGenerated` with the text so far, `saveDraft` with the `updatedAt` it read, every 3 s while streaming and at the end, then `applyAfterGenerate` when those finish. On `DraftConflict` it reads the draft again and re-applies once; a second conflict stops with an error on the item ("The draft was changed elsewhere; the generated text is kept in the list" with Copy text). A page that opens mid-stream loads the draft and then listens, so it shows the text so far and the rest as it comes.
4. **The page:** `runAi("generate")` hands the request to the queue instead of streaming itself, and listens; the Stop button stops the queue item; the busy state follows the item, including when the page opens on a draft that is still generating ("Generating…" with Stop). Nothing else on the page changes. Leaving the page no longer warns about losing a Generate (the queue's own `beforeunload` covers closing the tab).
5. **Header:** the item shows as "Writing “<draft label>”…" with Stop, then "Ready" with **Open** (the draft's `href`) and Dismiss; a failed one with its error.
6. **e2e** (slow fake AI): Generate, go to the story list mid-stream, the header shows it working; come back: the draft has the whole chapter, the previous text as the earlier version, and the choice text filled; Generate, stay on the page: works as today (the `chapters` and `drafts` browser files must still pass); a Generate waits for no run: with a run going, it goes next.

**Check:** `npx tsc --noEmit`, `npx next build`, `npm test`, `node tests/run.mjs e2e chapters drafts work-queue write-ahead`, screenshots of the writing page while generating and of the header list, desktop and phone. Then **ship milestone 5.**

---

## Later (ask the owner first)

- Revise and passage rewrites through the work queue too.
- Other AI work through the queue (writing picture prompts on the Illustrate page, Find tags, codex scans), so it takes turns too. Until then those requests don't wait for pictures.

- Codex: run the codex scan (`src/lib/ai/codexAi.ts`) on each written chapter and keep its proposals for review.
- An in-app "delete the chapters this run wrote" (the app has no delete, on purpose; today it is `scripts/admin.mjs delete chapter <id> --yes`).
- Two requests at once for providers that allow it.
- Make missing pictures automatically at the end of a write-ahead run (a checkbox on the write-ahead form).

## Not verifiable in a cloud session

Real model output, long runs on a phone with the screen off, a real ComfyUI, and the NAS. Owner's manual check after each milestone: on the NAS, start a small run (Fill on a chapter with two open choices; Grow the tree depth 2 × 2; a 2-chapter goal; missing headers on a short branch), reload halfway, press Resume, and check nothing is written or drawn twice.
