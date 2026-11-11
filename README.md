# StoryTime

Branching, choose-your-own-adventure stories, with optional AI help. It is a single-user app: there
are no accounts, logins or author names, and anyone who can reach the site can read and edit
everything. You bring your own AI (OpenAI, Anthropic, OpenRouter, Featherless, NanoGPT, or a local model through Ollama)
and, for pictures, your own ComfyUI machine.

## What it does

- **Read and write** branching stories. Any chapter can have any number of choices; a choice stays
  "unwritten" until a chapter is written for it.
- **AI drafting**, in four steps: brainstorm ideas and pick the codex entries, have the AI write the
  chapter from the story so far (revise, undo, step between drafts), write or generate a summary and
  choices, then post. "Continue with AI" jumps straight to a draft. A Generate carries on if you
  leave the page.
- **Write ahead with AI** (the **Write ahead** button under a chapter's title): let the AI write several chapters on its own: fill the
  open choices, grow the tree to a depth, or reach a goal along a plan you edit. It runs on the
  server, so you can close the tab. Chapters it wrote carry an AI mark until you press **Mark
  reviewed**.
- **Style notes**: per-story instructions for the AI (point of view, tense, tone, things to avoid),
  sent with every drafting prompt. Set them when starting a story, or change them from the Style
  notes section on any writing page; a change is tried out on that page until you save it for the
  whole story.
- **Codex**: per-branch entries for characters, places and facts (a character who turns into a horse
  stays human on other branches). The codex lives in the **Codex** section of the Story Bible: entries
  sit in folds by type (characters, places…), each card opens the entry's own page, the one place to
  read and change it, and **⋯** next to the Section picker adds a **New entry** (or one **from the
  shared codex**). Pick a chapter under the picker to see the codex as of that chapter on its branch, or
  the whole story to see every entry on any branch; a chapter's **Codex** button opens it there. While
  writing, the codex drawer opens the entry in place; changes stay in the draft and are saved with the
  chapter when it is posted (or straight away, if you date them to an earlier chapter). Entries can
  have pictures that change over the story too (**Pictures** in the entry's **⋯** menu).
- **An entry's page** shows the entry as of one chapter. The bar at the top stays in view: **← Codex**,
  the name, **as of** with **‹ “chapter” ›** to step through the chapters (tap the chapter to pick
  another), and **⋯** (Edit details, Pictures, Compare with a chapter…, Summary of this chapter, Share,
  Remove from this chapter only, Retire). Under it: the type, where the entry first appears (with
  **Change…**), its keywords and **Edit details**; then the facts as of the chapter, **What the AI is
  told** there, any **AI ideas**, and tabs for **Your notes**, **What the AI reads**, **History**,
  **Pictures** and **Update from the story**.
- **Keywords**: each entry lists the words in the story that bring it into the AI's prompt
  ("Ro, the traveller"); **Edit details** on the entry's page changes them, with the name and type.
- **Codex facts**: an entry holds small facts, one per aspect ("Ears: tall fox ears"), each dated to
  the chapter where it became true. Tap a fact to change it: its text, which forms it **applies to**,
  and whether it is **a change in the story** from this chapter on (earlier chapters keep the old text)
  or **a correction** (it was always so). A fact's **⋯** has its **History**, **Remove from this
  chapter on** and **Retcon the chapters…**. **+ Add a fact** adds one.
  A fact's aspect is picked from the **fact categories** in **Settings › Codex**: one list for each
  type of entry, shared by every story (Species, Skin, Teeth, Personality…). The AI must use them
  too: what it calls "fur" or "temperament" is filed under Skin or Personality, and when nothing on
  the list fits it suggests a **New category**, which waits for you and is never applied on its own.
  A lost feature (a tail that's gone) is removed rather than written as "Tail: none"; the AI is told
  it went only in the chapter where it happens. Categories marked **[per form]** (a character's body,
  species, sex, clothes and voice) can differ between forms; the rest (Personality, Relationships,
  History…) are the same in every form, and the AI never files them under one form. An entry holds
  one fact per category and form. **Tidy this entry…** (under the facts) asks the AI to
  move an older entry onto the list: it proposes renames ("Fur" to Skin), merges of facts about the
  same thing, splits of mixed facts and removal of "none" facts, never new details. Tick the ones to
  keep and **Apply**: they are saved as corrections, so each fact reads the new way from where it
  was set.
  A character can have forms (human, vixen…). The **Form** row says which one she is in, since when,
  and until which later chapter; **Change form…** picks the form (or a new one), the chapter it starts
  at and how far along it is ("halfway"), and shows exactly what the AI will read. A form's own fact
  replaces the every-form fact on the same aspect while she is in that form (the every-form one is
  shown struck through); the other forms' facts are folded away and not sent to the AI.
- **Your notes**: a free-text note on each entry that is yours and is **not sent to the AI**. **Turn
  notes into facts** asks the AI to read them; what it finds waits under **AI ideas** › **From your
  notes**.
- **Story Bible**: the **Bible** tab of every story page. On a phone its sections are a **Section**
  picker; under it, **Showing** says which chapter (or the whole story) you are looking at, with
  **Change…** to pick another and a link back to reading the chapter.
- **Codex suggestions**: after you save a new or edited chapter, the AI (your cheaper model) reads it
  in the background and suggests fact changes, each with the sentence that shows it. You review them
  beside the chapter's text (**Review beside the text**, from the chapter's banner, its Codex section or
  an entry's page): **Accept**, **Edit** or **Dismiss** each one, and where the chapter contradicts
  the codex choose which to keep. On an entry's page, a line says how many of its changes wait at the
  chapter (and at earlier ones), and each fact a suggestion is about has a marker under it: blue for a
  suggested change, red for a contradiction, amber for a fact the AI already applied; a suggested new
  aspect shows as a dashed row. Tap a marker to review it beside the text.
  **+ Flesh out with AI…** (beside + Add a fact) asks the AI for more detail. What it makes up, with
  nothing in the story behind it, waits under **AI ideas for …**, apart from the facts: **Keep…** asks
  whether it was always so (from where the entry first appears) or starts at the chapter; **Edit** or
  **Discard** it. A new character or place the AI found is offered in the Codex section, with **Add
  it** or **Dismiss**. You can also run the check yourself (**Check this chapter with AI**,
  or **Check every chapter with AI** for the whole story) from the **⋯** menu of the Codex section.
  Turn the automatic check on or off in Settings › Writing › Codex, under "Suggest codex changes
  after a chapter is saved".
  With **Apply the AI's codex changes automatically** (under it, off by default), the AI's fact and form
  changes for characters, places and things already in the codex are saved straight away instead of
  waiting. Each is marked (amber) on the entry's page and waits on the chapter's review page, with the
  sentence it came from, until you **Approve** it or **Undo** it (the fact goes back to what it was,
  and the AI won't apply it again). If you edit the chapter, the
  AI's unapproved facts from it are replaced by its new reading, but approved and edited ones are kept.
  New entries, removals and contradictions still wait as suggestions.
- **Review** (a story's menu): a page listing what may need fixing (missing, stale or wrong
  summaries, continuity slips, names with no codex entry, AI chapters not yet read) and the
  **tags** the AI suggests for chapters, for you to approve. See [Tags](#tags) below.
- **Edit chapters later**; every earlier version is kept, and an edited chapter links to its history.
- **Pictures**: chapter headers and footers, covers and codex pictures made by your own ComfyUI, with
  presets, LoRAs, reference pictures, editing by instruction, and a Refine screen for painting and
  redrawing parts of a picture. See [Pictures with ComfyUI](docs/pictures.md).
- **Covers**: the story list shows each story as a book cover. Make one on the cover page, upload one
  on the story's details page, or let the story use a generated cover.
- **Story tabs**: every story page has tabs along the top: **Read**, **Outline**, **Bible**,
  **Pictures** and **Details**. On a chapter, the **Bible** tab opens the Bible at that chapter. Under
  each chapter's title are **Edit**, **Illustrate**, **Codex**, **Write ahead** and **⋯** (History, Read
  this path, Open in outline, Summary, Make missing pictures).
- **Outline and export**: a tree view of every branch, and, in the **Export** section of the Details
  tab, downloads as readable Markdown, a single HTML file that plays the story offline (it remembers
  what the reader has seen, and can forget it), Twine (Twee), full JSON, or the codex as Markdown. The
  HTML and Twine files include every written chapter but leave out choices you haven't written yet; a
  chapter whose choices are all unwritten ends with "…to be continued." The Codex section, with a
  chapter chosen, downloads that branch's codex as a Markdown "story bible".
- **Import a finished story**: on the New story page, the **Import a story** tab takes a text or
  Markdown file (or pasted text). The AI splits it into short chapters at decision points, writes the
  choice taken at each one, and suggests other choices (and other endings after the last chapter).
  Your text is kept word for word. You review the chapters before the story is made: move a break,
  merge or split chapters, edit the titles and choices. The original story's choices are marked
  **Original**; the **Show the original path** switch on the reading page and the outline hides the
  marks. The same tab imports a StoryTime JSON export. Imported chapters get their summaries the first
  time the AI needs them, or from **Fix the summaries** in the Bible.

## Good to know

- **Everything is on the server**: stories, settings (including AI keys) and drafts, so every device
  sees the same ones. A draft is saved as you write, so you can start a chapter on one device and
  finish it on another. If the same draft is changed in two tabs, the second save is refused and the
  page asks which version to keep.
- **The server does the long work.** Picture jobs, AI runs and Generates go through one queue on the
  server (the header shows it; **Open queue** for the list). It keeps going with every tab closed. So
  the AI and ComfyUI addresses in Settings must work from the machine StoryTime runs on; **Test from
  server** in Settings checks them.
- **Prompt history** (in the ☰ menu) shows what the app recently sent to the AI and what came back, so
  you can copy an exchange and have a prompt improved. It records by itself and keeps only the last
  200 calls from the last 3 days.
- **Written with …** under a chapter's text says which model and connection wrote it and how long it
  took. Open it for the settings (temperature, thinking, max tokens), the exact prompt and the reply,
  kept for good for every chapter written by Generate, a revise or an AI run from now on.
- **The codex follows the branch.** A codex change is dated to a chapter and applies to that chapter
  and everything after it on that branch only.
- **Summaries keep prompts short.** Each chapter has a summary (yours, or the AI's when you post).
  Prompts send the latest chapters in full and older ones as summaries. They live in the Story
  Bible's **Summaries** section: for the whole story it shows how many chapters have one and fixes
  the missing and out-of-date ones (or redoes them all, or has the AI check them); pick a chapter
  to edit its summary, write it again with AI, or check it.

## Settings

Each tab has its own address (`/settings#tags`), so a link or a reload comes back to it.

- **Connections:** the AI servers (several are fine, such as two Ollama machines and OpenRouter) and
  the ComfyUI address.
- **Writing:** star the models you want, pick the defaults, and options such as temperature and the
  context budget. While writing, each draft can switch to any starred model.
- **Drawing:** in two parts. **Making pictures** has the drawing presets (new pictures, and redraws on
  the Refine screen); **Editing pictures** has the edit models (Qwen edit, Flux edit) used by the
  Instruct panel. Each has its own ComfyUI setup check ([Pictures with ComfyUI](docs/pictures.md)).
- **General:** the Queue (whether writing and pictures take turns on the machine, and how long each
  turn lasts) and the Outline (the markers and tag highlights shown on the outline).
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
