# StoryTime

Branching, choose-your-own-adventure stories, with optional AI help. It is a single-user app: there
are no accounts, logins or author names, and anyone who can reach the site can read and edit
everything. You bring your own AI (OpenAI, Anthropic, OpenRouter, or a local model through Ollama)
and, for pictures, your own ComfyUI machine.

## What it does

- **Read and write** branching stories. Any chapter can have any number of choices; a choice stays
  "unwritten" until a chapter is written for it.
- **AI drafting**, in four steps: brainstorm ideas and pick the codex entries, have the AI write the
  chapter from the story so far (revise, undo, step between drafts), write or generate a summary and
  choices, then post. "Continue with AI" jumps straight to a draft. A Generate carries on if you
  leave the page.
- **Write ahead with AI** (a chapter's menu): let the AI write several chapters on its own: fill the
  open choices, grow the tree to a depth, or reach a goal along a plan you edit. It runs on the
  server, so you can close the tab. Chapters it wrote carry an AI mark until you press **Mark
  reviewed**.
- **Style notes**: per-story instructions for the AI (point of view, tense, tone, things to avoid),
  sent with every drafting prompt. Set them when starting a story, or change them from the Style
  notes section on any writing page; a change is tried out on that page until you save it for the
  whole story.
- **Codex**: per-branch notes on characters, places and facts (a character who turns into a horse
  stays human on other branches). The AI can scan chapters for entries, draft entries, and bring an
  entry up to date with the story. While writing, you can read, edit and add entries without leaving
  the page; those changes stay in the draft and are saved with the chapter when it is posted (or
  straight away, if you date them to an earlier chapter). Entries can have pictures that change
  over the story too.
- **Review** (a story's menu): a page listing what may need fixing (missing, stale or wrong
  summaries, continuity slips, names with no codex entry, AI chapters not yet read) and the
  **tags** the AI suggests for chapters, for you to approve. See [Tags](#tags) below.
- **Edit chapters later**; every earlier version is kept, and an edited chapter links to its history.
- **Pictures**: chapter headers and footers, covers and codex pictures made by your own ComfyUI, with
  presets, LoRAs, reference pictures, editing by instruction, and a Refine screen for painting and
  redrawing parts of a picture. See [Pictures with ComfyUI](docs/pictures.md).
- **Covers**: the story list shows each story as a book cover. Make one on the cover page, upload one
  on the story's details page, or let the story use a generated cover.
- **Outline and export**: a tree view of every branch, and downloads as readable Markdown, a single
  HTML file that plays the story offline (it remembers what the reader has seen, and can forget it),
  Twine (Twee) or full JSON. The HTML and Twine files include only finished branches. Any
  chapter (from its page or the outline) can also export just the route from the first chapter to
  it as one continuous Markdown read, and the codex page downloads that branch's codex as a
  Markdown "story bible".

## Good to know

- **Everything is on the server**: stories, settings (including AI keys) and drafts, so every device
  sees the same ones. A draft is saved as you write, so you can start a chapter on one device and
  finish it on another. If the same draft is changed in two tabs, the second save is refused and the
  page asks which version to keep.
- **The server does the long work.** Picture jobs, AI runs and Generates go through one queue on the
  server (the header shows it; **Open queue** for the list). It keeps going with every tab closed. So
  the AI and ComfyUI addresses in Settings must work from the machine StoryTime runs on; **Test from
  server** in Settings checks them.
- **The codex follows the branch.** A codex change is dated to a chapter and applies to that chapter
  and everything after it on that branch only.
- **Summaries keep prompts short.** Each chapter has a summary (yours, or the AI's when you post).
  Prompts send the latest chapters in full and older ones as summaries. A story's outline has
  **Redo summaries** to write them all again.

## Settings

Each tab has its own address (`/settings#tags`), so a link or a reload comes back to it.

- **Connections:** the AI servers (several are fine, such as two Ollama machines and OpenRouter) and
  the ComfyUI address.
- **Writing:** star the models you want, pick the defaults, and options such as temperature and the
  context budget. While writing, each draft can switch to any starred model.
- **Drawing, Qwen edit, Flux edit:** the ComfyUI setup check and the picture presets
  ([Pictures with ComfyUI](docs/pictures.md)).
- **Queue:** whether writing and pictures take turns on the machine, and how long each turn lasts.
- **Outline:** the markers and tag highlights shown on the outline.
- **Tags:** your tag library ([below](#tags)), and whether new and edited chapters are checked
  automatically.
- **Backup:** export the settings to a file, or import them.

## Tags

Tags (Settings > Tags) are written by you; **Find tags** on the Tags tab of a story's Story Bible suggests where each
applies, and you approve or reject each one. **Help me write it** drafts a rule from a rough idea, and
**Try it** shows what a rule would tag before you save it. A tag can be shown to readers as a content
note under each choice. Each story can switch tags off on its details page.

Suggested rules. This wording settles the edge cases (dreams and visions don't count; a change undone
in the same chapter does; partial changes count like full ones). Paste it into each tag's "Applies
when" and "Doesn't apply when". A chapter with an approved **tf** or **tg** may also change a
character without it being flagged as a continuity problem.

- **tf**
  - Applies when: a character's species or physical form changes, fully or partly (animal, creature,
    object, size, or just ears, a tail or claws), on the page, even if it is undone before the chapter ends.
  - Doesn't apply when: illusions, costumes, dreams, visions or imagined changes; a change of sex alone
    (that's tg).
- **tg**
  - Applies when: a character's physical sex changes, fully or partly, on the page, even if it is undone
    before the chapter ends.
  - Doesn't apply when: cross-dressing, disguise, illusion, a dream or vision, or a change only talked about.
- **violence**
  - Applies when: a character deliberately injures or attacks someone, or destroys property in anger, on
    the page. Choices: mild, graphic.
  - Doesn't apply when: threats, past or reported fights, accidents, sparring or play.

## Running it

On a NAS or any Docker host: see [Running on Unraid (or any Docker host)](docs/unraid.md).

On your own computer:

```
npm install
npm run dev        # http://localhost:3737
```

Data lives in `data/storytime.db` (SQLite). Override with `STORYTIME_DB=/path/to/file.db`.

## Maintenance

There is no admin page. The command-line tool runs on the machine hosting the database:
`node scripts/admin.mjs help`. In Docker: `docker exec -it storytime node scripts/admin.mjs recent 20`.
It can scan recent activity, delete chapters, choices, stories and codex changes, revert a chapter to
an earlier revision, and make a backup.

Deleting is permanent (take a backup first if you might want it back). Deleting a chapter also
deletes everything below it, and the choice that led to it becomes an unwritten slot again, so a
replacement can be written.
