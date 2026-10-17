# TODO when sober: single-writer simplification review

Written 2026-10-16 after a read-through of the app following the move to a single writer.
Nothing here has been changed yet. Review it, mark each item **do / skip / change**, and hand
the file back.

Auth removal itself is clean (no edit keys, author columns or admin password left). What remains
is stale wording and a little structure from the multi-user and soft-delete era.

## Behavior-neutral cleanups (recommended)

- [ ] **1. Stale comments and docs still describe the old model.**
  - `src/lib/tree.ts:35`, `:47`, `:56`: "live chapter", "Removed chapters and choices are left out".
  - `src/lib/stories.ts:200` and the `live` variable in `editChapter`: same "live vs removed" wording.
  - `scripts/adminCore.mjs:1-3`: "Moderation operations … the web admin page and the CLI share one
    implementation". There is no web admin page.
  - `tests/api/admin-cli.test.mjs:1`: "command-line moderation tool".
  - `README.md:37` and `:76`: "each person's Settings".
- [ ] **2. Unreachable-chapter filter in `getStoryChapters`** (`src/lib/tree.ts:45-52`). It only
  mattered when a parent could be hidden by a removal flag. Deletes are permanent and cascade now,
  so it can't drop anything.
- [ ] **3. Duplicate "parent chapter missing" check in `createChapter`** (`src/lib/stories.ts:262-264`).
  Unreachable: both branches already throw earlier.
- [ ] **4. (Optional) Recursive "descendants" query written four times**: `stories.ts:187`,
  `stories.ts:363`, `scripts/adminCore.mjs:43`, and migration 3. The migration must stay frozen and
  the CLI is plain `.mjs`, so only the two in `stories.ts` merge easily.
- [ ] **5. (Optional, low value) Merge `adminCore.mjs` into `admin.mjs`.** The split existed so a web
  admin page could share the code; the CLI is the only caller now.

## Needs your decision

- [ ] **9. `SYSTEM_BASE` says "many people write together"** (`src/lib/ai/prompts.ts:46`). The only
  user-visible leftover. One-phrase edit, but it changes drafting behavior and the prompt tests
  (`tests/unit/prompts.test.mts`) would need updating. Suggested wording: "…a branching,
  choose-your-own-adventure story."
- [ ] **10. One lint error** (`src/components/OutlineSummaries.tsx:31`): setState inside an effect.
  Predates the auth change. Quick fix.

## Recommend keeping as-is

- **6. `chapters_one_child_per_choice` index and its 409 handling.** Can still fire from two tabs;
  cheap guard against corrupt data.
- **7. `base_revision` conflict checks on edit and summary writes.** Same reason (two tabs).
- **8. Two summary write paths (POST fills, PUT overwrites).** Differ by intent (background vs
  manual edit), not by caller; see `HANDOFF.md`. Merging risks a background save overwriting a
  manual edit.

## Suggested plan

Do 1, 2, 3, 9 and 10 in one small commit (tests: `node tests/run.mjs --build unit api e2e`). Treat 4
and 5 as optional follow-ups.

## Your notes

<!-- Add feedback here, then give the file back to Claude. -->
