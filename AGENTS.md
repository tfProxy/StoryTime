## Next.js version

This is Next.js 16 with React 19, newer than most training data. Don't read the docs up front. When you use a Next.js API you are not sure of (routing, `params`, caching, route handlers, config), read that one guide in `node_modules/next/dist/docs/01-app/` (`03-api-reference/` for APIs, `02-guides/` for topics; `grep -rl` to find it). Heed deprecation warnings from the build.

`agentRules: false` in `next.config.ts` stops `next dev` from writing its own, longer block here; leave it off.

## Running the tests

- `npm test` runs the unit and API suites; `npm run test:e2e` runs the browser suite. To run only some files, add part of their names after the suite: `node tests/run.mjs e2e illustrate-resume chapters` (one browser file takes about 10 s; the whole browser suite takes about 3.5 minutes). Run `npx next build` first after changing app code: the API and browser suites start `next start` on the existing build and only build when there is none.
- The browser suite uses Microsoft Edge by default (the owner's local Windows/VS Code setup). In a cloud sandbox, use the preinstalled Chromium: `E2E_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e`.
- GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, every suite (with the runner's Chrome, `E2E_CHANNEL=chrome`) and a Docker build plus health check on each push and pull request. All browser files passed in a cloud session on 2026-10-21.
- In a cloud session, `.claude/hooks/session-start.sh` installs packages, builds, and sets `E2E_EXECUTABLE`, so tests can run straight away. The only lint error is a known one in `src/components/OutlineSummaries.tsx` (set-state-in-effect).
- AI settings live on the StoryTime server, not in the browser. Browser tests must point the app at the fake AI server with `useMockAi(BASE, ...)` from `tests/e2e/browser.mjs` (and call `restore()` at the end). Writing settings into `localStorage` only takes effect when the server has none yet, so it silently does nothing once an earlier test has saved settings.
- The test files share one server and database, in alphabetical order. A test that leaves a draft behind (for example the `story` draft for /new) changes what the next test sees, so delete drafts a test creates.
- To check next time this runs on the owner's machine (not a cloud session): run `npm run test:e2e` with Edge and confirm every file passes. If any fail only there, add a note here saying which test fails and why.
