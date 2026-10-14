# StoryTime handoff

State as of commit `92f3be9` on `main` (nothing pushed). All suites pass:
`node tests/run.mjs --build unit api e2e`. Read `AGENTS.md` first: this Next.js (16.4) differs
from what you may know, so check `node_modules/next/dist/docs/` before touching framework code.

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
   - Correction to an earlier note: the chapter's Summary page already lets its author edit and
     regenerate summaries (`SummaryPanel.tsx`, PUT with the edit key). What is still missing is a
     way for anyone else to improve a summary; the server only fills empty ones for them.
3. **Export extras.** Import from the JSON export (restore or move a server); an "include
   unfinished branches" option for the HTML export; EPUB; the numbered "gamebook" variant.
4. **Outline page.** All branches are open by default now; a large story might want "collapse
   all / expand all" (needs a small client component) and a way to hide the per-row export links.
5. **Codex follow-ups.**
   - A codex export for the whole story across branches (currently one branch at a chapter).
   - Codex changes held in a draft are not shown on the chapter's own `/codex` page until posted
     (expected, but could be mentioned there).
6. **Housekeeping (done, with limits).**
   - Existing chapters keep their older short summaries until someone runs "Redo summaries". It
     only rewrites chapters whose edit key is in that browser; other people's chapters are
     filled in only when empty, so a story with several authors needs each of them to run it. If
     that proves annoying, the server would need a deliberate way to accept replacements (for
     example an admin-only endpoint).
   - Chapters below one someone else owns keep their old story-so-far, which was built from the
     old parent summaries. That is acceptable but not perfectly consistent.

## Gotchas learned

- The API and browser suites run against a built app: use `--build` after changing source.
- `replace` codex ops reset any field not sent (aliases, always-include), so send full entries.
- Heredocs that contain backslash escapes get mangled in the Bash tool; use the Edit tool.
- Summary prompts live in `src/lib/ai/summaries.ts`; context tiers in `src/lib/ai/prompts.ts`
  (`storyTiers`, `buildStorySoFar`).
