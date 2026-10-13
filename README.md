# StoryTime

Branching stories, written together with a little AI help. See the plan in the project history; phases 1-4 plus chapter editing are done: reader, posting and editing with revision history, browser-only AI settings (OpenAI-compatible incl. Ollama, and Anthropic), a local drafting editor, and the per-branch codex. AI codex helpers (scan for entries, draft and update entries) are in too. Summaries at post time, the admin tools and Unraid polish are next.

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
