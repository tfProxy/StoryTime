# Write ahead: the AI writes several chapters (implementation plan)

A plan for agents to build in stages. Each stage is one commit, can be checked on its own, and lists the files it owns. Read `CLAUDE.md` and `AGENTS.md` first and follow them (Edit/Write tools only, the Verification rules, one logical change per commit, no push unless asked).

## What the owner asked for

From a chapter, the AI writes many chapters without the owner writing each one:

1. **Reach a goal** (`arc`): the owner says what should happen ("Mira escapes the city and finds her brother") and in how many chapters. The AI plans the steps, the owner can edit the plan, then the AI writes that chain of chapters.
2. **Fill open choices** (`fill`): every unwritten choice on this chapter (or anywhere below it) gets its chapter written.
3. **Grow the tree** (`tree`): fill the tree below this chapter to a depth (say 5) with a number of choices per chapter (say 3 or 4), counting what is already there, writing every chapter needed.

## Decisions (defaults chosen; the owner can change them before stage 4)

| # | Question | Default in this plan |
|---|---|---|
| D1 | Where it starts | The chapter reading page `/c/<id>`: a **Write ahead with AI…** item in its page menu, and a secondary button of the same name beside "Write a new choice" under "What happens next?". It opens a new page `/c/<id>/write-ahead`. |
| D2 | Post chapters straight away, or as drafts to review? | Post straight away (that is the point of the feature). Each run lists the chapters it wrote, with links. The app never deletes chapters; removing a run's chapters stays with `scripts/admin.mjs delete chapter <id> --yes`. |
| D3 | What "suggested" branches are in Fill | Unwritten choices (choices with no chapter yet). Ideas from the writing page's Brainstorm that were never added as choices are not included. |
| D4 | Choices on the last chapters written | 3 unwritten choices suggested by the AI (0–6, a run setting), so the story doesn't end there. |
| D5 | Choices along a Reach a goal chain | Only the next step's choice. A setting "Other choices along the way" (0–3, default 0) adds unwritten AI-suggested alternatives. |
| D6 | Size limits | At most 200 chapters per run (`LIMITS.runChapters`), depth 1–8, choices per chapter 1–6, Reach a goal 1–20 chapters. Over 20 chapters asks to confirm. |
| D7 | Requests at once | One at a time (a local Ollama can't run several). |
| D8 | Codex | Not updated by a run. The run page says so and links each chapter's "Review codex for this chapter". |

## How it works

- **AI calls run in the browser** (`src/lib/ai/client.ts`; keys never reach the server), so a run only advances while its page is open. To survive a reload, closed tab or crash, the **plan of a run is kept on the server** (`write_runs`) and the page resumes it.
- A run is a **list of tasks**. A planner (pure functions) turns the owner's choices into tasks; one **runner** does them in order and, in Grow the tree, adds new tasks as chapters are posted. All three modes share the runner.
- Each written chapter is posted with the existing `POST /api/chapters` exactly as the writing page posts one (title, body, choices, summary, path_summary), so it is an ordinary chapter afterwards.
- Writing one chapter reuses the writing page's steps from `ChapterEditor.tsx` without its UI: make sure older path summaries exist (`neededSummaryIndex` + `ensurePathSummaries`), `generatePrompt` with `SYSTEM_CHAPTER` streamed through `streamChat` (main model), `parseChapterOutput`, choices with `choicesPrompt` (cheap model), then `summarizeChapter` (cheap model; a failure doesn't stop the post, as in `post()`).
- Chapter counts in Grow the tree add up fast: 3 choices × 5 levels is 3 + 9 + 27 + 81 + 243 = 363 chapters, about 3 AI requests each. The form shows the count before starting and refuses over the limit.

## Shared types (stage 2 creates `src/lib/writeAhead/types.ts`; stage 1 imports it for validation)

```ts
export type RunMode = "arc" | "fill" | "tree";

/** Where a task's chapter goes. */
export type Slot =
  | { kind: "choice"; choiceId: string }                       // an existing unwritten choice
  | { kind: "new"; parentChapterId: string; label: string }    // a new choice on an existing chapter
  | { kind: "fromTask"; taskId: string; choiceIndex: number }; // the n-th choice an earlier task's chapter was posted with

export type TaskStatus = "todo" | "done" | "failed" | "skipped";

export type WriteTask = {
  kind: "write";
  id: string;            // "t1", "t2", … unique in the run
  slot: Slot;
  label: string;         // the choice text (shown, and sent as "The reader chose")
  direction: string;     // what happens in this chapter; "" leaves it to the AI
  depth: number;         // 1 = a child of the start chapter
  /** The new chapter's choices: `given` first (in order), then `suggest` more from the AI. */
  choices: { given: string[]; suggest: number };
  /** Grow the tree: queue a task for each of the new chapter's choices while depth < maxDepth. */
  expand: boolean;
  status: TaskStatus;
  chapterId?: string;    // set when done
  choiceIds?: string[];  // from POST /api/chapters, same order as the choices sent
  error?: string;
};

/** Grow the tree, on a chapter that already exists: add AI-suggested choices until it has `want`. */
export type ChoicesTask = {
  kind: "choices";
  id: string;
  chapterId: string;
  depth: number;         // the chapter's depth below the start (0 = the start chapter)
  want: number;
  status: TaskStatus;
  error?: string;
};

export type RunTask = WriteTask | ChoicesTask;

export type RunOptions = {
  length: "short" | "medium" | "long";
  model: ModelRef | null;        // writing model; null = the default main model
  suggestModel: ModelRef | null; // choices and summaries; null = the default cheap model
  guidance: string;              // added to every chapter's direction ([bracket notes] allowed)
  endChoices: number;            // D4
  // arc
  objective?: string;
  chapters?: number;
  alternatives?: number;         // D5
  // fill
  scope?: "children" | "below";
  // tree
  maxDepth?: number;
  breadth?: number;
};

export type RunStatus = "ready" | "running" | "paused" | "done" | "stopped";

export type WriteRun = {
  id: string;
  story_id: string;
  start_chapter_id: string;
  mode: RunMode;
  options: RunOptions;
  tasks: RunTask[];
  status: RunStatus;
  error: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};
```

## Stage 1: server (one agent; no UI)

**Files:** `src/lib/db.ts` (migration 31), `src/lib/writeRuns.ts` (new), `src/lib/tree.ts` (add `getSubtree`), `src/lib/limits.ts`, `scripts/adminCore.mjs`, new routes below, `tests/api/write-runs.test.mjs` (new), `tests/unit/migrations.test.mts` only if it needs it.

1. **Migration 31** (append to `MIGRATIONS`, with a numbered comment like the others):
   ```sql
   CREATE TABLE write_runs (
     id               TEXT PRIMARY KEY,
     story_id         TEXT NOT NULL REFERENCES stories(id),
     start_chapter_id TEXT NOT NULL,          -- no FK: the admin script deletes chapters
     mode             TEXT NOT NULL CHECK (mode IN ('arc', 'fill', 'tree')),
     options          TEXT NOT NULL,          -- JSON RunOptions
     tasks            TEXT NOT NULL,          -- JSON RunTask[]
     status           TEXT NOT NULL CHECK (status IN ('ready', 'running', 'paused', 'done', 'stopped')),
     error            TEXT,
     version          INTEGER NOT NULL DEFAULT 1,
     lease_token      TEXT,
     lease_until      INTEGER,
     created_at       INTEGER NOT NULL,
     updated_at       INTEGER NOT NULL
   );
   CREATE INDEX write_runs_story ON write_runs(story_id, created_at);
   ```
   Restart the dev server after adding it (CLAUDE.md).
2. **`scripts/adminCore.mjs` `deleteItem`:** deleting a story also deletes its `write_runs`; deleting chapters deletes runs whose `start_chapter_id` is among them. (Foreign keys are on, so a story delete fails without this.) Extend `tests/api/admin-cli.test.mjs` with one case.
3. **`LIMITS`:** add `runChapters: 200`, `runTasks: 2000`.
4. **`src/lib/writeRuns.ts`:** zod schemas for `RunOptions` and `RunTask` (match the types; strings bounded by `LIMITS.label`, `LIMITS.body` for direction/guidance/objective at most `LIMITS.premise`), and:
   - `createRun({story_id, start_chapter_id, mode, options, tasks}) → { id }` (404 if the chapter isn't in that story).
   - `getRun(id)`, `listRuns(storyId, startChapterId?)` (newest first; each with counts of tasks by status, not the tasks).
   - `claimRun(id, token)`: takes the lease (2 minutes) when none is held, it has run out, or `token` already holds it; else `PostError` 409 "This run is going in another tab or browser." Returns `{ version }`.
   - `updateRun(id, { token, version, tasks?, status?, error? })`: 409 if the lease isn't `token`'s or `version` differs; bumps `version`, renews the lease, sets `updated_at`. Status `paused`/`done`/`stopped` releases the lease.
   Use `PostError` and `handlePost` as the other routes do.
5. **`getSubtree(chapterId, maxDepth)`** in `tree.ts`: the chapter as a `TreeNode` with children down to `maxDepth` levels (reuse the query and building in `getStoryTree`; depths in the result are relative, start = 0). Add `body`-free fields only; each choice keeps `id`, `label`, `child`.
6. **Routes** (read `node_modules/next/dist/docs/01-app/` for route handler `params` if unsure):
   - `GET /api/chapters/[id]/context` → `{ story: {id, title, premise, style}, path: getPath(id) mapped to {id, revision, depth, title, body, summary, path_summary}, codex: getContextCodex(id), choices: getChoices(id) }`. 404 when missing.
   - `GET /api/chapters/[id]/subtree?depth=N` (N 0–8, default 1) → `getSubtree`.
   - `POST /api/write-runs` → 201 `{ id }`; `GET /api/write-runs/[id]`; `PATCH /api/write-runs/[id]`; `POST /api/write-runs/[id]/claim` `{token}`; `GET /api/stories/[id]/write-runs?start=<chapterId>`.
7. **Tests** `tests/api/write-runs.test.mjs` (copy the setup of `tests/api/stories.test.mjs`): create/get/list a run; claim twice with different tokens (second 409); PATCH with a stale version (409); PATCH to `done` releases the lease; context and subtree shapes on a small story with written and unwritten choices; bad input gives 400.

**Check:** `npx tsc --noEmit`, `npx next build`, `npm test`. Shared code (db.ts, migration), so also the whole browser suite (`E2E_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` in a cloud session).

## Stage 2: planners and prompts (one agent, can run beside stage 1; pure code, no network)

**Files:** `src/lib/writeAhead/types.ts`, `src/lib/writeAhead/plan.ts`, `src/lib/ai/prompts.ts` (small additions), `tests/unit/write-ahead-plan.test.mts`, `tests/unit/prompts.test.mts`.

1. **`types.ts`:** the shared types above (import `ModelRef` from `settingsSchema`).
2. **Prompts (`prompts.ts`):**
   - `choicesPrompt(..., contextTokens, count = 3)`: a `count` parameter replacing the fixed 3 (in the wording and "JSON array of N strings"). With the default the text must stay exactly as now (prompt preview tests).
   - `SYSTEM_ARC_PLAN` and `arcPlanPrompt(ctx, objective, chapters, contextTokens)`: uses `storyHeader` like `ideasPrompt`; asks for exactly `chapters` steps that get from the end of the last chapter to the objective, each `{"choice": button text under 12 words for the choice that leads into that chapter, "direction": one or two sentences on what happens in it}`; the last step reaches the objective; earlier steps must not; reply with only a JSON array. The reply is read with the existing `parseIdeas`.
   - `arcDirection(objective, step, index, total, nextChoice?)` → the direction text for one chapter of the chain: "This chapter is part N of M of a stretch of the story heading toward: <objective>. In this chapter: <direction>." plus, before the last, "Don't reach that goal yet; end where \"<nextChoice>\" is a natural next step." and, for the last, "This chapter reaches that goal."
   - `withGuidance(direction, guidance)` joins the per-chapter direction and the run's guidance (guidance may hold `[notes]`; `generatePrompt` already reads them).
3. **Planners (`plan.ts`):** pure functions over the `getSubtree` result (type it as `TreeNode` from `tree.ts`; import only the type).
   - `planArc(startChapterId, steps: Idea[], opts, startChoice?: {id, label})` → write tasks t1…tN. t1's slot is `{kind:"choice"}` when the owner picked an existing unwritten choice (its label replaces step 1's choice), else `{kind:"new", parentChapterId, label: steps[0].choice}`. Task k (k>1) has slot `{kind:"fromTask", taskId: t(k-1), choiceIndex: 0}`. Task k's choices are `{given: [steps[k].choice], suggest: alternatives}` except the last: `{given: [], suggest: endChoices}`. `expand: false`. Direction from `arcDirection` + `withGuidance`.
   - `planFill(tree, opts)` → one write task per unwritten choice: only the start chapter's when `scope = "children"`, else every chapter in the tree. Breadth-first (by depth, then the order choices come in). Choices `{given: [], suggest: endChoices}`, `expand: false`.
   - `planTree(tree, opts)` (maxDepth D, breadth B): walk existing chapters at depth 0…D-1. For each: take its choices in order, written ones first, up to B. If it has fewer than B choices, add a `ChoicesTask` (`want: B`) for it. Add a write task (depth = chapter depth + 1) for each unwritten choice among those B, with `choices: depth+1 < D ? {given: [], suggest: B} : {given: [], suggest: endChoices}` and `expand: depth+1 < D`. Recurse into the written ones among those B. Choices past the first B are left alone.
   - `expandAfter(task, result, run)` → new tasks after a task is done: for a write task with `expand`, one write task per returned choice id (`slot: {kind:"choice", choiceId}`, label from the posted labels); for a `ChoicesTask`, write tasks for the chapter's unwritten choices among its first B (the runner passes the chapter's choices after adding). Same rules as `planTree` for `choices`/`expand`.
   - `estimate(mode, tree, opts)` → `{ chapters, requests }`: chapters the run will write in total, including ones `expandAfter` will add (for the tree: per level, B × chapters at the level above, minus what exists); requests ≈ chapters × 3 + choices tasks.
   - `nextTask(tasks)`: the first `todo` task whose slot can be resolved (a `fromTask` slot needs that task `done`; if it is `failed`/`skipped` this task becomes `skipped` too). `resolveSlot(task, tasks)` → `{choiceId} | {parentChapterId, newLabel}`.
   - `newTaskId(tasks)`.
4. **Unit tests:** each planner on a small hand-built tree (one written branch, two unwritten choices, one chapter with 1 choice when B = 3); `estimate` gives 3+9+27 = 39 for D=3, B=3 from a bare chapter and less when some exist; `expandAfter` stops at the depth; `nextTask` skips dependents of a failed task; the arc chain links t2 to t1's choice 0; `choicesPrompt` with no `count` is unchanged; `arcPlanPrompt` names the objective and the number of chapters.

**Check:** `npx tsc --noEmit`, `npm test` (unit suite).

## Stage 3: the runner (one agent; after stages 1 and 2)

**Files:** `src/lib/writeAhead/runner.ts` (new), `src/lib/writeAhead/writeChapter.ts` (new), `tests/unit/write-ahead-runner.test.mts`. Don't change `ChapterEditor.tsx` (sharing its code with the runner is a separate refactor; ask the owner first).

1. **`writeChapter.ts`** (browser): `writeOneChapter(settings, { context, label, direction, choices, options, signal, onText, onStatus }) → { title, body, choices: string[], summary?, path_summary? }`:
   - Builds `StoryContext` from the `/context` reply (`choiceLabel: label`, `siblingChoices` = the parent's choice labels).
   - Path summaries: same as `prepareContext` in `ChapterEditor.tsx` (a failure falls back silently, as there).
   - Chapter: `SYSTEM_CHAPTER` + `generatePrompt(ctx, direction, options.length, settings.contextTokens)`, `streamChat` with `role: "main"`, `model: options.model`; `parseChapterOutput`; no title → use `label`; empty body → throw.
   - Choices: `given`, then if `suggest > 0` `choicesPrompt(ctx, chapter, given, contextTokens, suggest)` with the cheap model (`completeChat`, `parseChoices`); drop duplicates and blanks; at most `LIMITS.choices`. A failed suggestion leaves just `given`.
   - Summaries: `summarizeChapter` with `previous` = the parent's `path_summary`; a failure leaves them out.
2. **`runner.ts`:** `runWriteAhead(runId, { settings, signal, onEvent })`:
   - Makes a token, `claim`s the run, sets status `running`, renews the lease every 30 s while working.
   - Loop on `nextTask`:
     - Write task: `resolveSlot`; `GET /context` of the parent. Don't write twice after a crash: if the choice already has a chapter, or (new slot) the parent has a written choice with the same label, mark the task done with that chapter. Otherwise `writeOneChapter`, then `POST /api/chapters` with `choice_id` or `parent_chapter_id` + `new_choice_label`, `choices`, summaries and `codex_changes: []`. A 409 "already written" counts as done (re-read the context for the id).
     - Choices task: `GET /context`; ask `choicesPrompt` for `want - existing` more (existing labels excluded); `POST /api/chapters/<id>/choices` once per label (stop at `LIMITS.choices`); `GET /context` again for their ids.
     - Mark done, store `chapterId`/`choiceIds`, append `expandAfter(...)`, then `PATCH` the run. Refuse to add tasks past `LIMITS.runChapters` write tasks (stop the run with a message).
     - A failure: try the task once more; a second failure marks it `failed`, saves the error, sets the run `paused` and returns. Stop (abort) sets `paused`. No `todo` left → `done`.
   - `onEvent` reports: task started, streamed text (for the preview), status lines ("Summarizing…"), task done, run paused/done, errors.
   - `retryTask(id)` (failed → todo) and `skipTask(id)` (→ skipped; dependents become skipped through `nextTask`) as small helpers that PATCH the run.
3. **Unit test** with a fake `fetch` and fake AI replies (see `tests/unit/ai-client.test.mts` for how the client is faked): a 2-step arc posts two chapters with the second filling the first's choice; a crash after posting (task still `todo`) doesn't post again; a failing AI call twice pauses the run with the task failed.

**Check:** `npx tsc --noEmit`, `npm test`.

## Stage 4: the page (one agent; after stage 3)

**Files:** `src/app/c/[id]/write-ahead/page.tsx` (new, server), `src/components/WriteAhead.tsx` (new, client form), `src/components/WriteAheadProgress.tsx` (new, client), `src/app/c/[id]/page.tsx` (the link and button, D1), `src/app/globals.css` if needed, `tests/e2e/write-ahead.e2e.mjs` (new).

1. **Page** `/c/<id>/write-ahead` (`?run=<id>` shows that run): crumbs back to the chapter, heading "Write ahead with AI", the chapter's title. Loads the story, the chapter's subtree (to depth 8), its unwritten choices and its earlier runs (`listRuns(storyId, chapterId)`). A run that is `running`/`paused`/`ready` is offered first: "A run from here is unfinished: 12 of 39 written. Resume / Stop it".
2. **Form** (`WriteAhead.tsx`), three choices (radio or tabs):
   - **Reach a goal:** Goal (textarea), Chapters (`NumberInput` 1–20, default 3), Start with: a new choice (default) or one of this chapter's unwritten choices (select). **Plan the chapters** sends `arcPlanPrompt` (main model) and shows the steps as editable rows (choice text, what happens; remove a row; **Plan again**). **Write N chapters** starts the run.
   - **Fill open choices:** "This chapter's open choices (k)" or "Every open choice below this chapter (m)", with the counts. If there are none, say so and offer Grow the tree.
   - **Grow the tree:** Depth (1–8, default 3), Choices per chapter (1–6, default 3), a line under them: "Keeps the chapters and choices already there."
   - **Settings for every chapter** (a `<details>`, closed): Length (short/medium/long, default medium), Writing model and Model for choices and summaries (`ModelPicker`, uses as on the writing page), Guidance for every chapter (textarea, e.g. "[keep it light]"), Choices on the last chapters (0–6, default 3), and for Reach a goal, Other choices along the way (0–3, default 0).
   - **Estimate:** "Writes 39 chapters, about 120 AI requests, one at a time." Over 20: a confirm step. Over `LIMITS.runChapters`: the start button is disabled with the reason.
   - `PromptButton` ("View prompt") beside Plan the chapters and beside the start button (the first chapter's prompt), as other AI buttons have.
   - Starting: `planArc`/`planFill`/`planTree`, `POST /api/write-runs`, then `router.replace(?run=<id>)` and start the runner.
3. **Progress** (`WriteAheadProgress.tsx`): "12 of 39 written. Now: “Run away” (2 below this chapter)", the status line, a collapsible live preview of the chapter being written, **Stop** / **Resume**, and the task list (written ones link to `/c/<id>`; failed ones show the error with **Try again** / **Skip**). A note: "This runs from this browser: keep the page open. On a phone, keep the screen on." Ask for a screen wake lock (`navigator.wakeLock.request("screen")`, in try/catch, released when done). Done: "Wrote 39 chapters. Open in outline" (`/s/<story>/outline#c-<chapter>`) and D8's codex note. Don't auto-start a paused run on load; show **Resume**.
4. **Chapter page:** add the menu link and the button (D1). Keep the existing layout otherwise.
5. **e2e** `tests/e2e/write-ahead.e2e.mjs` with its own fake AI on port 3222 (copy the server from `tests/e2e/chapters.e2e.mjs` and add a reply for the arc plan: a JSON array of `{choice, direction}` objects when the prompt contains the plan wording). Use `useMockAi` and `restore()` at the end; delete nothing the next file depends on. Cover: Fill on a chapter with two unwritten choices writes both (the chapter page then links both as written); Grow the tree depth 2, 2 choices from a bare chapter writes 6 chapters; Reach a goal with 2 chapters shows an editable plan, writes a chain of 2 with the second under the first's choice; Stop then reload shows Resume and finishing it writes the rest once; the estimate refuses a 6 × 8 tree.

**Check:** feature size per CLAUDE.md: `npx tsc --noEmit`, `npx next build`, `npm test`, `node tests/run.mjs e2e write-ahead chapters`, and screenshots of `/c/<id>/write-ahead` (form and a run in progress) and the chapter page at desktop and phone width (`node tests/shot.mjs`). Describe what the screenshots show.

## Stage 5: later (not part of the first build; ask the owner)

- Show a run's chapters in the outline (a marker, or a filter).
- In-app "delete the chapters this run wrote" (needs an app-side delete, which the app doesn't have on purpose).
- Codex: run the codex scan (`src/lib/ai/codexAi.ts`) on each chapter and save its proposals for review.
- Two requests at once for providers that allow it.
- Write ahead from the outline page or the writing page.

## Not verifiable in a cloud session

A real model's output quality, long runs on a phone with the screen off, and the NAS. Manual check for the owner: on the NAS, run Grow the tree with depth 2 and 2 choices from a test chapter with your real model, reload the page halfway, press Resume, and check the outline has 6 new chapters and no duplicates.
