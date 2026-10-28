# Handoff: story review (checks and tags)

**Out of date (2026-10-27): this was written when only stages 1 and 2 existed. Most of "What's next" is now built; see `TODO/review-plan.md`. "What exists" (stages 1 and 2) and "Tests" are still accurate.**

Written 2026-10-22 at the end of a cloud session, for the next agent picking up this feature. Read `CLAUDE.md`, `AGENTS.md` and the "Story review: checks and tags" section of `TODO.md` first. That TODO section is the agreed plan. This file adds what has been built, how it works, the rules for working with the owner, and the plans that are not written down in TODO.

## Where things stand

- **Stages 1 and 2 of 5 are built and on `main`**, including dismissing issues (added 2026-10-23). CI passed on every commit.
- **Stage 1:** the Review page, free summary checks, the codex scan on the Review page, and the outline marker.
- **Stage 2:**
  - The shared tag library in Settings, with AI help writing rules and "Try it".
  - Event tags suggested by the AI and approved by the author.
  - Tagging by hand.
  - A per-story switch for each tag.
  - Later, Dismiss and Undo on Review issues (migration 29).
  - Branch scope for Find tags (The way here, From here on).
- **Not built:**
  - The Intentional action (it comes with the stage 3 continuity checks).
  - Skipping chapters already checked at their current revision.
  - Stages 3 to 5.
  - Everything in "Planned but not in TODO" below.

## Working with the owner

- **"Ship it"** follows the process in `CLAUDE.md`:
  1. Run the checks for the size of the change.
  2. Commit.
  3. Merge `origin/main`.
  4. Push the branch, then `git push origin HEAD:main`.
  5. Wait for CI (about 5 minutes) and fix anything until it is green.
  6. Tell the owner the NAS can be updated.
- **Ship at good stopping points**, so main makes progress in increments. One logical change per commit.
- **Use subagents on cheaper models for simple, well-specified tasks**, and break work into stages so they can. Review their diffs yourself and run the checks before shipping: they have sometimes edited with `sed` or scripts, which `CLAUDE.md` forbids.
- **Ask about UI placement** (which page and which section) before building anything new on a page.
- **Flag migrations** when you report.
- **Open questions:** the owner put off answering how the starter rules should handle these. Ask before changing the rules or building state tags.
  - Do dreams or visions count?
  - Does a change that is reversed in the same chapter count?
  - Do partial changes count (ears, a tail)?
- **Default decided:** every tag starts on for every story, and the author switches off the ones that don't fit.

## What exists

### Stage 1: Review page and free checks

- **`src/lib/review.ts`**
  - `reviewIssues(storyId)` and `issueCounts(storyId)`.
  - Kinds: `summary-missing` and `summary-stale`.
  - A summary is stale when the previous `chapter_revisions` row (`revision = c.revision - 1`) has a different body but the same summary. No migration was needed.
  - There is no `removed_at` filter on chapters: that column was dropped in migration 3.
- **`GET /api/stories/:id/review`** returns `{issues}`.
- **`src/app/s/[id]/review/page.tsx`**
  - Tabs: Issues (default) and Tags (`?tab=tags`). `?chapter=<id>` filters to one chapter.
  - Summaries section: "Fix the summary" links go to `/c/<id>/summary`.
  - Codex section: a chapter picker, then `<CodexAiScan defaultOpen/>`.
- **Outline marker (`src/app/s/[id]/outline/page.tsx`)**
  - The ⚠ count adds the summary issues and the pending tag suggestions.
  - It links to `?tab=tags` when tag suggestions are the only thing pending.
  - The outline's links are built as an array and joined with ", ", so `NodeSummary` never gets an empty child. Keep that pattern if you add links there.
- **Setting:** Settings > Outline > "Review marker" (`OutlineOptions.review`, default on, in `src/lib/settingsSchema.ts`).
- **Links to the Review page:** "Review" in the story list's ☰ menu (`src/app/page.tsx`) and "Review the story" in the outline's page menu.

### Stage 2: tags

- **Migration 27** (`src/lib/db.ts`) adds three tables:
  - `tags`: id, name, applies, not_applies, kind (`event` or `state`), choices (JSON), examples (JSON), created_at, removed_at. Names are unique among live tags; code checks this.
  - `story_tags(story_id, tag_id)`.
  - `chapter_tags`: id, chapter_id, tag_id, value, status (`suggested`, `approved` or `rejected`), source (`ai` or `author`), quote, reason, revision, created_at, decided_at. `UNIQUE(chapter_id, tag_id)`, so a chapter has at most one row per tag.
- **Migration 28** adds `story_tags.enabled` (default 1). A tag is on for a story unless its row says `enabled = 0`.
- **`src/lib/tags.ts`**
  - **Library:** `listTags`, `createTag`, `updateTag`, `removeTag` (soft delete) and `addTagExample`.
  - **Switches:** `storyTags` returns the ids of the tags that are on; `setStoryTag` upserts the switch.
  - **`chapterTags`** includes a `stale` flag (the row's revision is older than the chapter's). It and `pendingTagCounts` hide tags that are switched off, using the `TAG_ON` NOT EXISTS clause.
  - **`suggestTags(chapterId, revision, suggestions, checkedTagIds)`:**
    - Returns 409 if the chapter changed meanwhile.
    - Ignores tags that are off.
    - Keeps approved rows, and rows rejected at the same revision.
    - Turns any other row into a fresh suggestion.
    - Deletes old 'suggested' rows for tags that were checked but not raised this time.
  - **Decisions:** `decideChapterTag` (approve or reject, with `add_example`, which saves the quote as a "doesn't count" example), `addChapterTag` (by hand: approved, source author) and `removeChapterTag`.
- **`src/lib/ai/tagAi.ts`** (runs in the browser through `completeChat`)
  - `suggestTagsForChapter` makes one call per chapter covering all of the story's tags. It drops suggestions whose quote is not in the chapter text (`quoteInText`). `role: "cheap"` uses the cheaper model.
  - `draftRule` turns a rough idea ("tf: a character changes species") into a name, applies, not_applies and choices.
- **API routes**
  - `/api/tags`: GET, POST.
  - `/api/tags/[tagId]`: PATCH, DELETE.
  - `/api/tags/[tagId]/examples`: POST.
  - `/api/stories/[id]/tags`: GET returns `{tags, enabled}`; PUT takes `{tag_id, on}`.
  - `/api/stories/[id]/chapter-tags`: GET.
  - `/api/chapters/[id]/tags`: POST (by hand).
  - `/api/chapters/[id]/tags/suggest`: POST (saves the AI's suggestions).
  - `/api/chapter-tags/[id]`: PATCH (decide), DELETE.
- **UI**
  - `TagLibrary.tsx` is the Settings > Tags tab (`/settings#tags`, between Outline and Backup). It has a list and editor, "Help me write it", "Write it myself", "Try it" on up to 5 chapters of a chosen story without saving, and examples.
  - On the Review page's Tags tab:
    - `StoryTagSwitches.tsx`: the per-story switches, in a `<details>` here and as a card on `/s/[id]/details`.
    - `TagSuggestions.tsx`: Waiting for you, with Approve, Reject, and "Reject and add as example".
    - `TaggedChapters.tsx`: approved tags, with remove (×) and Add a tag.
    - `TagScan.tsx`: Find tags, for this chapter or the whole story. It can be stopped. The whole story uses the cheaper model.

### Built differently from the TODO design (decide whether to close the gap)

- A tag has no **short label** field yet; only a name.
- `kind: "state"` can be saved, but nothing treats state tags differently yet (stage 3).
- No **Intentional** or **Later** actions, and no fingerprints: they need the review items table.

## Tests

| Area | Files |
|---|---|
| Review page | `tests/api/review.test.mjs`, `tests/e2e/review.e2e.mjs`, `tests/e2e/outline.e2e.mjs` |
| Tags | `tests/unit/tag-ai.test.mts`, `tests/api/tags.test.mjs`, `tests/e2e/tag-library.e2e.mjs`, `tests/e2e/review-tags.e2e.mjs` |
| Migrations | `tests/unit/migrations.test.mts`: add a case for each new migration |
| Settings tabs | `tests/e2e/illustrate-comfy.e2e.mjs` expects the tab list `Connections,Writing,Drawing,Qwen edit,Flux edit,Outline,Tags,Backup`; update it if you add a tab |

**Sandbox gotchas**

- **Browser tests:** set `E2E_EXECUTABLE=/opt/pw-browsers/chromium`. Without it the suite tries Edge and reports "0 checks".
- **Build first:** run `npx next build` before the API and browser suites. It sometimes stops with a Next.js security-advisory message suggesting `next upgrade --agent=security`; running it again works. The upgrade has not been run. Offer it to the owner as a separate change; don't fold it in.
- **Mock AI:** AI tests use a mock server and `useMockAi(BASE, …)` and `restore()` from `tests/e2e/browser.mjs`. Match requests by text in the system or user prompt (see `tag-library.e2e.mjs`).
- **Reloading in tests:** going to the same URL with a new hash does not reload the page; use `page.reload()`. Use `exact: true` for short texts like "Saved.".
- **Screenshots**
  - Start the app on a scratch database: `STORYTIME_DB=<scratch db> nohup npx next start -p 3737 &`.
  - Take them with `node tests/shot.mjs <paths> --out=<scratchpad dir>`. `shot.mjs` cannot click, so open `<details>` states in a test instead.
  - Stop the server by PID: `ps -eo pid,args | awk '/next-server/ && !/awk/ {print $1}'`. Never use `pkill -f`: it kills its own shell.
- **API shape:** `/api/stories` returns a bare array.
- **CSS variables:** `--bg --fg --muted --line --card --accent --accent-fg --warn`. There is no `--border`. Checkboxes need the `inline-label` class and `padding: 0`, or the global `label` and `input` rules stretch them.
- **Lint:** the only allowed error is the known one in `OutlineSummaries.tsx`.
- **Full suite before pushing:** a migration or shared-code change needs the whole browser suite. It was 41 files and 1222 checks at hand-off; unit and API were 37 files and 1626 checks.

## What's next, in order

**Superseded on 2026-10-27 by `TODO/review-plan.md`**, which splits the rest into small tasks for cheaper agents and takes in what changed on main (the server now runs AI work). The notes below are kept as background.

### 1. Review items table and dismissing (done 2026-10-23)

- **Built:** migration 29 adds `review_items(id, chapter_id, kind, fingerprint, status dismissed|later|intentional, revision, note, decided_at)`, unique on (chapter_id, kind, fingerprint).
  - The table stores only decisions. Issues are still worked out when asked for.
  - A decision counts only while `revision` equals the chapter's revision, so an edit brings the issue back.
- **Library:** `reviewIssues` returns `fingerprint` and `status` (`open`, `later` or `dismissed`; `intentional` reads as dismissed for now). `issueCounts`, and so the outline marker, counts only open issues. `decideIssue` records a decision, or undoes one when given status `open`.
- **API:** `PUT /api/chapters/:id/review {kind, fingerprint?, status}`.
- **UI:** on the Issues tab, open issues have Later and Dismiss. A "Later" heading holds put-off issues, with Back to the list. Dismissed issues are in a folded "Dismissed (N)" section, with Undo. The buttons are in `src/components/IssueActions.tsx`.
- **For stage 3:**
  - Continuity issues need a real fingerprint: a short hash of kind and the quoted text(s), so several issues on one chapter stay apart.
  - Add the **Intentional** button. It should write a codex note at that chapter (a `codex.ts` op) and save status `intentional` with the note.
  - Add the new kinds to `ISSUE_KINDS` in `review.ts`.

### 2. Branch scope for Find tags

- **Done.** With a chapter chosen, `TagScan` offers This chapter, The way here (first chapter to this one), From here on (this one and every chapter below it) and The whole story. Each option shows only when it covers more than the chapter itself. Everything but This chapter uses the cheaper model. The path and subtree are worked out in `TagScan.tsx` from `parent_id`.
- Still to do: skip chapters whose tags were already checked at their current revision. The data is there: a row's revision equals the chapter's revision. This needs a "checked at revision" record per chapter, because a chapter with no suggestions has no row. Either add a small `chapter_tag_checks(chapter_id, revision, checked_at)` table in the same migration as `review_items`, or fold it into the stage 3 facts table.

### 3. Stage 3: facts, continuity and state tags

- **One AI pass per chapter revision**, with the cheaper model, pulls out facts: `(entity, attribute, value, quote)`.
  - Store them in `chapter_facts(chapter_id, revision, entity, attribute, value, quote)` so unchanged chapters are never re-read.
  - Plan: do event tagging in the same call, to halve the calls. Keep prompts small for local models: send the chapter, the active codex entry names, and the story's tag rules only.
- **Continuity in plain code:** walk the root-to-chapter path and fold facts like codex ops. Flag a conflict when an entity's attribute changes value without a fact that marks a change (e.g. a tf event).
  - Then ask the AI only about those: "contradiction, a change in the story, or fine?" Each gets a quote from each chapter.
  - Results become review items (kind `continuity`), shown with two quotes.
- **Codex checks:**
  - Names that keep appearing with no codex entry: suggest a create anchored at the first appearance.
  - Entries a chapter contradicts: suggest a replace anchored at that chapter.
  - Alias variants ("Jon" and "John").
  - Reuse the op shapes from `codexAi.ts` and `CodexAiScan.tsx`.
- **Wrong summaries:** the AI compares a summary with the chapter text ("leaves out key events or adds things that aren't there"). The fix reuses `summaries.ts`.
- **State tags**
  - Store them as ops anchored at chapters: `tag_ops(id, story_id, chapter_id, tag_id, subject, value, op open|close)`, for example open `species: wolf` for Jim at chapter X.
  - Fold them along the path exactly like codex ops, so they apply only on that branch.
  - The AI suggests open and close ops from the facts. The author approves them in the Tags tab, in a new "Stretches" list.
- **tf event follow-ups:** an approved tf event should offer:
  - The matching codex change (the character's species or form, anchored at that chapter).
  - Opening a species state tag.
- **Roll-ups:** branch and story tags are the union of their chapters' approved tags. They are computed, need no approval and are not stored.

### 4. Stage 4: tags for readers and in the outline (ask where first)

- **Content notes at choices:** on the chapter reading page, under each choice, list the approved event tags of the chapter it leads to, e.g. "ahead: violence, tf". Optionally include that chapter's subtree; ask.
  - This needs a per-tag "show to readers" flag (a column on `tags`), because some tags are only for the author.
  - It probably also needs a reader-side setting to hide the notes.
- **Outline:** show tag chips on chapters, and a "highlight branches tagged X" filter in the page menu. Both should be optional in Settings > Outline, like the Review marker.

### 5. Stage 5: automatic runs

- **First step:** after a chapter is saved in the editor (`ChapterEditor.tsx`; grep for the save handler, don't read the whole file), run the free checks and, if the owner turns it on, `suggestTagsForChapter` with the cheaper model in the background.
- **Later:** background or nightly runs need the AI calls moved to the server. Settings already live on the server (`settingsStore.ts`), so a server-side `completeChat` is possible. This is a bigger change; ask first.

## Planned but not in TODO

- The short label field, the per-tag "show to readers" flag, and the `chapter_tag_checks` (or facts) record that lets a re-scan skip unchanged chapters.
- Deciding whether to fold tagging into the stage 3 fact pass, to save AI calls.
- Showing on the Tagged list which tags were added by hand and which by the AI (`source` is stored but not shown).
- Showing stale approved tags (chapter edited after approval) with a "check again" action. The `stale` flag exists; only suggestions show it today.
- Offering the Next.js security upgrade to the owner as its own change.
- Running the browser suite with Edge on the owner's Windows machine has not been done for the new files. `AGENTS.md` asks for that check.

## Not verified

- Nothing has been tried on a real phone or with touch. The checkboxes, the tabs and the Add a tag row were checked only in phone-width screenshots.
- AI prompts have only been tested against the mock server. The rule help and Find tags have not been run against the owner's real models, so prompt quality with a small local model is unknown.
