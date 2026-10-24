# Importing branches from other interactive-story sites (plan)

Status: **plan, not built.** Written 2026-10-24. The owner's answers to the open questions at the end decide anything marked *(default)*. When a stage is built, change its heading to say "(done)" and keep this file describing how the import works.

## What it does

The owner can copy part of an interactive story from another site (cyoc.net and the BE archive first, more later) into StoryTime:

- **A path:** one line of chapters, from the story's first chapter (or a chosen chapter) down to a given chapter.
- **A branch:** a given chapter and everything below it, with a limit on depth and count.
- **Both:** the path down to a chapter, then the branch below it.

The text comes in word for word, with the choices. Later, a chapter can be rewritten by the AI (or by Claude Code, from the same file), keeping the original in the chapter's history.

## How it fits together

```
 site pages ──(1) scraper, run on the owner's PC or the NAS──▶ branch file (JSON)
                                                                     │
                                       (optional) Claude Code reads it, adds summaries or rewrites
                                                                     │
                     (2) POST /api/stories/import-branch ◀───────────┘
                                   │
                    a new story, or grafted under a choice of an existing story
```

Why this shape:

- **The scraper is a command-line script, not part of the web app.** The sites can't be reached from a cloud session (the proxy refuses them), and the browser can't fetch them (cross-site requests are blocked). A script run where the sites can be reached is the simplest thing that works. A "paste a link" box in the app that runs the same code on the server can come later (stage 6).
- **The branch file is the hand-off.** It is plain JSON with the text as plain paragraphs, so Claude Code can read it, summarise or rewrite chapters in it, and the owner can keep it as a record.
- **Importing is one transaction on the server**, like the existing JSON import (`src/lib/import.ts`): either everything goes in or nothing does.

## The branch file (format `storytime-branch`, version 1)

```jsonc
{
  "format": "storytime-branch",
  "version": 1,
  "source": {
    "site": "cyoc",                       // adapter name
    "story_title": "The Shop",            // the site's story title, used for a new story
    "story_url": "https://…",
    "fetched_at": 1793000000000,          // ms since 1970
    "request": { "mode": "branch", "url": "https://…", "depth": 3, "max": 200 }   // what was asked, for the record
  },
  "root": "12345",                        // ext_id of the top chapter in this file
  "chapters": [
    {
      "ext_id": "12345",                  // the site's own id for the chapter (string)
      "url": "https://…",
      "parent_ext_id": null,              // null only for "root"
      "title": "The Shop",
      "author": "someone",
      "posted_at": 1100000000000,         // from the page; fetched_at when the page has no date
      "body": "First paragraph.\n\nSecond paragraph.",
      "summary": null,                    // optional: filled by Claude Code or later by the app
      "choices": [
        // In page order. "ext_id" is the chapter the choice leads to, or null when the site
        // shows it as not written yet. "fetched" says whether that chapter is in this file.
        { "label": "Go inside", "ext_id": "12346", "fetched": true },
        { "label": "Walk away", "ext_id": "12399", "fetched": false },
        { "label": "(unwritten)", "ext_id": null, "fetched": false }
      ]
    }
  ],
  "warnings": ["Chapter 12399 has 15 choices; kept the first 12"]
}
```

Rules the scraper guarantees and the server checks again:

- Every chapter except `root` has a `parent_ext_id` that is in the file, and the parent has a choice with that `ext_id`.
- `ext_id`s are unique. A chapter appears once even if two choices on the site lead to it (see "Loops and shared chapters").
- Text is plain: tags stripped, `<br>` becomes a newline, `<p>`/`<div>` become blank lines, entities decoded, runs of blank lines collapsed, leading and trailing whitespace trimmed. Italics and bold are lost (StoryTime has no formatting; `src/components/Prose.tsx`). *(default: drop them; alternative: keep as `*text*`)*
- Limits from `src/lib/limits.ts` are applied with a warning, never silently: title 200 characters, choice label 200, body 50,000, choices per chapter 12 *(default: keep the first 12 and warn; see questions)*.

## Stage 1: site adapters and the scraper (no app changes)

Files:

- `scripts/import/sites/<site>.mjs`, one per site, each exporting:
  ```js
  export const name = "cyoc";
  export function matches(url) { /* true for this site's chapter URLs */ }
  export function chapterId(url) { /* the site's chapter id from a URL, or null */ }
  export function chapterUrl(id) { /* the canonical URL for an id */ }
  export function parseChapter(html, url) {
    // Pure: no network. Returns
    // { ext_id, title, author, posted_at, body, parent_ext_id, story_title, story_url,
    //   choices: [{ label, ext_id | null }] }
    // and throws ScrapeError("…") with a clear message when the page isn't a chapter
    // (a login page, a "not found" page, a changed layout).
  }
  ```
- `scripts/import/sites/index.mjs`: the list of adapters and `adapterFor(url)`.
- `scripts/import/html.mjs`: HTML → plain text and small helpers, shared by adapters. No new dependency at first: the pages are simple and regular expressions plus a small tag-stripper are enough for fixed layouts. If an adapter needs real DOM queries, add `node-html-parser` as a devDependency (ask first).
- `scripts/import/fetch.mjs`: the polite fetcher:
  - one request at a time, at least 1.5 s apart (`--delay`), a User-Agent naming StoryTime;
  - a disk cache, `.import-cache/<site>/<ext_id>.html` (add `/.import-cache/` to `.gitignore`), so a re-run or a resumed run doesn't fetch again (`--refresh` to ignore it);
  - `--cookie "<cookie header>"` for pages that need the owner's login (see questions);
  - retries a failed request twice, then stops with the chapters fetched so far written to the output file, so the run can be resumed.
- `scripts/import.mjs`: the command line.

```
node scripts/import.mjs path   <chapter-url> [--from <chapter-url>]           --out branch.json
node scripts/import.mjs branch <chapter-url> [--depth N] [--max N]          --out branch.json
node scripts/import.mjs both   <chapter-url> [--from <url>] [--depth N] [--max N] --out branch.json
node scripts/import.mjs post   branch.json --server http://nas:3737 [--story <id> --choice <choiceId>]
        (also: --post <server> on the first three to fetch and post in one go)
```

How each mode walks the site:

- **path:** fetch the given chapter; follow `parent_ext_id` up until the root (no parent) or the `--from` chapter. The file's `root` is the top of that chain. Each chapter keeps **all** its choices; only the one on the path has `fetched: true` *(default; the others become open choices in StoryTime, so the owner can write their own branches there)*.
- **branch:** breadth-first from the given chapter, following choices with an `ext_id`, stopping at `--depth` (default 3) levels below it or `--max` (default 200) chapters, whichever comes first. The run prints how many choices were left unfetched because of the limits.
- **both:** path to the chapter, then branch from it, in one file.

Tests (`tests/unit/import-sites.test.mts` or `.mjs`, run with `npm test`):

- Saved pages in `tests/fixtures/import/<site>/` (a first chapter, a middle chapter, a chapter with an unwritten choice, a chapter with many choices, a "not found" or login page). These must be saved by the owner from a browser (Save page as, "HTML only"), because a cloud session can't reach the sites.
- For each fixture: `parseChapter` returns the expected title, author, date, first and last 40 characters of the body, the choice labels and ids, and the parent id. The bad pages throw `ScrapeError`.
- A fake site for the walker: a tiny local HTTP server serving fixtures under made-up ids (the pattern of `tests/e2e/fakeComfy.mjs`), and tests for path, branch with depth and max limits, the cache (second run makes no requests), and resuming.

Done when: the unit tests pass, and on the owner's PC `node scripts/import.mjs path <real url> --out x.json` writes a file whose text matches the page.

## Stage 2: the import endpoint

`POST /api/stories/import-branch`, body `{ branch: <branch file>, target: … }`, handled with `handlePost` like `src/app/api/stories/import/route.ts`. Logic in `src/lib/importBranch.ts`, validated with zod like `src/lib/import.ts` (reuse its patterns, not its schema).

Targets:

1. `{ "kind": "new" }`: a new story titled `source.story_title`, premise empty *(default)*, the file's root as its first chapter.
2. `{ "kind": "choice", "choice_id": "…" }`: under an existing **open** choice (no chapter follows it yet, so `chapters_one_child_per_choice` holds). The file's root becomes that choice's chapter; depths continue from the parent.
3. `{ "kind": "chapter", "chapter_id": "…", "label": "…" }`: adds a new choice to an existing chapter (refuse past `LIMITS.choices`) and puts the file's root under it. Label defaults to the root chapter's title.

Writing:

- Walk from the file's root down, parents before children, as `importStory` does. Fresh ids from `newId()`.
- `author_name` on chapters and choices is the site author.
- `posted_at` is the site's date *(default)*. Note: lists sorted by `posted_at` will show imported chapters as old. If that's a problem, use the import time and keep the site's date in `chapter_sources`.
- A choice with `ext_id: null` or `fetched: false` becomes an open choice.
- `summary` from the file goes into `chapters.summary`; `path_summary` stays empty (the existing Summaries page fills it).

Remembering where chapters came from (migration, so restart the dev server after adding it, and run the whole browser suite before pushing):

```sql
CREATE TABLE chapter_sources (
  chapter_id  TEXT PRIMARY KEY REFERENCES chapters(id),
  story_id    TEXT NOT NULL REFERENCES stories(id),
  site        TEXT NOT NULL,
  ext_id      TEXT NOT NULL,
  url         TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  posted_at   INTEGER,           -- the site's date
  original    TEXT NOT NULL,     -- the body as imported, kept even after a rewrite
  imported_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX chapter_sources_ext ON chapter_sources(story_id, site, ext_id);
```

This makes re-importing safe and useful: when a chapter in the file is already in the story (same site and `ext_id`), it is **not** imported again; its new children are attached under the existing chapter's matching choice (matched by the choice's `ext_id`, recorded in a second small table `choice_sources(choice_id, story_id, site, ext_id)`), and the reply says how many were skipped. So the owner can import a path today and more of a branch next week.

Also: the JSON export (`src/lib/export.ts`) and import (`src/lib/import.ts`) carry `chapter_sources` so a round trip keeps them (bump the export version to 3; version 2 files still import).

Reply: `{ story_id, chapter_id, imported, skipped, warnings }`.

Tests (`tests/api/import-branch.test.mjs`): new story; under an open choice; under a chapter as a new choice; refusing a choice that already has a chapter; refusing a bad file (missing parent, duplicate `ext_id`, loop) with nothing written; re-import skipping chapters and attaching new ones; export and import round trip keeping sources.

## Stage 3: an Import page in the app

*(Which page it goes on is a question for the owner; CLAUDE.md asks to confirm UI placement.)* Default: an **Import branch file** button next to the existing JSON import on the story list, and an **Import a branch here** item on an open choice in the chapter reading page.

- Pick a `storytime-branch` file; show what's in it (site, title, how many chapters, deepest level, warnings) and an outline preview using the existing outline component if it fits.
- Choose the target (new story, or the choice/chapter it was opened from), then Import. On success go to the imported root chapter.
- Imported chapters show a small "From cyoc.net, by <author>" line with a link to the original (from `chapter_sources`).

Tests: one browser file (`tests/e2e/import-branch.e2e.mjs`), deleting what it creates; screenshots at desktop and phone width.

## Stage 4: rewriting imported chapters

Two ways, both keeping the original (`chapter_sources.original`, and the normal revision history, since a rewrite goes through `editChapter`, which saves the old text as a revision):

1. **In the app (AI from the browser, like every AI call here).** On an imported chapter: **Rewrite…** with a choice of
   - *Rewrite in the story's style*: same events and choices, new prose, using the story's style notes and the codex as the writing AI does;
   - *Condense to a summary*: a short beat summary that becomes the chapter text, for the owner (or the AI) to write out later.
   And **Rewrite the branch…** on the outline: does each imported chapter below, one at a time, showing progress, stoppable, skipping chapters already rewritten. Prompts live with the other prompts in `src/lib/ai/prompts.ts`; tests use `useMockAi`.
2. **With Claude Code, from the file.** The owner asks Claude Code to fill `summary` (or a new optional `rewrite` field) in a branch file before posting. If `rewrite` is set, the server imports it as the chapter body and keeps `body` as `original`. Nothing else is needed in the app for this.

Choice labels are kept as they are in both ways *(default)*.

## Stage 5: more sites

Adding a site is: save fixture pages, write `scripts/import/sites/<name>.mjs` and its tests, add it to `index.mjs`. Nothing else changes. Writing.com interactives and Chyoa are the likely next ones; Chyoa has many choices per chapter and Writing.com needs a login for most pages.

## Stage 6 (maybe): fetch from the app

A **From a link** box on the Import page that sends the URL and mode to the server, which runs the same walker (moved to `src/lib/import/` so both the script and the server use it) and streams progress. Only worth it if the NAS can reach the sites and the owner prefers it to the script. Ask before building.

## Loops and shared chapters

Some sites let two choices lead to the same chapter, or a choice lead back up (a "go back" or a loop). StoryTime is a tree (one chapter per choice). The walker keeps the first place it meets a chapter; a later choice that leads to an already-seen chapter becomes an open choice, and a warning names both chapters *(default)*. Links to a parent chapter that are "go back" navigation, not story choices, are not choices at all; each adapter must tell them apart.

## Notes for whoever builds this

- Do the stages in order and finish each one's tests before the next. Stage 1 can't start until fixture pages are in `tests/fixtures/import/`.
- Follow CLAUDE.md: Edit/Write for files, one logical change per commit, the verification list for the size of the change. Stage 2 adds a migration, so it counts as shared code.
- Sites change their layout. Make `parseChapter` fail loudly (`ScrapeError` naming the missing part) rather than return an empty body.
- Never send the owner's cookie anywhere but the site it came from, and never write it to the branch file or the cache.
- Don't fetch faster than the delay, and don't run branch mode without a `--max`.

## Open questions for the owner

1. **The BE archive:** which site exactly (its address), and what a chapter URL looks like there.
2. **Fixture pages:** can you save 4 or 5 pages from each site into `tests/fixtures/import/<site>/` (a first chapter, a middle one, one with an unwritten choice, one with many choices, a not-found page)? A cloud session can't reach the sites, so the parsers have to be written from saved pages. Or run the build session on your PC.
3. **Logins:** do any pages you want need you to be logged in on either site?
4. **Where the scraper runs:** your PC (script, then post to the NAS), or the NAS itself, or both?
5. **More than 12 choices:** keep the first 12 with a warning, raise the limit for imported chapters, or raise it everywhere?
6. **Choices off the path:** in path mode, keep the other choices as open choices (default), or drop them?
7. **Dates:** keep the site's date as the chapter's date (default), or use the import date?
8. **"Summary version to be rewritten":** a short summary as the chapter text that the AI later writes out in full, or the AI rewriting the full text in your style directly, or both?
9. **Where the Import buttons go** (stage 3): the story list and an open choice on the chapter reading page, or somewhere else?
10. **Attribution:** show "From <site>, by <author>" with a link on imported chapters (default), or keep it hidden in the data only?
