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
| D1 | Order | Fill open choices first (it builds the shared parts), then Grow the tree, then Reach a goal. Fill missing pictures can start once milestone 1's task 1.1 is on `main`. |
| D2 | Where it starts | The chapter reading page's ☰ menu (`PageMenu` in `src/app/c/[id]/page.tsx`): **Write ahead with AI…** opens `/c/<id>/write-ahead`. No button under the choices, nothing on the outline. |
| D3 | Review | Chapters are posted straight away, marked "Written by AI, not reviewed" until the owner presses **Mark reviewed**. Editing or reading a chapter doesn't count as reviewing it. |
| D3a | The AI mark | A **robot icon**, everywhere an AI-written chapter appears: in the chapter page's meta line, on the choice card that leads to it (the parent chapter's "What happens next?"), and in the outline. The mark **stays after review**: unreviewed is a filled, accent-coloured robot (title "Written by AI, not reviewed"); reviewed is a quiet outline robot in the muted colour (title "Written by AI"). Only chapters are marked, not the unwritten choices a run adds. In the outline it is a new part, **AI-written**, in Settings › Outline, **on by default**. |
| D4 | What Fill writes | Unwritten choices only (a choice with no chapter). Brainstorm ideas never added as choices are not included. |
| D5 | Choices on the last chapters written | 3 unwritten choices suggested by the AI (a run setting, 0–6), so the story doesn't end there. |
| D6 | Choices along a Reach a goal chain | Only the next step's choice; "Other choices along the way" (0–3, default 0) adds AI-suggested unwritten ones. |
| D7 | Size limits | At most 200 chapters per run (`LIMITS.runChapters`), depth 1–8, choices per chapter 1–6, Reach a goal 1–20 chapters. Over 20 chapters asks to confirm. |
| D8 | Requests at once | One at a time (a local Ollama can't run several). |
| D9 | Codex | Not updated by a run. The run page says so. |
| D10 | Pictures: which one is used | One picture per slot, saved as the header/footer straight away. No choosing. |
| D11 | Pictures: which slots | A run setting: Header, Footer, or Both (default Header). |
| D12 | Pictures: references | A run setting, **off by default** (the owner doesn't trust the reference workflow yet). On: the story's style picture plus, for a footer, the chapter's header. |

## How it works (all milestones)

- **AI calls run in the browser** (`src/lib/ai/client.ts`; keys never reach the server), and so do ComfyUI calls. A run only advances while its page is open. To survive a reload or closed tab, **a run's task list is kept on the server** (`ai_runs`) and the page resumes it.
- A run is a **list of tasks**. A planner (pure functions) turns the owner's choices into tasks; a **runner** does them one at a time, saving the list after each.
- A written chapter is posted with the existing `POST /api/chapters`, as the writing page posts one (title, body, choices, summary, path_summary), plus the run's id for the D3 mark. Writing it repeats the writing page's steps from `ChapterEditor.tsx` without its UI: older path summaries (`neededSummaryIndex` + `ensurePathSummaries`), `generatePrompt` with `SYSTEM_CHAPTER` streamed with `streamChat` (main model), `parseChapterOutput`, choices with `choicesPrompt` (cheap model), `summarizeChapter` (cheap model; a failure doesn't stop the post).
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
  /** Grow the tree: queue a task for each of the new chapter's choices (milestone 2). */
  expand: boolean;
  status: TaskStatus;
  chapterId?: string;    // set when done
  choiceIds?: string[];  // from POST /api/chapters, same order as the choices sent
  error?: string;
};

/** Grow the tree (milestone 2): add AI-suggested choices to an existing chapter until it has `want`. */
export type ChoicesTask = { kind: "choices"; id: string; chapterId: string; depth: number; want: number; status: TaskStatus; error?: string };

/** Fill missing pictures (milestone 4): one picture for one slot of one chapter. */
export type PictureTask = { kind: "picture"; id: string; chapterId: string; slot: "header" | "footer"; status: TaskStatus; jobId?: string; error?: string };

export type RunTask = WriteTask | ChoicesTask | PictureTask;

export type RunOptions = {
  // writing modes
  length?: "short" | "medium" | "long";
  model?: ModelRef | null;        // writing model; null = the default main model
  suggestModel?: ModelRef | null; // choices, summaries and picture prompts; null = the default cheap model
  guidance?: string;              // added to every chapter's direction ([bracket notes] allowed)
  endChoices?: number;            // D5
  scope?: "children" | "below";   // fill, and pictures ("below" = this chapter and everything under it)
  maxDepth?: number; breadth?: number;                         // tree
  objective?: string; chapters?: number; alternatives?: number; // arc
  // pictures
  slots?: "header" | "footer" | "both";
  useRefs?: boolean;              // D12, default false
};

export type RunStatus = "ready" | "running" | "paused" | "done" | "stopped";

export type AiRun = {
  id: string; story_id: string;
  start_chapter_id: string | null;  // null = the whole story (pictures)
  mode: RunMode; options: RunOptions; tasks: RunTask[];
  status: RunStatus; error: string | null; version: number;
  created_at: number; updated_at: number;
};
```

---

## Milestone 1: Fill open choices (ship to `main` when done)

### Task 1.1: server (no UI)

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
     status           TEXT NOT NULL CHECK (status IN ('ready', 'running', 'paused', 'done', 'stopped')),
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
   - `updateRun(id, { token, version, tasks?, status?, error? })`: 409 if the lease isn't `token`'s or `version` differs; bumps `version`, renews the lease, sets `updated_at`; `paused`/`done`/`stopped` release the lease.
7. **The mark's state where chapters are listed** (D3a): a shared type `AiMark = null | "unreviewed" | "reviewed"` (null = written by the owner) and a helper `aiMarkOf({ai_run_id, ai_reviewed_at})`. `TreeNode` gets `ai: AiMark` (so the outline has it); `Choice` gets `child_ai: AiMark` (`getChoices` joins the child chapter's two columns), so the choice cards can show it.
   **`getSubtree(chapterId, maxDepth)`** in `tree.ts`: the chapter as a `TreeNode` with children down to `maxDepth` levels (reuse `getStoryTree`'s query and building; depths relative, start = 0).
8. **Routes** (check `node_modules/next/dist/docs/01-app/` for route handler `params` if unsure):
   - `GET /api/chapters/[id]/context` → `{ story: {id, title, premise, style}, path: getPath(id) as {id, revision, depth, title, body, summary, path_summary}[], codex: getContextCodex(id), choices: getChoices(id) }`; 404 when missing.
   - `GET /api/chapters/[id]/subtree?depth=N` (0–8, default 1).
   - `POST /api/ai-runs` → 201 `{ id }`; `GET` and `PATCH /api/ai-runs/[id]`; `POST /api/ai-runs/[id]/claim {token}`; `GET /api/stories/[id]/ai-runs?start=<chapterId>&mode=<mode>`.
9. **Tests** `tests/api/ai-runs.test.mjs` (setup copied from `tests/api/stories.test.mjs`): create, get and list a run; a second claim with another token is 409; a stale version is 409; `done` releases the lease; a chapter posted with `ai_run_id` is `"unreviewed"` (in the subtree and in its parent's choices' `child_ai`) until marked, then `"reviewed"`, and the path and run variants mark the right chapters; a chapter posted without it is `null`; a bad `ai_run_id` is 400; context and subtree shapes.

**Check:** shared code (db.ts, migration): `npx tsc --noEmit`, `npx next build`, `npm test`, and the whole browser suite (`E2E_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e` in a cloud session).

### Task 1.2: types and the Fill planner (pure code; can run beside 1.1)

**Files:** `src/lib/aiRuns/types.ts`, `src/lib/aiRuns/plan.ts`, `tests/unit/ai-runs-plan.test.mts`.

- `types.ts`: the shared types above (`ModelRef` from `settingsSchema`).
- `planFill(tree, opts)`: a write task per unwritten choice, only the start chapter's when `scope = "children"`, else every chapter in the tree. Breadth first (by depth, then choice order). `slot: {kind: "choice"}`, `direction: withGuidance("", opts.guidance)`, `choices: {given: [], suggest: endChoices}`, `expand: false`.
- `withGuidance(direction, guidance)`: joins the two with a blank line, either may be empty.
- `nextTask(tasks)`: the first `todo` task whose slot can be resolved. A `fromTask` slot needs that task `done`; if it is `failed`/`skipped`, the dependent becomes `skipped` (return the updated list too).
- `resolveSlot(task, tasks)` → `{ choiceId } | { parentChapterId, newLabel }`.
- `estimateFill(tree, opts)` → `{ chapters, requests }` (requests ≈ chapters × 3).
- `newTaskId(tasks)`.
- **Tests:** a hand-built tree with a written branch and unwritten choices at two depths: both scopes, breadth-first order, the estimate; `nextTask` skips the dependents of a failed task (build two `fromTask` tasks by hand); `resolveSlot` for all three slot kinds.

**Check:** `npx tsc --noEmit`, `npm test`.

### Task 1.3: the runner (after 1.1 and 1.2)

**Files:** `src/lib/aiRuns/writeChapter.ts`, `src/lib/aiRuns/runner.ts`, `src/lib/aiRuns/api.ts` (fetch helpers for the routes), `tests/unit/ai-runs-runner.test.mts`. Don't change `ChapterEditor.tsx` (sharing its code is a separate refactor; ask the owner first).

1. **`writeOneChapter(settings, { context, label, direction, choices, options, signal, onText, onStatus })`** → `{ title, body, choices: string[], summary?, path_summary? }`:
   - `StoryContext` from the `/context` reply: `choiceLabel: label`, `siblingChoices` = the parent's choice labels.
   - Path summaries as `prepareContext` in `ChapterEditor.tsx` does (a failure falls back silently).
   - `SYSTEM_CHAPTER` + `generatePrompt(ctx, direction, options.length ?? "medium", settings.contextTokens)`, `streamChat` with `role: "main"`, `model: options.model`; `parseChapterOutput`; no title → `label`; an empty body throws.
   - Choices: `given`, then if `suggest > 0` `choicesPrompt` with the cheap model (`completeChat`, `parseChoices`), trimmed to `suggest`; drop blanks and repeats; at most `LIMITS.choices`. A failed suggestion leaves just `given`.
   - Summaries: `summarizeChapter` with `previous` = the parent's `path_summary`; a failure leaves them out.
2. **`runAiRun(runId, { settings, signal, onEvent })`** (the write tasks; later milestones add their kinds to the same loop):
   - Makes a token, claims the run, sets `running`, renews the lease every 30 s while working.
   - Loops on `nextTask`. For a write task: `resolveSlot`; `GET /context` of the parent. **Don't write twice after a crash:** if the choice already has a chapter, or (new slot) the parent has a written choice with that label, mark the task done with that chapter. Otherwise `writeOneChapter`, then `POST /api/chapters` with `choice_id` (or `parent_chapter_id` + `new_choice_label`), `choices`, the summaries, `codex_changes: []` and `ai_run_id`. A 409 "already written" counts as done (read `/context` again for the id).
   - After each task: set `done`, `chapterId`, `choiceIds`, then `PATCH` the run.
   - A failure: try the task once more; a second failure marks it `failed` with the error, pauses the run and returns. Stop (abort) pauses. No `todo` left → `done`.
   - `onEvent`: task started, streamed text, status lines, task done, paused/done, errors.
   - `retryTask(runId, taskId)` (failed → todo) and `skipTask` (→ skipped) PATCH the run.
3. **Unit test** with a fake `fetch` and fake AI replies (see `tests/unit/ai-client.test.mts` for faking the client): two fill tasks post two chapters with `ai_run_id`; a task left `todo` after its chapter was posted isn't posted again; an AI call failing twice pauses the run with the task failed.

**Check:** `npx tsc --noEmit`, `npm test`.

### Task 1.4: the page and the review mark (after 1.3)

**Files:** `src/app/c/[id]/write-ahead/page.tsx` (new), `src/components/WriteAhead.tsx` (new, the form), `src/components/AiRunProgress.tsx` (new, shared by milestone 4), `src/components/AiReviewNotice.tsx` (new), `src/components/AiMark.tsx` (new), `src/app/c/[id]/page.tsx`, `src/app/s/[id]/outline/page.tsx`, `src/lib/settingsSchema.ts`, `src/app/globals.css`, `tests/e2e/write-ahead.e2e.mjs` (new).

Split this task in two commits if it gets large: first the marks (items 1 and 2, testable with chapters posted through the API with `ai_run_id`), then the page.

1. **The mark** (D3a). `AiMark.tsx`: a robot icon as inline SVG (draw it to match the line icons in `PictureIcons.tsx`: same viewBox, stroke width and `currentColor`), taking `mark: AiMark` and rendering nothing for null; `"unreviewed"` filled in the accent colour, `"reviewed"` an outline in the muted colour; `role="img"` with the two titles as its accessible name. Use it:
   - On the chapter page, in the meta line beside the date.
   - On each written choice card under "What happens next?" (`choice-written` links in `src/app/c/[id]/page.tsx`), from `child_ai`.
   - In the outline: a new part `aiWritten` in `OutlineOptions`, `OUTLINE_PARTS` (label "AI-written", hint "a robot on chapters the AI wrote by itself, filled until you mark them reviewed") and `DEFAULT_OUTLINE` (on). Check that settings saved before this, which have no `aiWritten`, read it as on (see how the schema fills the other parts). Shown in the outline's `[...]` section like the other parts (look at how `review` is done in `src/app/s/[id]/outline/page.tsx`). `settingsSchema.ts` is shared code, so run the whole browser suite.
2. **Review on the chapter page:** for an unreviewed AI chapter, `AiReviewNotice` at the top: "Written by AI, not reviewed yet." with **Mark reviewed** and, when chapters above it on the path are unreviewed too, **Mark this path reviewed**; after marking, `router.refresh()` (the notice goes, the robot turns to the reviewed look). A **Write ahead with AI…** item in `PageMenu` (D2).
3. **Page `/c/<id>/write-ahead`** (`?run=<id>` shows that run): crumbs back to the chapter, heading "Write ahead with AI", the chapter's title. Loads the story, the subtree (depth 8), and earlier runs from this chapter. An unfinished run is offered first: "A run from here is unfinished: 12 of 39 written. Resume / Stop it".
4. **Form** (`WriteAhead.tsx`), built so milestones 2 and 3 can add their modes as more options in the same picker (radio group "What to write"): for now only **Fill open choices**: "This chapter's open choices (k)" or "Every open choice below this chapter (m)". With none, say so. **Settings for every chapter** (a `<details>`, closed): Length (default medium), Writing model and Model for choices and summaries (`ModelPicker`, as on the writing page), Guidance for every chapter (textarea), Choices on each new chapter (0–6, default 3). **Estimate:** "Writes 7 chapters, about 21 AI requests, one at a time." Over 20 asks to confirm; over the limit the button is off with the reason. A `PromptButton` ("View prompt") for the first chapter's prompt. Starting: `planFill`, `POST /api/ai-runs`, `router.replace(?run=<id>)`, start the runner.
5. **Progress** (`AiRunProgress.tsx`): "3 of 7 written. Now: “Run away”", the status line, a collapsible live preview, **Stop** / **Resume**, and the task list (written ones link to `/c/<id>`; failed ones show the error with **Try again** / **Skip**). A note: "This runs from this browser: keep the page open. On a phone, keep the screen on." Ask for a screen wake lock (`navigator.wakeLock.request("screen")` in try/catch, released when done). A paused run doesn't restart by itself on load. Done: "Wrote 7 chapters, marked not reviewed. Mark all reviewed · Open in outline", and the D9 note.
6. **e2e** `tests/e2e/write-ahead.e2e.mjs` with its own fake AI on port 3222 (copy the server from `tests/e2e/chapters.e2e.mjs`); `useMockAi` and `restore()` at the end. Cover: Fill on a chapter with two unwritten choices writes both, and the chapter page then shows both as written, each card with the unreviewed robot; the new chapter shows the notice and the robot in its meta line, and the outline shows the robot; Mark reviewed removes the notice and turns the robot to the reviewed look in all three places; unticking AI-written in Settings › Outline hides it in the outline only; a chapter the owner wrote has no robot; Stop, reload, Resume finishes without duplicates.

**Check:** settings schema changed, so: `npx tsc --noEmit`, `npx next build`, `npm test`, the whole browser suite, and screenshots (`node tests/shot.mjs`) of the form, a run in progress, a parent chapter with an AI choice card, an unreviewed chapter and the outline, at desktop and phone width; describe them (is the robot readable at phone width, do the two looks differ clearly).

**Then ship milestone 1.**

---

## Milestone 2: Grow the tree (ship when done)

### Task 2.1: planner and prompt

**Files:** `src/lib/ai/prompts.ts`, `src/lib/aiRuns/plan.ts`, `tests/unit/ai-runs-plan.test.mts`, `tests/unit/prompts.test.mts`.

- `choicesPrompt(..., contextTokens, count = 3)`: `count` replaces the fixed 3 in the wording and in "JSON array of N strings". With the default, the text stays exactly as now (prompt preview tests).
- `planTree(tree, opts)` (depth D, breadth B): walk existing chapters at depth 0…D-1. For each, take its choices in order, written ones first, up to B. Fewer than B → a `ChoicesTask` (`want: B`). A write task (depth = chapter depth + 1) per unwritten choice among those B, with `choices: {given: [], suggest: depth + 1 < D ? B : endChoices}` and `expand: depth + 1 < D`. Recurse into the written ones among those B. Choices past the first B are left alone.
- `expandAfter(task, result)`: for a done write task with `expand`, a write task per returned choice id; for a done `ChoicesTask`, write tasks for the unwritten choices among the chapter's first B (the runner passes the chapter's choices after adding). Same rules as `planTree`.
- `estimateTree(tree, opts)`: includes what `expandAfter` will add (per level, B × the chapters at the level above, minus what exists). D=3, B=3 from a bare chapter is 39.
- **Tests:** the planner on a tree with one written branch and a chapter with 1 choice when B = 3; the estimates; `expandAfter` stops at depth D.

### Task 2.2: runner and form

**Files:** `src/lib/aiRuns/runner.ts`, `src/components/WriteAhead.tsx`, `tests/unit/ai-runs-runner.test.mts`, `tests/e2e/write-ahead.e2e.mjs`.

- Runner: after a task is done, append `expandAfter(...)` before saving; refuse to go past `LIMITS.runChapters` write tasks (stop with a message). The `ChoicesTask`: `GET /context`; `choicesPrompt` for `want - existing` more (existing labels excluded); `POST /api/chapters/<id>/choices` per label (stop at `LIMITS.choices`); `GET /context` again for the ids.
- Form: **Grow the tree** in the picker: Depth (1–8, default 3), Choices per chapter (1–6, default 3), "Keeps the chapters and choices already there.", Choices on the last chapters (the D5 setting), the estimate.
- e2e: depth 2, 2 choices from a bare chapter writes 6 chapters; a 6 × 8 tree is refused by the estimate.

**Check:** as task 1.4, then **ship milestone 2.**

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

**Check:** as task 1.4, then **ship milestone 3.**

---

## Milestone 4: Fill missing pictures (standalone; can start after task 1.1 is on `main`)

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
4. Send it through the app's picture queue (`usePictureQueue().ask`) so it is recorded in the job log and shows in the header. Route its pictures back to the runner the way the Refine screen does (`JobInput.session` = `pictures:<run id>`, `listenSession`), not marked temporary. Wait for it.
5. **Save** the picture as the slot, as `usePictureSaver` does (`PUT /api/chapters/:id/images/:slot?job=<id>&index=0` with the image), which also pins it. Store `jobId` on the task.
6. A failure (AI, ComfyUI, the save) retries once, then pauses the run with the error, as for chapters. On resume after a reload, a task whose job finished while the page was closed may make a second picture; accept that and note it in `docs/illustrate.md`.

**Tests:** unit tests for `planPictures` and the job input builder; e2e `tests/e2e/missing-pictures.e2e.mjs` with the fake ComfyUI (`tests/e2e/fakeComfy.mjs`) and fake AI: a story of three chapters, one with a header, fills the other two headers; Both fills footers too; the references box off sends no IP-Adapter nodes; Stop and Resume. Run the `illustrate-*` and `picture-queue*` browser files too if `ComfyGenerate` or `PictureQueue` changed.

**Check:** as task 1.4 plus those files, then **ship milestone 4.**

---

## Later (ask the owner first)

- Codex: run the codex scan (`src/lib/ai/codexAi.ts`) on each written chapter and keep its proposals for review.
- An in-app "delete the chapters this run wrote" (the app has no delete, on purpose; today it is `scripts/admin.mjs delete chapter <id> --yes`).
- Two requests at once for providers that allow it.
- Make missing pictures automatically at the end of a write-ahead run (a checkbox on the write-ahead form).

## Not verifiable in a cloud session

Real model output, long runs on a phone with the screen off, a real ComfyUI, and the NAS. Owner's manual check after each milestone: on the NAS, start a small run (Fill on a chapter with two open choices; Grow the tree depth 2 × 2; a 2-chapter goal; missing headers on a short branch), reload halfway, press Resume, and check nothing is written or drawn twice.
