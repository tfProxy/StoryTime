# StoryTime handoff

State as of commit `f33789e` on `main` (nothing pushed). All suites pass:
`node tests/run.mjs --build unit api e2e`. Read `AGENTS.md` first: this Next.js (16.4) differs
from what you may know, so check `node_modules/next/dist/docs/` before touching framework code.

## Single-user change (done) and where it left loose ends

The app is single-user: no edit keys, author names, admin page or `ADMIN_PASSWORD`. Anyone who can
reach the site can read and edit everything. The old multi-user version is tagged `last-multi-user`
(commit `59bf0a9`). Neither that tag nor the new commit has been pushed, and `package.json` is still
`0.1.0` (a `0.2.0` bump was suggested but not approved).

Caveats left on purpose, which a cleanup pass can revisit:

- **Dead columns.** `author_name` (stories, chapters, choices, codex_ops, chapter_revisions),
  `edited_by` and `edit_key_hash` are still in the schema (`src/lib/db.ts`) but nothing reads or
  writes them; new rows keep the defaults. Dropping them needs a new migration (SQLite
  `ALTER TABLE ... DROP COLUMN`, or a table rebuild) and changes to the places below.
- **The CLI still knows about authors.** `scripts/adminCore.mjs` selects `author_name` for its
  "recent" listing, copies `author_name`/`edited_by` into revisions on revert and sets
  `edited_by = 'admin'`; `scripts/admin.mjs` prints "(by ...)". Update these together with the
  columns. `tests/api/admin-cli.test.mjs` exercises it.
- **Removal machinery.** `removed_at` and the remove/restore/hard-delete logic now exist only for the
  CLI. Every read query still filters `removed_at IS NULL`, and `getPath` treats a removed ancestor as
  hiding its branch. Decide whether to keep soft-delete, or replace it with a plain delete.
- **"First poster wins" index.** `chapters_one_child_per_choice` is kept as a safety net; the 409
  message is "A chapter is already written for that choice". With one user it can only trigger from
  two tabs.
- **Two summary write paths.** `fillSummaries` (POST, only fills empty values) and `replaceSummaries`
  (PUT, overwrites) used to differ by who could call them. Now both are open, so they could be one.
  Callers: `BulkSummaries.tsx` and `SummaryPanel.tsx` use PUT; `saveSummaries` in
  `src/lib/ai/summaries.ts` (used when posting and by `ensurePathSummaries`) uses POST.
- **AI prompt wording.** `SYSTEM_BASE` in `src/lib/ai/prompts.ts` still says the story is one "that
  many people write together". Left alone because changing it alters drafting behavior and the
  prompt tests.
- **Test fixtures.** Several e2e files still put `authorName` in localStorage settings, and some API
  requests still send `author_name` / `edit_key` (the schemas strip unknown keys, so they are
  ignored). Remove them for tidiness.
- **Lint.** `npm run lint` reports one error, in `src/components/OutlineSummaries.tsx` (setState
  inside an effect). It predates the change.
- **Line endings.** Working copies on this machine are CRLF even though `.gitattributes` says LF, so
  git prints "CRLF will be replaced" warnings on commit. Harmless. Tools that match multi-line text
  need to allow for it.

## How the app is laid out

- Server: SQLite via `src/lib/db.ts`; stories in `src/lib/stories.ts`, codex in `src/lib/codexDb.ts`
  and the pure fold in `src/lib/codex.ts`; exports in `src/lib/export.ts` and `exportHtml.ts`.
- Browser only: AI keys, settings and drafts (IndexedDB, `src/lib/drafts.ts`). Nothing about a
  draft may reach the server before posting (a hard requirement from the user).
- The drafting page is `src/components/ChapterEditor.tsx` (four steps: brainstorm, write, summary
  and choices, post). Codex changes made there are held in the draft (`draft.codexChanges`) and
  posted with the chapter via `codex_changes`; picking an earlier chapter saves immediately.
- Tests: `tests/unit`, `tests/api`, `tests/e2e` (Playwright, Edge, fake AI server on port 3222).
- Git: commit only when asked, never push unasked. Commit messages need the attribution line from
  the session's system reminder. In PowerShell write the message to a file and use `git commit -F`;
  inline multi-line messages with quotes break.

## Done recently (so you don't redo it)

Disable-thinking setting and prompt preview; draft versions with `<` `>`; four-step drafting
flow with per-chapter paragraph summaries and tiered story-so-far context; codex entries readable
and editable from the drafting page, held in the draft; summary kept when editing a chapter;
Twee export drops unfinished branches; offline HTML export (remembers read chapters, resettable);
single-route Markdown export (`?format=md&to=<chapter>`); codex Markdown export; outline page
full width and fully expanded.

Housekeeping pass (uncommitted at the time of writing, see `git status`): a "Redo summaries" tool
per story (`/s/[id]/summaries`, linked from the outline; `BulkSummaries.tsx`, `getStoryChapters`
in `src/lib/tree.ts`); old edit drafts now pick up the chapter's summary when reopened;
`.gitattributes` pins LF so the CRLF warnings are gone.

## Still to do (my suggestions, none approved yet)

1. **Codex when writing a story's first chapter.** `/new` has no codex panel because there is no
   earlier chapter to anchor entries to. Now that changes are held in the draft, the panel could
   work there: anchor them at the new first chapter on post. `NewStorySchema` would need
   `codex_changes` and `createStory` the same transaction wrapper (`saveWithCodexChanges`).
2. **Summary improvements discussed with the user.**
   - Group or arc summaries (for example every ~8 chapters) for very long stories.
   - The chapter's Summary page lets you edit and regenerate summaries (`SummaryPanel.tsx`).
3. **Export extras.** Import from the JSON export (restore or move a server); an "include
   unfinished branches" option for the HTML export; EPUB; the numbered "gamebook" variant.
4. **Outline page.** All branches are open by default now; a large story might want "collapse
   all / expand all" (needs a small client component) and a way to hide the per-row export links.
5. **Codex follow-ups.**
   - A codex export for the whole story across branches (currently one branch at a chapter).
   - Codex changes held in a draft are not shown on the chapter's own `/codex` page until posted
     (expected, but could be mentioned there).
6. **Housekeeping (done, with limits).**
   - Existing chapters keep their older short summaries until "Redo summaries" is run for the story.
   - Chapters below an edited one keep their old story-so-far until it is rebuilt (an edit clears
     the descendants' rolling summaries, and they are refilled on demand).

## Gotchas learned

- The API and browser suites run against a built app: use `--build` after changing source.
- `replace` codex ops reset any field not sent (aliases, always-include), so send full entries.
- Heredocs that contain backslash escapes get mangled in the Bash tool; use the Edit tool.
- Summary prompts live in `src/lib/ai/summaries.ts`; context tiers in `src/lib/ai/prompts.ts`
  (`storyTiers`, `buildStorySoFar`).
