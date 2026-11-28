# StoryTime

Branching, choose-your-own-adventure stories, with optional AI help. It is a single-user app: there
are no accounts, logins or author names, and anyone who can reach the site can read and edit
everything. You bring your own AI (OpenAI, Anthropic, OpenRouter, Featherless, NanoGPT, or a local model through Ollama)
and, for pictures, your own ComfyUI machine.

## What it does

- **Read and write** branching stories. Any chapter can have any number of choices; a choice stays
  "unwritten" until a chapter is written for it.
- **The writing desk**: where chapters are written and edited. **Edit** under a chapter's title opens
  it there; an unwritten choice, **Draft a different idea**, **Start writing** (a new story's details
  page) and the **Drafts** list open a new chapter there. (Old Edit and Write links still work: they
  open the desk.) On a wide screen it has three columns:
  - the **side column**, with two modes: **Codex** (search, the entries the chapter names under **In
    this chapter**, then each type; the toggle on a row pins an entry to the prompt or leaves it out;
    **+** makes a new entry, and its **▾** also offers **Add a shared entry…**, to link one from the
    shared codex into the story from this chapter on; on a new chapter it is added when you post it)
    and **Illustrate** (the picture controls, with the chapter's pictures in the story column);
  - the **open entry**, with its facts, preview, suggestions and history, changed right there;
  - the **story**: the earlier chapters on the path as blocks that fold (**Unfold all** / **Fold
    all**; ✎ moves the desk to that chapter; unfolded, a chapter shows its pictures in its text, folded, an
    icon for each that shows it full screen), the **→** line with the choice that leads here (click it
    to rename the choice), the chapter's box, and under a posted chapter **What happens next?**, its
    choices (a written one opens its chapter on the desk, an unwritten one starts it; add a choice, or
    **Suggest choices**; with **Suggest choices after posting a new chapter** on in Settings › Writing ›
    Options, it runs by itself when you post).

  **Stop editing**, beside the box's title, shows the chapter's text and pictures in place of the box
  (on a new chapter, the chapter it follows), with ✎ to edit it again. While reading, a written choice
  opens its chapter to read too; while editing, it opens it to edit. The draft is kept as it was.

  The box has the title, **Prompt and drafts** (the prompt, length, writing model and **Generate**;
  each Generate adds a numbered draft that keeps its prompt, and ✓ marks the one the chapter reads
  as; the prompt starts with the text of the choice that leads to the chapter, to add to or reword,
  and Generate sends only what the box holds; Ctrl+Enter in the prompt is Generate; on a posted
  chapter a Generate leaves the title alone and offers its own under it, with **Use it**), the text (the codex entries it names are listed under it; select words for **Add as a
  fact…**), **Summary**, and one button: **Post chapter** on a new chapter, which makes it and stays
  on it, or **Update chapter** on a posted one, which replaces its text (History keeps the old). The
  summary is written by the AI after a Post or Update, unless you write your own ("yours · not
  rewritten" until **Let the AI rewrite it**). Choices are added once the chapter is posted. The top
  bar's **⋯** has the summary model, History, Write ahead, the reading page, **Remove the AI mark**,
  **Replace branch…** and **Move to trash…** (or **Discard draft…** on a new chapter). Codex changes
  on a posted chapter are saved at once; on a new one they are held in its draft and saved with it
  when it is posted (or straight away, if you date them to an earlier chapter), and what needs a
  posted chapter is greyed out with why. A Generate carries on if you leave the page.
  On a phone the desk shows only the box (prompt and Generate first), with a bar along the bottom:
  **Path**, **Write**, **Codex** (to look things up), **Illustrate** and **Next**, each opening full
  screen.
- **Write ahead with AI** (the **Write ahead** button under a chapter's title): let the AI write several chapters on its own: fill the
  open choices, grow the tree to a depth, or reach a goal along a plan you edit. It runs on the
  server, so you can close the tab. Chapters it wrote carry an AI mark until you press **Mark
  reviewed**.
- **Style notes**: per-story instructions for the AI (point of view, tense, tone, things to avoid),
  sent with every drafting prompt. Set them when starting a story, or change them on the story's
  **Details** tab.
- **Codex**: per-branch entries for characters, places and facts (a character who turns into a horse
  stays human on other branches). The codex lives in the **Codex** section of the Story Bible: entries
  sit in folds by type (characters, places…), each card opens the entry's own page, the one place to
  read and change it, and **⋯** next to the Section picker adds a **New entry** (or one **from the
  shared codex**). Pick a chapter under the picker to see the codex as of that chapter on its branch, or
  the whole story to see every entry on any branch; a chapter's **Codex** button opens it there. While
  writing, the writing desk's side column has the codex beside the chapter (see above).
- **An entry's page** shows the entry as of one chapter. The bar at the top stays in view: **← Codex**,
  the name, **as of** with **‹ “chapter” ›** to step through the chapters (tap the chapter to pick
  another), and **⋯** (Edit details, Change the icon…, Compare with a chapter…, Summary of this chapter,
  Share, Remove from this chapter only, Retire). Under it: the entry's round icon (tap it to change it),
  the type, where the entry first appears (with **Change…**), its keywords and **Edit details**; then the
  facts as of the chapter, **What the AI is told** there, any **AI ideas**, and tabs for **What the AI
  reads**, **History** and **Update from the story**.
- **Icons**: each entry has one round icon, shown in the codex lists and on its page, the same in every
  chapter. Pick it from the story's saved pictures or the pictures made for the story lately, or upload
  one. It is never sent to ComfyUI or the AI. An entry from the shared codex has its own icon in each story.
- **Keywords**: each entry lists the words in the story that bring it into the AI's prompt
  ("Ro, the traveller"); **Edit details** on the entry's page changes them, with the name and type.
- **Codex facts**: an entry holds small facts, one per aspect ("Ears: tall fox ears"), each dated to
  the chapter where it became true. Tap a fact to change it: its text, which forms it **applies to**,
  and whether it is **a change in the story** from this chapter on (earlier chapters keep the old text)
  or **a correction** (it was always so). A fact's **⋯** has its **History**, **Remove from this
  chapter on**, **Move to an earlier chapter…** (it then holds from that chapter on, as if entered
  there; it can't go back past another change of the same fact, or before the entry first appears) and
  **Retcon the chapters…**. **+ Add a fact** adds one.
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
  **Rename a form…** fixes a wrong form name (she was never a vampire, she is a demon): the form and
  its facts take the new name in every chapter and branch. The chapters' own text is not changed.
- **Story Bible**: the **Bible** tab of every story page. On a phone its sections are a **Section**
  picker; under it, **Showing** says which chapter (or the whole story) you are looking at, with
  **Change…** to pick another and a link back to reading the chapter.
- **Codex suggestions**: after you save a new or edited chapter, the AI (the Codex job's model) reads it
  in the background and suggests fact changes, each with the sentence that shows it. You review them
  on the chapter's writing desk, beside its text (**Review on the desk**, from the chapter's banner, its
  Codex section or an entry's page): the entry's **Facts** tab lists what changed in the chapter first,
  with **Approve** and **Undo** on each fact the AI applied, and its **Suggestions** tab has **Keep**,
  **Edit** or **Dismiss** for each suggestion (**Dismiss all** clears the entry's). Writing on from a
  chapter approves the AI's facts on the way to it. On an entry's page, a line says how many of its changes wait at the
  chapter (and at earlier ones), and each fact a suggestion is about has a marker under it: blue for a
  suggested change, red for a contradiction, amber for a fact the AI already applied; a suggested new
  aspect shows as a dashed row. Tap a marker to review it beside the text.
  **+ Flesh out with AI…** (beside + Add a fact) asks the AI for more detail. What it makes up, with
  nothing in the story behind it, waits under **AI ideas for …**, apart from the facts: **Keep…** asks
  whether it was always so (from where the entry first appears) or starts at the chapter; **Edit** or
  **Discard** it. A new character or place the AI found is offered in the Codex section, with **Add
  it** or **Dismiss**. You can also run the check yourself (**Check this chapter with AI**,
  or **Check every chapter with AI** for the whole story) from the **⋯** menu of the Codex section.
  Turn the automatic check on or off in Settings › Codex, under "Suggest codex changes
  after a chapter is saved".
  With **Apply the AI's codex changes automatically** (under it, off by default), the AI's fact and form
  changes for characters, places and things already in the codex are saved straight away instead of
  waiting. Each is marked (amber) on the entry's page and waits on the chapter's review page, with the
  sentence it came from, until you **Approve** it or **Undo** it (the fact goes back to what it was,
  and the AI won't apply it again). If you edit the chapter, the
  AI's unapproved facts from it are replaced by its new reading, but approved and edited ones are kept.
  New entries, removals and contradictions still wait as suggestions.
- **Review** (a story's menu): a page listing what may need fixing (missing, stale or wrong
  summaries, continuity slips, names with no codex entry, AI chapters not yet read).
- **Edit chapters later** on the writing desk; every earlier version is kept, and an edited chapter
  links to its history.
- **Pictures**: chapter headers and footers and covers made by your own ComfyUI, with
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
  finish it on another (**Drafts** in the ☰ menu opens each on the writing desk). If the same draft
  is changed in two tabs, the second save is refused and the desk asks which version to keep.
- **The server does the long work.** Picture jobs, AI runs and Generates go through one queue on the
  server (the header shows it; **Open queue** for the list). It keeps going with every tab closed. So
  the AI and ComfyUI addresses in Settings must work from the machine StoryTime runs on; **Test from
  server** in Settings checks them.
- **Prompt history** (in the ☰ menu) shows what the app recently sent to the AI and what came back, so
  you can copy an exchange and have a prompt improved. It records by itself and keeps only the last
  200 calls from the last 3 days.
- **Written with …** under a chapter's text says which model and connection wrote it and how long it
  took. Open it for the settings (temperature, thinking, max tokens), the exact prompt and the reply,
  kept for good for every chapter written by Generate or an AI run from now on.
- **The codex follows the branch.** A codex change is dated to a chapter and applies to that chapter
  and everything after it on that branch only.
- **Summaries keep prompts short.** Each chapter has a summary (yours, or the AI's when you post).
  Prompts send the latest chapters in full and older ones as summaries. They live in the Story
  Bible's **Summaries** section: for the whole story it shows how many chapters have one and fixes
  the missing and out-of-date ones (or redoes them all, or has the AI check them); pick a chapter
  to edit its summary, write it again with AI, or check it.

## Settings

Each tab has its own address (`/settings#drawing`), so a link or a reload comes back to it.

- **Connections:** the AI servers (several are fine, such as two Ollama machines and OpenRouter) and
  the ComfyUI address.
- **Writing:** the **Models** grid has a row for each model you use (press Use on a model in the
  Connections tab to add it) and a column for each job: Writing, Choices, Summaries, Codex,
  Continuity and Picture prompts. In a job's column, a ticked box offers the model in that job's
  pickers. A row also sets the model's nickname, its **Context** (how much the model takes; blank uses
  the Context budget under Options) and whether it thinks. Under the grid, **Default model for each
  job** has a dropdown per job; Summaries can be left as the same as Writing, and the other jobs as
  the same as Summaries. Pages with their own model picker (the writing page, Write ahead,
  Illustrate) can still choose another. Options below: temperature, the context budget and the codex
  list. Under **Review**, whether new and edited chapters are checked automatically.
- **Drawing:** in two parts. **Making pictures** has the drawing presets (new pictures, and redraws on
  the Refine screen); **Editing pictures** has the edit models (Qwen edit, Flux edit) used by the
  Instruct panel. Each has its own ComfyUI setup check ([Pictures with ComfyUI](docs/pictures.md)).
- **General:** the Queue (whether writing and pictures take turns on the machine, and how long each
  turn lasts) and the Outline (what the outline shows after each chapter's name).
- **Backup:** export the settings to a file, or import them.

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
