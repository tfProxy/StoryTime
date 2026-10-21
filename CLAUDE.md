@AGENTS.md

# StoryTime

A single-writer branching-story app: Next.js (read `AGENTS.md` above first), React client components, SQLite through better-sqlite3, AI calls made from the browser.

## Docs

- Before changing the Illustrate page or anything in `src/lib/comfy/`, read `docs/illustrate.md` (how it works). Do not read the other files in `docs/` unless asked: `docs/pictures.md` and `docs/unraid.md` are setup guides for the owner. Planned work is in `TODO.md`.
- When behaviour that `docs/illustrate.md` describes changes, update it in the same change.

## File editing

- Change files with the Edit or Write tool. Do not use `sed`, shell heredocs, `echo` redirection, or Python/PowerShell scripts to edit source files: they have mangled `\n` escapes, backslashes and non-ASCII characters (☰, …, “ ”) in this repo, and batches of shell writes have failed silently.
- If an Edit fails on whitespace or indentation, Read the file again and retry with Edit.
- Scratch scripts (for example a screenshot script) go in the scratchpad directory, not the repo.

## Verification before saying a change is done

- After any TypeScript or TSX change run `npx tsc --noEmit`, then the suites that cover it (`npm test` for unit and API, `npm run test:e2e` for the browser). The API and browser suites run against the existing build, so run `npx next build` (or `node tests/run.mjs e2e --build`) first, or a stale build gives false failures.
- For UI changes, look at the result: take a Playwright screenshot at desktop and phone width and describe what you see, rather than relying on tests alone.
- React: never put hooks or effects after an early `return`.
- SQL: the number of `?` placeholders must match the parameters passed.
- After adding a migration (`MIGRATIONS` in `src/lib/db.ts`), restart the dev server: it caches the database connection and will not pick up the new schema.
- When finishing, say plainly what you could not verify (Docker, touch, mobile, the NAS) and give a one- or two-step manual check for it.

## Git

- One logical change per commit. Do not fold unrequested cleanup (fixture changes, column drops, refactors) into a requested change; ask first.
- Commit or push only when asked. Before pushing, list any other unpushed commits (`git log origin/main..HEAD --oneline`) and flag any that contain a migration or a destructive change.
- If git has no author identity configured, stop and tell the user; do not leave files staged.
- On PowerShell, write multi-line commit messages to a temp file and use `git commit -F`, or use a single-quoted here-string. Git Bash heredocs work too.

## Environment

- The dev machine is Windows (VS Code, PowerShell and Git Bash). Docker is not installed on it, so changes to `Dockerfile` or `docker-compose.yml` cannot be tested here. Say so explicitly.
- The app is deployed to a NAS that builds the image from the GitHub repo. better-sqlite3 may need to compile from source, so the build stage needs `python3 make g++`; do not switch to a slim base image without keeping them.

## Ambiguous instructions

- If the user says "continue", "yes" or "go ahead" and more than one pending item could apply, ask which one.
- For UI placement requests, make sure of the exact page and section (the drafting page, the chapter reading page, the story list, the story details page, the outline). If it is not stated, ask before implementing.
