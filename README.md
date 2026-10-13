# StoryTime

Branching, choose-your-own-adventure stories written together, with optional AI help. Friends read
and write chapters in the browser; nobody signs in. Everyone brings their own AI (OpenAI,
Anthropic, or a local model through Ollama), and their keys never leave their browser.

## What it does

- **Read and write** branching stories. Any chapter can have any number of choices; a choice stays
  "unwritten" until someone writes the chapter for it (first poster wins).
- **AI drafting** in the browser: describe what should happen and the AI drafts the chapter,
  using the story so far and the codex. Revise with instructions, undo, suggest choices, then
  review and post. "Continue with AI" jumps straight to a draft.
- **Codex**: per-branch notes on characters, places and facts (a character who turns into a horse
  stays human on other branches). The AI can scan chapters for entries, draft entries, and bring an
  entry up to date with the story.
- **Edit your chapters later** from the browser that posted them; every earlier version is kept.
- **Outline and export**: a tree view of every branch, and downloads as readable Markdown, Twine
  (Twee) or full JSON.
- **Moderation**: a password-protected admin page and a command-line tool.

## Run locally

```
npm install
npm run dev        # http://localhost:3000
```

Data lives in `data/storytime.db` (SQLite). Override with `STORYTIME_DB=/path/to/file.db`.
Each person opens **Settings** in the app to choose an AI provider and paste their own key.

## Running on Unraid (or any Docker host)

The app is one container with one data folder. There's no public image, so build it once on the
server:

```
# on the Unraid terminal
cd /mnt/user/appdata
git clone <your repo or copy of this folder> storytime-src
cd storytime-src
docker build -t storytime:latest .
```

Then either:

- **Add Container (template):** copy `unraid/storytime.xml` to
  `/boot/config/plugins/dockerMan/templates-user/`, open **Docker > Add Container**, choose
  `storytime` from the template list, check the port (3000) and data path
  (`/mnt/user/appdata/storytime`), optionally set an admin password, and Apply.
- **Compose** (Compose Manager plugin, or any Docker host): `docker compose up -d --build`.

Notes:

- Put the data folder in your appdata backups, or use the built-in consistent copy, which is safe
  while the app runs: `docker exec storytime node scripts/admin.mjs backup /data/backups/storytime-$(date +%F).db`.
- The container reports health at `/api/health`.
- To update: pull or copy the new source, rebuild the image, and recreate the container. Database
  upgrades happen automatically on start.
- Before exposing it beyond your home network, put it behind a reverse proxy with HTTPS, or reach
  it over a VPN such as Tailscale. The site itself has no logins, so anyone who can reach it can
  read and post. The admin page has its own password.
- Local AI with Ollama: the browser talks to Ollama directly, so Ollama must allow the site's
  address (`OLLAMA_ORIGINS`), and the Ollama URL in each person's Settings must be reachable from
  their browser (use the PC's or server's LAN address, not `localhost`, unless Ollama runs on the
  same machine as the browser).

## Moderation

Nothing public links to the admin tools.

- **Web:** set `ADMIN_PASSWORD` (in the container's environment, or a `.env` file next to
  `docker-compose.yml`) and open `/admin`. You can scan recent activity, filter it, remove or
  restore chapters, choices, stories and codex changes, revert a chapter to an earlier revision,
  and permanently delete things that were removed first. Without a password set, `/admin` is
  switched off. Logins use a signed, expiring cookie and repeated wrong guesses are temporarily
  blocked.
- **Command line** (on the machine hosting the database, no password needed):
  `node scripts/admin.mjs help`. In Docker: `docker exec -it storytime node scripts/admin.mjs recent 20`.

Removing a chapter hides it and everything below it, and the choice that led to it becomes an
unwritten slot again, so someone else can write a replacement. Restoring undoes that, unless the
slot has been refilled in the meantime.

## How it works

- No accounts or logins. Author names are free-text attribution only.
- The server stores only stories (chapters, choices, codex changes). AI keys, settings, drafts and
  edit keys live in each person's browser; the settings page can export them to a file.
- A chapter can be edited only by the browser that posted it: posting creates a random edit key
  that the browser keeps (and includes in the settings export) while the server stores only a hash.
  Every edit keeps the previous version in `chapter_revisions`, and the chapter shows an "edited"
  marker linking to its history.
- The codex is an append-only log per story: each change (create / replace / retire) is anchored at
  a chapter and applies to that chapter and its descendants. The codex at a chapter is the fold of
  the changes on the path from the root to it (deeper anchors win, then later posts). Codex changes
  never touch chapter text, and other branches never see them.
- Each chapter can carry a `summary` (of itself) and a `path_summary` (the story through it). The
  browser generates them with the cheaper model when a chapter is posted or edited, and fills in
  any that are missing (for example below an edited chapter) before generating, but only when older
  chapters would not fit in the context budget. They are a cache: anyone can fill a missing one,
  and nobody can overwrite an existing one except the chapter's author by editing it.

## Tests

```
npm test            # unit + API tests (starts a throwaway server and database)
npm run test:unit   # pure-logic tests only
npm run test:api    # HTTP API tests
npm run test:e2e    # browser tests with Playwright (uses Microsoft Edge by default)
npm run test:all    # everything
```

The API and browser suites build the app if needed and run it on port 3111 with a temporary
database and an admin password; the browser tests also run a fake AI server on port 3222. Set
`E2E_CHANNEL=chrome` (or `bundled`, after `npx playwright-core install chromium`) to use a
different browser. Pass `--build` (`node tests/run.mjs --build api`) to force a rebuild first.
