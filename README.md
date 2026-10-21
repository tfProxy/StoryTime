# StoryTime

Branching, choose-your-own-adventure stories, with optional AI help. It is a single-user app: there
are no accounts, logins or author names, and anyone who can reach the site can read and edit
everything. You bring your own AI (OpenAI, Anthropic, OpenRouter, or a local model through Ollama), and your keys
never leave your browser.

## What it does

- **Read and write** branching stories. Any chapter can have any number of choices; a choice stays
  "unwritten" until a chapter is written for it.
- **AI drafting** in the browser, in four steps: brainstorm ideas and pick the codex entries, have
  the AI write the chapter from the story so far (revise, undo, step between drafts), write or
  generate a summary and choices, then post. "Continue with AI" jumps straight to a draft.
- **Covers**: the story list shows each story as a book cover in a grid. Upload one from the story's
  details page; stories without one get a generated cover.
- **Style notes**: per-story instructions for the AI (point of view, tense, tone, things to avoid),
  sent with every drafting prompt. Set them when starting a story, or change them from the Style
  notes section on any writing page; a change is tried out on that page until you save it for the
  whole story.
- **Codex**: per-branch notes on characters, places and facts (a character who turns into a horse
  stays human on other branches). The AI can scan chapters for entries, draft entries, and bring an
  entry up to date with the story. While writing, you can read, edit and add entries without leaving
  the page; those changes stay in the draft and are saved with the chapter when it is posted (or
  straight away, if you date them to an earlier chapter).
- **Edit chapters later**; every earlier version is kept.
- **Outline and export**: a tree view of every branch, and downloads as readable Markdown, a single
  HTML file that plays the story offline (it remembers what the reader has seen, and can forget it),
  Twine (Twee) or full JSON. The HTML and Twine files include only finished branches. Any
  chapter (from its page or the outline) can also export just the route from the first chapter to
  it as one continuous Markdown read, and the codex page downloads that branch's codex as a
  Markdown "story bible".
- **Pictures**: chapter pictures made by a ComfyUI machine of your own, with named presets, LoRAs and
  picture editing by instruction.
- **Maintenance**: a command-line tool for backups, removing and restoring items, and reverting chapters.

## Run locally

```
npm install
npm run dev        # http://localhost:3737
```

Data lives in `data/storytime.db` (SQLite). Override with `STORYTIME_DB=/path/to/file.db`.
Each person opens **Settings** in the app to add connections to their AI servers (several are fine, such as two Ollama machines and OpenRouter), star the models they want, and pick the defaults. While writing, each draft can switch to any starred model for writing and for suggestions.

Settings has four tabs:

- **Connections:** the AI servers, and the address of the ComfyUI machine that makes pictures.
- **Writing:** the starred models, the default models, and options such as temperature and the context budget.
- **Pictures:** the ComfyUI setup check, then the picture presets: drawing presets for new pictures and
  Redraw, and presets for each edit model (see [Pictures with ComfyUI](docs/pictures.md)).
- **Backup:** export the settings to a file, or import them.

Each tab has its own address (`/settings#pictures`), so a link or a reload comes back to it.

## More guides

- [Pictures with ComfyUI](docs/pictures.md): picture presets, installing the edit models
  (Qwen-Image-Edit, FLUX.1 Kontext), LoRAs, and settings.
- [Running on Unraid (or any Docker host)](docs/unraid.md): the container, updating, backups and
  network notes.

## Maintenance

There is no admin page. The command-line tool runs on the machine hosting the database:
`node scripts/admin.mjs help`. In Docker: `docker exec -it storytime node scripts/admin.mjs recent 20`.
It can scan recent activity, delete chapters, choices, stories and codex changes, revert a chapter to
an earlier revision, and make a backup.

Deleting is permanent (take a backup first if you might want it back). Deleting a chapter also
deletes everything below it, and the choice that led to it becomes an unwritten slot again, so a
replacement can be written.

## How it works

- No accounts, logins or author names; one person is assumed.
- The server stores stories (chapters, choices, codex changes), the settings, including AI keys, and
  drafts, so every browser sees the same ones. A draft is saved as you write, along with the page's
  working state (brainstorm ideas, length, codex picks, an unsent instruction), so you can start a
  chapter on one device and finish it on another. If the same draft is changed in two tabs, the
  second save is refused and the page asks which version to keep. Drafts that older versions kept
  in the browser move to the server the first time drafts are opened. The settings page can export
  settings to a file.
- Any chapter can be edited. Every edit keeps the previous version in `chapter_revisions`, and the
  chapter shows an "edited" marker linking to its history.
- The codex is an append-only log per story: each change (create / replace / retire) is anchored at
  a chapter and applies to that chapter and its descendants. The codex at a chapter is the fold of
  the changes on the path from the root to it (deeper anchors win, then later posts). Codex changes
  never touch chapter text, and other branches never see them.
- Each chapter can carry a `summary` (a paragraph about itself, written by you or generated
  from the chapter text) and a `path_summary` (a rolling summary of the story through it). Prompts
  send the most recent chapters verbatim, the ones before as their own summaries, and the rolling
  summary only for whatever is older still, so most of the context is one step from the original
  text. The browser generates them with the cheaper model when a chapter is posted (an edit keeps the
  existing summary unless you change it), and
  fills in any that are missing (for example below an edited chapter) before generating, but only
  when older chapters would not fit in the context budget. They are a cache. A story's
  outline links to a "Redo summaries" page that regenerates all of them from the browser.

## Tests

```
npm test            # unit + API tests (starts a throwaway server and database)
npm run test:unit   # pure-logic tests only
npm run test:api    # HTTP API tests
npm run test:e2e    # browser tests with Playwright (uses Microsoft Edge by default)
npm run test:all    # everything
node tests/run.mjs e2e illustrate-resume   # only the files whose name contains the word(s) given
```

The API and browser suites build the app if needed and run it on port 3111 with a temporary
database; the browser tests also run a fake AI server on port 3222. Set
`E2E_CHANNEL=chrome` (or `bundled`, after `npx playwright-core install chromium`) to use a
different browser, or `E2E_EXECUTABLE=/path/to/chromium` to use a specific browser binary. Pass `--build` (`node tests/run.mjs --build api`) to force a rebuild first.
