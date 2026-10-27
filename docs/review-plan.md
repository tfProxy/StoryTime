# Plan: finish story review (checks and tags)

Written 2026-10-27 for agents on cheaper models, one task at a time, directed by the owner. Background, what exists and test gotchas are in `tags_handoff.md` (read its "What exists" and "Tests" sections once). The agreed design is the "Story review: checks and tags" section of `TODO.md`.

## How to work a task

- Do **one task per session or subagent**, in the order below unless the owner says otherwise. Each task is one commit (two if it also updates this file).
- Read only the files the task names: `grep -n` for the function, then Read with offset/limit. Don't read whole long components.
- Edit with the Edit or Write tools only. Never `sed`, heredocs or scripts on source files (`CLAUDE.md`).
- **Migrations:** the number below is a guess; other sessions add migrations too. Use the next free index in `MIGRATIONS` (`src/lib/db.ts`, 32 was the last on 2026-10-27), add a case to `tests/unit/migrations.test.mts`, and run the whole browser suite before pushing.
- **Checks:** `npx tsc --noEmit`, `npx next build`, `npm test`, the browser files named in the task (`E2E_EXECUTABLE=/opt/pw-browsers/chromium node tests/run.mjs e2e <name>` in a cloud session), and a phone-width screenshot for UI changes.
- **When done:** add "(done, <short hash>)" after the task's title here, and tick it in `TODO.md` if TODO names it. Then "ship it" as `CLAUDE.md` describes, if the owner asked.
- **Stop and ask the owner** when a task says **Ask first**, when something in this plan turns out wrong, or when a UI change needs a place this plan doesn't name.
- **Suggested model** is a hint: *small* = the cheapest model is fine; *medium* = a mid-size model; *design* = do it with the owner in a stronger model.

## What changed on main since the original plan (2026-10-22 to 10-27)

- **The server can call the AI now.** `src/lib/ai/client.ts` (`completeChat`, `streamChat`) runs in Node too, and the work queue (`src/lib/worker/`, `docs/server-queue-plan.md`) runs Generates and AI runs on the server, taking turns with ComfyUI. Stage 5 no longer needs "move AI calls to the server" first: review work can be a new **AI run mode**, like write ahead and fill missing pictures (`src/lib/aiRuns.ts`, `src/lib/aiRuns/`, `src/lib/worker/runs.ts`). That also lets a long Find tags carry on with the tab closed. Phase B does this.
- **AI runs write chapters** (write ahead, grow the tree, reach a goal), and the **AI mark** shows on chapters an AI run wrote until the author presses **Mark reviewed** (`chapters.ai_run_id`, `ai_reviewed_at`, migration 31, `AiReviewNotice.tsx`, `AiMark.tsx`). "Reviewed" there means "the author read it", not the Review page. More AI-written chapters make automatic tagging and checks (phase E) more useful.
- **Summaries:** the server now saves the summaries it makes for older chapters, so fewer chapters show "summary missing".
- **`src/lib/tree.ts`** gained `getSubtree(chapterId, maxDepth)` and an `ai` field on tree nodes. The outline page menu gained "Make missing pictures" above "Review the story".
- **A shared fake AI server** for tests: `tests/fakeAi.mjs` (used by `tests/api/queue-*.test.mjs`). Use it for server-side AI tests.
- Nothing on main changed the review or tag code itself.

## Open questions for the owner (answer before the tasks that need them)

1. **Tag rules** (needed before C8 and before changing the starter rules): do dreams or visions count? A change reversed in the same chapter? Partial changes (ears, a tail)?
2. **AI mark and Review** (needed before E3): should AI-written chapters not yet marked reviewed also be listed on the Review page's Issues tab, and counted in the outline ⚠?
3. **Long scans on the server** (needed before B2): should Find tags over more than one chapter go through the queue (it keeps going with the tab closed and takes turns with pictures), replacing today's in-page loop? **Answered 2026-10-27: yes, through the queue.**
4. **Placement for stage 4** (D1 to D3): where content notes go on the reading page, and the outline chips/filter.

## Phase A: small tag fixes (no owner input needed)

### A1. Skip chapters already checked at their current revision (medium) (done, 721b7d2)

Today a chapter that got no suggestions is read again on every Find tags run, because nothing records that it was checked.

- Migration: `chapter_tag_checks(chapter_id TEXT NOT NULL REFERENCES chapters(id), revision INTEGER NOT NULL, tag_ids TEXT NOT NULL, checked_at INTEGER NOT NULL, PRIMARY KEY (chapter_id))`. `tag_ids` is the JSON list of tag ids checked.
- `suggestTags` in `src/lib/tags.ts`: in the same transaction, upsert the row with the revision and `checkedTagIds`.
- `src/app/s/[id]/review/page.tsx`: the `decided` list given to `TagScan` also includes the tag ids in a check row whose revision equals the chapter's.
- Changing a tag's rule should make it be checked again: in `updateTag`, when `applies`, `not_applies` or `choices` change, remove that tag id from every row's `tag_ids` (or delete rows containing it, which is simpler; say which you chose in the commit).
- Tests: `tests/api/tags.test.mjs` (a second suggest with no suggestions records the check), `tests/e2e/review-tags.e2e.mjs` (the "1 chapter was skipped" count rises to 2 on the second run; update the "The way here" check that expects Start to be read again).

### A2. Show who added a tag (small) (done, b879172)

- `TaggedChapters.tsx`: after each tag, a muted "(by hand)" when `source` is `author`. Pass `source` from `src/app/s/[id]/review/page.tsx` (it is on the rows `chapterTags` returns; check the type).
- Test in `tests/e2e/review-tags.e2e.mjs`: the hand-added tag shows "(by hand)", the approved AI one doesn't.

### A3. Flag approved tags on edited chapters (small) (done, 42a0f7d)

- `chapterTags` already returns `stale` (the row's revision is older than the chapter's). In `TaggedChapters.tsx`, show "chapter edited since" after a stale tag, as `TagSuggestions.tsx` does for suggestions.
- On a chapter with a stale tag, add a "Check again" link to `?tab=tags&chapter=<id>` (that page's Find tags with This chapter re-reads it). No new API.
- Test: approve a tag, PATCH the chapter's body, reload, see the flag and link.

## Phase B: review work on the server

Read `docs/server-queue-plan.md` "Notes for agents" first; its rules apply (no imports from `src/components/` in server code, `handlePost`, build before tests).

### B1. A "tags" AI run mode (medium) (done, 0483908)

Built as: migration 34 rebuilds `ai_runs` to allow the mode; the server makes the tasks from `options.tagScope` (`chapter`, `path`, `subtree`, `story`) and `start_chapter_id`, so `POST /api/ai-runs` for mode `tags` sends no tasks. A run with nothing left to check is made with 0 tasks.

- `src/lib/aiRuns.ts`: add `"tags"` to `RUN_MODES`; allow `start_chapter_id` null for it, like pictures. Add the task type in `src/lib/aiRuns/types.ts`: `{ kind: "tags"; id; chapterId; revision; status; error? }`.
- When the run is created, build one task per chapter in scope (chapter, way here, from here on, or the whole story; scope in `options`), leaving out chapters already checked (A1).
- `src/lib/aiRuns/runner.ts`: a step for a `tags` task calls `suggestTagsForChapter` (`src/lib/ai/tagAi.ts`, which only needs `fetch`) with the server's settings and `role: "cheap"`, then saves through `POST /api/chapters/:id/tags/suggest` with the fetch the runner is given (see how `doPrompt` and `saveSummaries` take `f`). A 409 marks the task skipped.
- Tests: an API test like `tests/api/queue-runs.test.mjs` with `tests/fakeAi.mjs`: a two-chapter run makes two AI calls and leaves suggestions; a re-run makes none.

### B2. Find tags uses the run for more than one chapter (medium, Ask first: question 3) (done, aa3040e)

- `TagScan.tsx`: for every scope except This chapter, `POST /api/ai-runs` with mode `tags`, then show progress with `AiRunProgress.tsx` (see how `WriteAhead.tsx` and `MissingPictures.tsx` use it). This chapter stays in the page as today, with the main model.
- Keep the message texts ("Read N chapters; found M new suggestions. K chapters were skipped (already decided).") by building them from the run's tasks.
- Update `tests/e2e/review-tags.e2e.mjs` and run `tests/e2e/write-ahead.e2e.mjs` and the queue tests too.

## Phase C: stage 3 checks

### C1. Fact extraction (medium) (done, a76216b)

- New `src/lib/ai/factAi.ts`: `extractFacts(settings, {story, chapter, codexNames, signal, role})` returns `{entity, attribute, value, quote}[]`. Keep the prompt small (chapter text, active codex entry names, nothing else). Drop facts whose quote isn't in the text (reuse `quoteInText` from `tagAi.ts`). Follow `tagAi.ts` for prompt and parsing style.
- Unit test with canned replies in `tests/unit/` (see `tests/unit/tag-ai.test.mts`).

### C2. Facts storage and a "facts" run task (medium) (done, a7c7d05)

Built as: migration 35 (chapter_facts, chapter_fact_checks, mode `tags` renamed `review`). A review run reads facts only when `options.checks` includes `"facts"` (default `["tags"]`), so Find tags still makes one call per chapter. `GET /api/chapters/:id/facts` returns `factsAlongPath`.

- Migration: `chapter_facts(id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id), revision INTEGER NOT NULL, entity TEXT NOT NULL, attribute TEXT NOT NULL, value TEXT NOT NULL, quote TEXT NOT NULL)`, index on `chapter_id`.
- `src/lib/facts.ts`: `saveFacts(chapterId, revision, facts)` (replaces that chapter's rows; 409 if the revision is old) and `factsAlongPath(chapterId)` (facts of the root-to-chapter path, in order, only rows at each chapter's current revision).
- Route `POST /api/chapters/:id/facts`.
- Add a `facts` task kind to the `tags` run mode from B1 (rename the mode to `review` if B1 shipped as `tags`, in the same commit), skipping chapters whose facts are at the current revision.
- Tests: API test for save and the 409; run test with the fake AI.

### C3. Continuity fold in plain code (medium) (done, ed80285)

- `src/lib/continuity.ts`, pure: `findConflicts(path: {chapterId, facts}[], changeEvents)` walks the path, keeps the latest value per (entity, attribute) (case and spacing ignored), and returns a conflict when a value changes without an approved change event on that chapter (a tag whose name the caller passes, e.g. tf, tg). Each conflict has both chapters and both quotes.
- Unit tests only. No AI.

### C4. Continuity issues on the Review page (medium)

- AI judge: `judgeConflict` in `factAi.ts` answers "contradiction", "change" or "fine" for one conflict. Store the verdict with the facts so it isn't asked again (a `verdicts` table keyed by both fact ids, or a JSON column; say which).
- `src/lib/review.ts`: add kind `continuity` to `ISSUE_KINDS`; issues come from conflicts judged "contradiction". The fingerprint is a short hash of the kind and both quotes, so several issues on one chapter stay apart.
- Issues tab: a "Continuity" section under Summaries, each issue with both quotes and links to both chapters, and Later/Dismiss as today.
- Tests: `tests/api/review.test.mjs`, `tests/e2e/review.e2e.mjs`.

### C5. The Intentional action (medium)

- `IssueActions.tsx`: an "Intentional" action for continuity issues, asking for a short note ("a disguise"). It writes a codex note op anchored at the chapter (see `src/lib/codexDb.ts` and `codex.ts` op shapes) and saves the decision with status `intentional` and the note (`decideIssue` takes the note).
- Intentional issues show in the Dismissed section with their note.

### C6. Codex gaps (medium)

- From facts: entities that appear in two or more chapters on a path with no codex entry (`foldCodex` at that chapter) become issues of kind `codex-missing`, anchored at the first appearance, with a link that opens the codex scan for that chapter (`?chapter=<id>`, the Codex section of the Issues tab).
- Name variants ("Jon" and "John"): leave for later unless cheap; note it here if skipped.

### C7. Summary that doesn't match its chapter (medium)

- `summaryCheck` in a new `src/lib/ai/summaryCheckAi.ts`: "does this summary leave out key events or add things not in the text?", answering ok or a one-line problem. Store the answer per chapter revision (a column or small table; migration).
- Issue kind `summary-wrong`, with "Fix the summary" like the other summary issues. Run it as a task in the review run.

### C8. State tags (design, Ask first: question 1)

- `tag_ops(id, story_id, chapter_id, tag_id, subject, value, op open|close, status suggested|approved|rejected)`, folded along the path like codex ops. The AI suggests ops from the facts; the author approves them in a new "Stretches" list on the Tags tab. Plan this with the owner before building.

### C9. tf follow-ups (medium, after C8)

- Approving a tf event offers the matching codex change (species or form, anchored at that chapter) and opening a species stretch.

## Phase D: tags for readers and the outline (Ask first: question 4 for each)

- **D1.** A per-tag "Show to readers" switch in Settings > Tags (a column on `tags`, migration).
- **D2.** Content notes under each choice on the chapter reading page: the approved, shown-to-readers event tags of the chapter it leads to ("ahead: violence, tf"); maybe its subtree too (ask). A reader setting to hide them.
- **D3.** Outline: tag chips on chapters and a "highlight branches tagged X" option in the page menu, each switchable in Settings > Outline like the Review marker.

## Phase E: automatic runs

- **E1. After save (medium).** A setting in Settings > Tags, off by default: "Check tags and facts when a chapter is saved". When on, saving a chapter (the PATCH and POST chapter routes, server side) queues a review run for that chapter. No browser work needed now that runs are on the server.
- **E2. After an AI run (small).** When a write-ahead, grow-the-tree or reach-a-goal run finishes, and E1's setting is on, queue a review run for the chapters it wrote.
- **E3. AI mark on the Review page (small, Ask first: question 2).** If the owner wants it: an issue kind `ai-unreviewed` for chapters with `ai_run_id` and no `ai_reviewed_at`, with a "Mark reviewed" action that calls `POST /api/chapters/:id/reviewed`.
- **E4. Nightly (design).** Only if the owner asks: a daily review run for chapters changed that day.

## Not verified anywhere yet

- Nothing in review or tags has been tried on a real phone or against the owner's real models. Prompt quality with a small local model is unknown; ask the owner to try Find tags and Help me write it after phase A.
- The new browser tests have not been run with Edge on the owner's Windows machine.
