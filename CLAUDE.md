@AGENTS.md

# StoryTime

A single-writer branching-story app: Next.js (read `AGENTS.md` above first), React client components, SQLite through better-sqlite3, AI calls made from the browser.

## Docs

- Before changing the Illustrate page or anything in `src/lib/comfy/`, read `docs/illustrate.md` (how it works). Do not read the other files in `docs/` unless asked: `docs/pictures.md` and `docs/unraid.md` are setup guides for the owner. Planned work is in `TODO.md`. `TODO/` holds finished plans written for agents (server queue, story review, inpainting); read one only when asked or when its code needs changing.
- When behaviour that `docs/illustrate.md` describes changes, update it in the same change.

## File editing

- Change files with the Edit or Write tool. Do not use `sed`, shell heredocs, `echo` redirection, or Python/PowerShell scripts to edit source files: they have mangled `\n` escapes, backslashes and non-ASCII characters (☰, …, “ ”) in this repo, and batches of shell writes have failed silently.
- If an Edit fails on whitespace or indentation, Read the file again and retry with Edit.
- Scratch scripts and their output go in the scratchpad directory, not the repo.

## Working efficiently

- Read only what the task needs: `grep -n` for the function or text, then Read with `offset`/`limit`. Don't read whole large components (`ChapterEditor.tsx`, `ComfyGenerate.tsx`, `PictureSettings.tsx`) to change one part.
- Find the tests that cover a change with `grep -l` on the label or route in `tests/`, and run just those files.

## Verification before saying a change is done

Match the checks to the size of the change. GitHub Actions runs everything (typecheck, lint, all three suites, the Docker build) on every push, so the full browser suite is not needed locally.

- **Small UI tweak** (text, layout, one control): `npx tsc --noEmit`, `npx next build`, the browser files that cover it (`node tests/run.mjs e2e <name-part>`), and one phone-width screenshot.
- **Feature or bug fix:** as above, plus `npm test` and the browser files for every page the change touches; screenshots at desktop and phone width.
- **Shared code** (`src/lib/db.ts`, migrations, settings schema, `tests/e2e/browser.mjs`, the test runner): the whole browser suite before pushing.
- Screenshots: `node tests/shot.mjs <path>... --out=<scratchpad>` with the app running takes each page at desktop and phone width and prints the PNG paths. Look at the result and describe what you see, rather than relying on tests alone.
- The API and browser suites run against the existing build, so build first after changing app code, or a stale build gives false failures.
- React: never put hooks or effects after an early `return`.
- SQL: the number of `?` placeholders must match the parameters passed.
- After adding a migration (`MIGRATIONS` in `src/lib/db.ts`), restart the dev server: it caches the database connection and will not pick up the new schema.
- When finishing, say plainly what you could not verify (touch, a real phone, the NAS, a real ComfyUI) and give a one- or two-step manual check for it.

## Git

- One logical change per commit. Do not fold unrequested cleanup (fixture changes, column drops, refactors) into a requested change; ask first.
- **"Ship it"** means: run the checks for the size of the change (see Verification), commit, and get the work onto `main`. On `main` already (the owner's PC), `git pull` and push. On another branch (a cloud session gets its own), `git fetch origin main`, merge `origin/main` into the branch, push the branch, then `git push origin HEAD:main`. Then wait for the CI run on that commit (GitHub tools or `gh run watch`; about 5 minutes); if it fails, read the log, fix, and push again until it passes. Report the result in a line or two and say the NAS can be updated. If you can't see CI from where you are, say so and ask the owner to check the Actions tab.
- Otherwise, commit or push only when asked. Before pushing, list any other unpushed commits (`git log origin/main..HEAD --oneline`) and flag any that contain a migration or a destructive change.
- If git has no author identity configured, stop and tell the user; do not leave files staged.
- On PowerShell, write multi-line commit messages to a temp file and use `git commit -F`, or use a single-quoted here-string. Git Bash heredocs work too.

## Environment

- The dev machine is Windows (VS Code, PowerShell and Git Bash). Docker is not installed on it; the CI `docker` job builds the image and checks `/api/health`, so after changing `Dockerfile` push and check that job. `docker-compose.yml` itself is only tested on the NAS; say so.
- The app is deployed to a NAS that pulls `ghcr.io/tfproxy/storytime:latest`, which CI builds and publishes from main. Deploying is: push to main, wait for CI to pass, then Compose Pull and Compose Up on the NAS. The image is built from `Dockerfile` in CI: better-sqlite3 may need to compile from source, so the build stage needs `python3 make g++`; do not switch to a slim base image without keeping them.

## Ambiguous instructions

- If the user says "continue", "yes" or "go ahead" and more than one pending item could apply, ask which one.
- For UI placement requests, make sure of the exact page and section (the drafting page, the chapter reading page, the story list, the story details page, the outline). If it is not stated, ask before implementing.
