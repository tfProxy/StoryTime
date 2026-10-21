<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Running the tests

- `npm test` runs the unit and API suites; `npm run test:e2e` runs the browser suite. To run only some files, add part of their names after the suite: `node tests/run.mjs e2e illustrate-resume chapters` (one browser file takes about 10 s; the whole browser suite is 25 files, one after another). For a small change, run the files that cover it, and the whole suite only before finishing a larger one. Run `npx next build` first after changing app code: the API and browser suites start `next start` on the existing build and only build when there is none.
- The browser suite uses Microsoft Edge by default (the owner's local Windows/VS Code setup). In a cloud sandbox, use the preinstalled Chromium: `E2E_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e`.
- All 14 browser test files that existed then passed in a cloud session on 2026-10-19 (run four times in a row); there are 25 now. The only lint error is a known one in `src/components/OutlineSummaries.tsx` (set-state-in-effect).
- AI settings live on the StoryTime server, not in the browser. Browser tests must point the app at the fake AI server with `useMockAi(BASE, ...)` from `tests/e2e/browser.mjs` (and call `restore()` at the end). Writing settings into `localStorage` only takes effect when the server has none yet, so it silently does nothing once an earlier test has saved settings. That made `chapters`, `codex-ai` and `summaries` fail until it was fixed.
- The test files share one server and database, in alphabetical order. A test that leaves a draft behind (for example the `story` draft for /new) changes what the next test sees, so delete drafts a test creates.
- To check next time this runs on the owner's machine (not a cloud session): run `npm run test:e2e` with Edge and confirm all the files pass (25 at last count). If any fail only there, add a note here saying which test fails and why.
