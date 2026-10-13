# StoryTime

Branching stories, written together with a little AI help. See the plan in the project history; phases 1-4 plus chapter editing are done: reader, posting and editing with revision history, browser-only AI settings (OpenAI-compatible incl. Ollama, and Anthropic), a local drafting editor, and the per-branch codex. AI codex helpers (scan for entries, draft and update entries) are in too. Rolling story summaries and one-click "Continue with AI" are in too. The admin tools are in too; Unraid polish is next.

## Run locally

```
npm install
npm run dev        # http://localhost:3000
```

Data lives in `data/storytime.db` (SQLite). Override with `STORYTIME_DB=/path/to/file.db`.

## Run with Docker (e.g. Unraid)

```
docker compose up -d --build
```

The database is stored in `./data` (mounted at `/data` in the container).

## Design rules

- No accounts or login. Author names are free-text attribution only.
- Posted chapters can be edited, but only by the browser that posted them. Posting creates a random edit key; the browser keeps it (and includes it in the settings export) and the server stores only its hash. Every edit keeps the previous version in `chapter_revisions`, and the chapter shows an "edited" marker linking to its history. The (future) admin tools can remove content via `removed_at`.
- A choice is "unwritten" until a chapter is posted for it; the first poster wins.
- Codex ops (`codex_ops` table) are append-only and anchored to a chapter; they apply to that chapter and its descendants.
- The codex is an append-only log per story: each op (create / replace / retire) is anchored at a chapter and applies to that chapter and its descendants. The codex at a chapter is the fold of the ops on the path from the root to it (deeper anchors win, then later posts). A change to the codex never touches chapter text, and other branches never see it.

## Tests

```
npm test            # unit + API tests (starts a throwaway server and database)
npm run test:unit   # pure-logic tests only
npm run test:api    # HTTP API tests
npm run test:e2e    # browser tests with Playwright (uses Microsoft Edge by default)
npm run test:all    # everything
```

The API and browser suites build the app if needed and run it on port 3111 with a temporary
database; the browser tests also run a fake AI server on port 3222. Set `E2E_CHANNEL=chrome`
(or `bundled`, after `npx playwright-core install chromium`) to use a different browser.
Pass `--build` (`node tests/run.mjs --build api`) to force a rebuild first.
- Each chapter can carry a `summary` (of itself) and a `path_summary` (the story through it). The browser generates them with the cheaper model when a chapter is posted or edited, and fills in any that are missing (for example below an edited chapter) before generating, but only when older chapters would not fit in the context budget. They are a cache: anyone can fill a missing one, and nobody can overwrite an existing one except the chapter's author by editing it.

## Moderation

Nothing public links to the admin tools. To use them:

- **Web:** set `ADMIN_PASSWORD` (for Docker, in the environment or a `.env` file next to `docker-compose.yml`) and open `/admin`. There you can scan recent activity, filter it, remove or restore chapters, choices, stories and codex changes, revert a chapter to an earlier revision, and permanently delete things that were removed first. Without a password set, `/admin` is switched off. Logins use a signed, expiring cookie, and repeated wrong guesses are temporarily blocked. If the site is reachable from the internet, serve it over HTTPS.
- **Command line** (on the machine hosting the database, no password needed): `node scripts/admin.mjs help`. In Docker: `docker exec -it <container> node scripts/admin.mjs recent 20`.

Removing a chapter hides it and everything below it, and the choice that led to it becomes an unwritten slot again (someone else can write a replacement). Restoring undoes that, unless the slot has been refilled in the meantime.
