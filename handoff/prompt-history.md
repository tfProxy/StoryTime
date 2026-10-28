# Handoff: Prompt history

A plan the owner approved on 2026-10-28, written so a new session can build it without the conversation that produced it. **Delete this file in the commit that ships the work** (the repo keeps no plans; see `CLAUDE.md`), and remove the matching line from `TODO.md`.

## What and why

A debugging view of the app's recent **text AI calls**: the prompts sent, the replies, where each call came from and which model answered. The first use is tuning the codex check prompt (`SYSTEM_CODEX_CHECK` in `src/lib/ai/codexCheckAi.ts`; see the Codex section of `TODO.md`), but it should help with every prompt in the app. The owner copies an exchange from this page and pastes it into a Claude session to have the prompt improved.

It is short-lived by design: a few days of history, nothing anyone needs to keep.

## Owner decisions

- Stored in a small SQLite table on the server (not just in memory), so it survives a restart, trimmed automatically.
- **The table is never migrated.** It is not part of `MIGRATIONS` in `src/lib/db.ts`. Its name carries a version (`ai_calls_v1`). When its shape has to change, rename it (`ai_calls_v2`): on start the server drops any other `ai_calls_v*` table and creates the current one. Losing the history on an update is fine. Write this rule in a comment at the table's definition and as one line under "Verification" or "Docs" in `CLAUDE.md`, so no one writes a migration for it.
- Recording is always on (no setting).
- Name and place, as proposed and not objected to: **"Prompt history"** in the ☰ menu (`src/components/SiteMenu.tsx`), in the group with Drafts, Queue and Settings. If unsure, ask the owner before building the page.

## Design

### 1. Storage (`src/lib/aiLog.ts`, new)

- `AI_LOG_TABLE = "ai_calls_v1"`. `ensureAiLog(db)`, called from `open()` in `src/lib/db.ts` after the migrations loop: `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_calls_v%'`, drop every one that isn't `AI_LOG_TABLE`, then `CREATE TABLE IF NOT EXISTS`.
- Columns: `id` TEXT PK, `at` INTEGER (start, ms), `ms` INTEGER (duration), `side` ('server'|'browser'), `source` TEXT (label, below), `story_id`, `chapter_id`, `run_id`, `item_key` (work queue item) — all TEXT NULL, **no foreign keys** (rows outlive deleted chapters and must never block a delete), `connection` TEXT (the connection's name, never its key), `model` TEXT, `role` TEXT ('main'|'cheap'|NULL), `temperature` REAL NULL, `thinking_off` INTEGER, `system` TEXT, `messages` TEXT (JSON of `{role, content}[]`), `reply` TEXT, `status` ('ok'|'failed'|'stopped'), `error` TEXT NULL. Index on `at`.
- Each text field is cut at about 200 KB with a marker (`…[cut: N more characters]`).
- Trim on every insert: delete rows older than 3 days, then all but the newest 200.
- Never store API keys or request headers.
- `recordAiCall(row)`, `listAiCalls({ source?, storyId?, failedOnly?, limit })` (without the big text fields), `getAiCall(id)`.

### 2. Recording, in one place

Every text call goes through `streamChat` in `src/lib/ai/client.ts` (`completeChat` wraps it; `src/lib/aiRuns/writeChapter.ts` uses `streamChat` through `defaultStream`). `client.ts` is shared by the browser and the server, so it must not import the database.

- Add `source?: AiSource` to `ChatRequest`: `{ label: string; storyId?: string; chapterId?: string; runId?: string; itemKey?: string }`.
- In `client.ts`: a module-level hook `setChatRecorder(fn)` and, in `streamChat`, a `try/finally` around the whole stream that measures time, collects the reply, notes ok / failed (the error message) / stopped (an `AbortError`), and calls the recorder once with the request (system, messages, the resolved connection name, model, role, temperature, thinking) and the result. A recorder error must never break the call.
- Server: register a recorder that calls `recordAiCall` with `side: "server"`. Register it where the worker starts (`src/instrumentation.ts` / `src/lib/worker/`), and keep it on `globalThis` (Next loads modules more than once; see `src/lib/worker/CLAUDE.md`). Also register it lazily from `db()`'s first use if instrumentation ran in another module copy.
- Browser: register a recorder that POSTs the record to `POST /api/ai-log` (new route; zod schema; `side: "browser"`), fire and forget. Register it once in a client component that is always mounted (look at what `src/app/layout.tsx` renders, such as the work queue provider).

### 3. Labels for every caller

Every place that calls the AI passes `source`. Labels are short and stable (they are the filter list). Found with `grep -rn "completeChat(\|streamChat(" src`:

| Label | Where |
| --- | --- |
| Generate | `src/lib/worker/generate.ts` ~140 (the chapter), ~158 / ~171 (the follow-up calls there: check what each does and label them, e.g. "Generate: choices") |
| AI run: write | `src/lib/aiRuns/writeChapter.ts` (the `complete`/`stream` calls; pass the run id and chapter) |
| Summary | `src/lib/ai/summaries.ts` `summarizeChapter` |
| Picture prompt | `src/lib/ai/imagePrompt.ts` |
| Cover prompt | `src/lib/ai/coverPrompt.ts` |
| Codex picture prompt | `src/lib/ai/codexPrompt.ts` |
| Tags | `src/lib/ai/tagAi.ts` `suggestTagsForChapter` |
| Tag rule | `src/lib/ai/tagAi.ts` `draftRule` |
| Continuity facts | `src/lib/ai/factAi.ts` `extractFacts` |
| Continuity judge | `src/lib/ai/factAi.ts` `judgeConflict` |
| Summary check | `src/lib/ai/summaryCheckAi.ts` |
| Codex check | `src/lib/ai/codexCheckAi.ts` `runCodexCheck` |
| Notes to facts | `src/lib/ai/notesToFactsAi.ts` |
| Codex entry draft | `src/lib/ai/codexAi.ts` (`draftEntry`, unused at the moment) |
| Write ahead | `src/components/WriteAhead.tsx` ~116 |
| Rewrite passage | `src/components/ChapterEditor.tsx` ~574 |
| Choice label | `src/components/ChapterEditor.tsx` ~608 |
| Brainstorm ideas | `src/components/ChapterEditor.tsx` ~671 |
| Suggest choices | `src/components/ChapterEditor.tsx` ~732 |
| Connection test | `src/components/SettingsForm.tsx` ~428 |

The library helpers take an options object; add an optional `source` (or ids) to it and pass it through, so the AI run steps (`src/lib/aiRuns/runner.ts`: doFacts, doSummary, doCodex, doNotes, the tags and continuity steps) can add the run id and chapter. A call with no `source` is recorded with the label "Other". Check the line numbers above; they drift.

### 4. The page

- `src/app/ai-log/page.tsx` (route name is free; the menu says "Prompt history"), plus `GET /api/ai-log?source=&story=&failed=1&limit=` and `GET /api/ai-log/<id>`.
- List: time, source, story title, model, duration, status (failed in the warning colour). Filters: source (the labels present), story, "Failed only". Newest first.
- A row opens the call: its metadata (side, connection, model, role, temperature, thinking, links to the story / chapter / run or queue item), then **System**, **Message(s)** and **Reply** in separate boxes, each with a Copy button, and **Copy all**, which copies one plain-text block (the metadata, then each part under a heading) ready to paste into a Claude session.
- Works at phone width (390 px) with no sideways scroll; long prompts scroll inside their box. Use the app's tokens and classes (`src/app/globals.css`).
- An empty state that says recording happens automatically and keeps the last 200 calls / 3 days.

### 5. Links from where the AI was used

"Show the AI exchange" links to the page filtered to that call:
- in a run's task list (`src/components/AiRunProgress.tsx`): per task, by run id and chapter;
- on a Generate (wherever its progress or result shows);
- in the codex inbox (`src/components/CodexInbox.tsx`): on each chapter group, to that chapter's codex check.

The page takes `?run=`, `?chapter=` and `?source=` filters for this.

## How to build it efficiently

1. Read `CLAUDE.md`, `AGENTS.md` and `src/lib/worker/CLAUDE.md` first. Their rules apply: Edit/Write only (no sed, heredocs or scripts on source files), `grep -n` then Read with offset/limit, no setState directly in an effect body (CI lint fails), no hooks after an early return.
2. Work on the session's branch; ask the owner before "ship it".
3. Two steps, each tested and committed on its own, with helper agents on the cheaper model (the owner asked for that). Run them one after the other, not at once: the API and browser suites share port 3111.
   - **Step A, server:** the table and `aiLog.ts`, `ensureAiLog` in `db.ts`, the recorder in `client.ts`, the server recorder registration, `POST/GET /api/ai-log`, the `source` labels for every caller in the table above, and the `CLAUDE.md` line. Tests: unit (trimming to 200 and 3 days, field cutting, drop-and-recreate of another `ai_calls_v*` table, a recorder error not breaking a call, ok / failed / stopped); API (a browser record is stored and listed; a server-side run against the fake AI, as `tests/api/codex-suggestions.test.mjs` does, records a "Codex check" call with its run id, model and reply; no API key in any stored row).
   - **Step B, page:** the page, the browser recorder registration, the ☰ link, the "Show the AI exchange" links, a browser test (`tests/e2e/prompt-history.e2e.mjs`: a recorded call shows in the list, filters work, opening it shows the three parts, Copy all), and a short owner-facing line in `README.md`.
4. Review each agent's work before starting the next: read the diff of the shared files (`client.ts`, `db.ts`), look at the screenshots yourself.
5. Checks before saying it is done (`CLAUDE.md` › Verification; this touches shared code): `npx tsc --noEmit`, `npm run lint` (only the known `OutlineSummaries.tsx` error is allowed), `npx next build`, `npm test`, the whole browser suite `npm run test:e2e`, and screenshots at desktop and phone width with `node tests/shot.mjs` against a server on a temporary database (`STORYTIME_DB=<scratchpad>/shots.db npx next start -p 3738`; never the repo's `data/storytime.db`).
6. Tests that save AI settings with a fake AI must set `autoCodex: false`, or the automatic codex check adds AI calls (and now history rows) the test doesn't expect. `useMockAi` in `tests/e2e/browser.mjs` already does.
7. To finish: delete this file, remove the prompt history line from `TODO.md`, and say what couldn't be checked (the NAS, real models, a real phone).
