# TODO

What is left to do, as a simple list. Finished work isn't listed; the code and tests describe it.

Last checked against the code: 2026-11-04.

## Checks to do by hand

Built and passing its tests against fakes, but not yet tried for real. Tick them off as you go.

**On the NAS**
- [ ] Before updating, check the server can reach ComfyUI and Ollama: `docker exec -it storytime node -e "fetch('http://<comfy-ip>:8188/system_stats').then(r=>r.text()).then(console.log)"`, and the same for `http://<ollama-ip>:11434/api/ps`. Both must print JSON; if not, change the addresses in Settings (Settings › Test from server says the same).
- [ ] Queue 4 pictures on the phone, lock the phone, wait, unlock: they should be ready.
- [ ] Start a write-ahead run, close every tab, reopen later: it should have carried on.
- [ ] Compose Pull and Compose Up during a long picture job: the job should be found again and recorded once.
- [ ] Live updates arrive (the header counts change without a reload). A proxy in front of StoryTime that buffers `text/event-stream` would stop them.
- [ ] After the shared-codex update (migrations 45 and 46): the shared codex works (a shared picture saved from one story shows in another; "Use for" on the pictures page).

**On a real phone (touch)**
- [ ] Story tabs (Read, Outline, Bible, Pictures, Details) and the chapter's button row (Edit, Illustrate, Codex, Write ahead, ⋯): every item reachable, the ⋯ menu opens on screen and closes when you tap elsewhere.
- [ ] Story Bible: the Section box, "Change…" to pick a chapter or the whole story, and the ⋯ menu on Codex.
- [ ] Codex: fold and unfold Characters / Places / Things; the "To review" box (a row opens the entry at that chapter; Add it / Dismiss a new entry); on the entry page, fold and unfold Review changes, Accept, Edit and Dismiss a suggestion, Approve and Undo an AI-applied fact, "Show in “chapter”" scrolls to the quote in Edge; "New entry from here"; "New entry from the shared codex…".
- [ ] A codex entry's page: the ⋯ menu (Edit, Pictures, History, Share, Remove from this chapter only, Retire), the folding sections, and a fact's Edit / Remove / History.
- [ ] Summaries: "Fix the N summaries", then a chapter's Save ▾ menu.
- [ ] The writing page: the model pickers at the top, and the Finish section opening once the chapter has text.
- [ ] The Refine screen.
- [ ] The header stays at the top while scrolling, the line under it (while the AI works) fits with the name cut short before the step, and the Refine screen and Illustrate controls don't slide under it.

**On a real ComfyUI**
- [ ] Earlier pictures: make some, pin one, reload (only it shows), use one from All, restart ComfyUI, check they still load from `/view`.
- [ ] Start from a picture with the built-in workflow, then with your own exported workflow (with and without `{{image}}`). Check the upload works through your CORS setup and that a 1344 × 768 start picture fits in memory. A workflow with `KSamplerAdvanced` has no `denoise`, so StoryTime says it can't start from a picture; see whether that matters.
- [ ] Reference pictures (IP-Adapter): install `ComfyUI_IPAdapter_plus` and the model files (`docs/pictures.md`). For an Illustrious or NoobAI checkpoint and a furry merge, try a character as a reference for a new scene, a header as the reference for its footer, a style reference, and the story style picture. Note the strengths that work and what each reference adds to the time, then change the defaults. Confirm NoobAI's own adapter beats the SDXL one on Illustrious and furry merges.
- [ ] Refine inpainting: paint a small area (a hand or a face) on a real picture and Go at strength 0.6; compare with before the change (seam, detail, time). Also try a mask near the picture's edge, a picture whose size isn't a multiple of 16, and each **Under the paint** choice. The redraw now runs only the steps its strength needs, so compare two or three pictures for look.

**With your own AI models**
- [ ] Import a story from text (New story › Import a story) with a local model: a real short story of 3,000–8,000 words. Do the breaks land at decision points, are the choice labels and the suggested choices good, and does a small context size (several parts) still give sensible breaks where the parts meet?
- [ ] Story review: Find tags, Help me write it, Check continuity, and the summary check. Prompt quality with a small local model is unknown.
- [ ] The codex check with the cheaper model: post (or "Check this chapter with AI" on) 2–3 chapters where a body or form changes, and note what the suggestions miss or get wrong. This feeds "Tune the codex check prompt" below.
- [ ] "Apply the AI's codex changes automatically" (Settings › Writing › Codex): write and save 2–3 chapters with it on, then check the AI-marked facts on each character's page (right fact, right chapter, quote), Approve and Edit a few, edit a chapter and confirm only its unapproved AI facts are replaced.
- [ ] "Flesh out with AI" on a character with few facts: are the invented facts specific and consistent with the story, does "Stay close to the story" keep to the chapters, and does the focus box steer it?
- [ ] Retcons (Story Bible › Retcons): on a real branch, use Retcon… on a character's fact (eye colour, say) from where it was set, and "Retcon from here…" in words on a chapter. Check that the proposed passages are the right ones (imagery and other characters' remarks too), that the wording keeps your style, that a chapter where the detail changes in the story is left alone, and that Accept, Reword, Skip and Undo do what they say. Note what a small local model misses.
- [ ] Codex icons after migration 53 (back up the database first): open the Story Bible's Codex and check that entries that had pictures show the right round icon; on one entry, tap the icon and pick a picture under "Made lately" (needs ComfyUI). If the story style picture was a codex picture, pick a new one.
- [ ] Generate on the writing page with a thinking model (e.g. Qwen3 or DeepSeek-R1 on Ollama, and through OpenRouter): the step line under Generate should go "Waiting for the model…" → "The model is thinking…" → "Writing the chapter…", the thinking should fill the fold, and none of it should end up in the chapter text. Once words come, the line should show words/min and the time left; check the estimate is roughly right. Then a Write ahead run and a summary (Story › Outline) with the same model: the step line and the thinking fold should show there too, and the line under the header should follow along from any page.
**On the Windows machine**
- [ ] Run `npm run test:e2e` with Edge (`AGENTS.md`); if any file fails only there, note which and why in `AGENTS.md`.

## To build

Roughly in order of usefulness. Nothing here is agreed to start without asking where it goes in the UI.

**The writing desk** (agreed with the owner 2026-11-12; build in this order, one step per commit or small group of commits, each shipped on its own)

One page that replaces the Edit and Write pages (`/c/<id>/edit`, `/c/<id>/write`, `/s/<id>/write`). Three columns on a wide screen: a side column with two modes (Codex, Illustrate), one open codex entry, and the story. The clickable mockup is https://claude.ai/artifact/ApWcMnAKzGz8sWNry9wwok (the owner's; read it with the Artifact tool). The owner's decisions are written into the steps below; where a step and the mockup differ, the step wins. Other pages stay as they are: the entry's own page, the Story Bible's Codex section, Write ahead, History.

- [x] 1. Remove Revise from the writing page: the instruction box, Undo, revising a selected passage, its prompt and its tests. The owner's loop is prompt, Generate, adjust the prompt, Generate again.
- [x] 2. Codex pictures become one icon per entry, and notes go. Each entry keeps one picture, picked from the story's generated pictures or uploaded, shown in the codex list and on the entry, never sent as a reference. Remove the entry's Pictures tab and page, picture history, shared codex pictures, a codex picture as a reference in Illustrate, and the notes box with "Turn notes into facts". **Destructive:** this deletes the other stored codex pictures and every entry's notes. Ask the owner before running it and say to back up the database first; each entry's current picture becomes its icon. It replaces "Upload a picture for a codex entry; codex thumbnails in the writing page's codex drawer" under Reference pictures and the notes items under the hand checks.
- [x] 3. The desk shell, next to the old pages (a "Desk" button beside Edit until step 9).
  - Side column, Codex mode: search box, "+" for a new entry, an "In this chapter" group (entries whose names or keywords are in the draft; it replaces "Codex for this prompt"), then Characters / Places / Things, each folding. A count badge on entries with suggestions waiting. The column folds to a rail.
  - Entry column: the round icon and name, "as of" the chapter being edited, a ⋯ menu (Edit details, Compare with a chapter…, Share to other stories…, Open on its own page, Remove from this chapter only, Retire) and a close button. Tabs under the name, in this order: **Facts** (default; "+ Add a fact" with the category picker and "Tidy this entry…" at the top, their panels opening right under the buttons), **Preview** (the text the AI is sent), **Suggestions** (with a count; opens first when any are waiting), **History**.
  - Suggestions tab: "Waiting for you" lists every suggestion for the entry (from the codex check or asked for here) with its source (a quote and chapter, or "the AI's own idea"), a "New category" label where it applies, "Takes effect from" (changeable), and Keep / Edit / Dismiss. Below it, "Ask the AI for more": one choice of three (Read this chapter; Read the story so far, which dates each fact to the chapter that shows it, as "Update from the story" does now; Invent new details, kept from where the entry first appears or from this chapter), an optional focus, and "Suggest facts". New suggestions join the list; the form stays.
  - Codex edits made on a posted chapter are saved at once, anchored at that chapter. On a chapter that isn't posted yet they are held in the draft and saved by Post.
  - [x] Left from step 3, built with step 5: a new chapter on the desk, with its codex edits held in the draft and saved by Post.
  - [ ] Still open: the prompt's manual include/exclude of codex entries ("Codex for this prompt" on the old writing page) has no control on the desk; ask the owner where it goes, or whether "In this chapter" is enough.
- [x] 4. The chapter's box. Top to bottom: title; "Prompt and drafts (n)", one line that folds and unfolds (folded when opening a posted chapter, unfolded on a new one); inside it the prompt box at full width, then a line with length, the writing model and Generate, then the drafts row; the text; "Summary" (folding); and at the bottom the one button.
  - Drafts: numbered buttons; each Generate adds one. Each draft keeps the prompt that made it (a new field on the draft version), and an older draft shows its prompt with "Use this prompt". The draft the chapter reads as is marked ✓.
  - Saving: typing, hand edits and Generate save into the draft being worked on, as now. Moving to another chapter never changes a chapter. **Post chapter** (new chapter; off until there is text) creates it and stays on it. **Update chapter** (posted chapter; on when the draft showing differs from the chapter) replaces the chapter's text with that draft and keeps the old text in History. There is no button in the top bar.
  - After Post or Update, the summary is rewritten and the codex check runs, both in the background (the check follows the existing "apply automatically" setting). A summary the owner edited is left alone and marked "yours · not rewritten", with "Let the AI rewrite it" to hand it back.
  - Work left behind is marked "Draft not used" on the chapter's block in the path and on its choice in the parent's list; an unposted chapter shows "draft" on its choice.
  - Dropped: "What did you change?". "This is my writing now" becomes "Remove the AI mark" in the top bar's ⋯ menu, which also holds the summary model, History, Write ahead…, Open the reading page, Replace branch… and Move to trash… (on a new chapter: the summary model and Discard draft…).
- [x] 5. The path and the choices. Above the box, each earlier chapter is a block that folds: unfolded it shows the title and text only, with ✎ at its top right to make it the chapter being edited (fold states are kept), and "Unfold all". Opening the desk from outside starts with them unfolded and scrolled to the chapter. The choice that leads to a chapter is the "→ …" line above its box; click it to rename. Below the box, "What happens next?" is the reading page's vertical list (a row per choice, "Add a new suggestion", "Suggest choices"), shown once the chapter is posted; a written choice opens that chapter, an unwritten one starts its draft.
- [x] 6. Illustrate mode in the side column, for a posted chapter (greyed out otherwise). The side column holds what the Illustrate page has now: moment, what to show, the model and "Write prompt" right-aligned above the Prompt box, always include, negative prompt, size, scale, pictures per click, Queue, drawing preset, seed, Instruct. The Header, Middle and Footer pictures take the main area, with the chapter text folded below them.
- [ ] 7. Tie the text to the codex: list the names found under the text and open their entry on click (underlining inside the text box comes later, it needs more than a textarea); select text, then "Add as a fact…" with the selection as the quote.
- [ ] 8. Phone layout: the box first (prompt, length, model, Generate, drafts, text, Post / Update), and a bottom bar opening the path, the codex (a sheet for looking things up; full entry editing is for wide screens), Illustrate and the choices.
- [ ] 9. Switch over: Edit and Write open the desk, the old pages and the codex drawer go, the browser tests and the guides are updated. It closes "'Remove from this chapter only' is not offered in the writing page's codex drawer" under Codex.
- [ ] Later: Ctrl+K to find an entry, Ctrl+Enter to Generate, Alt+↑/↓ along the path.

**Tidying the app**
- [ ] Maybe: bring back "download this path" (Markdown or HTML of the route to a chapter) in the chapter's ⋯ menu. It was dropped when the downloads moved to Details › Export; "Read this path" still shows the route on one page.

**Story Bible: left out of the codex and summaries rebuild**

Each was dropped on purpose to keep the new sections simple; bring one back only if it's missed.
- [ ] Undo a dismissed "Not in the codex yet" name, and the "Later" choice for those names.
- [ ] The timeline of the next chapters that the old chapter codex page showed (the chapter picker replaces it).
- [ ] "Show the AI exchange" for a codex suggestion (Prompt history still has every exchange).
- [ ] A codex check for "every chapter on this branch"; the ⋯ menu offers this chapter or the whole story.
- [ ] The summary check's "the way here / from here on" scopes; the Summaries section checks a chapter or the whole story.
- [ ] "Fix the N summaries" doesn't redo the chapters after a fixed one, so their "story so far" can lag until they are redone.

**Illustrate and pictures**
- [ ] Forget lost pictures: rejecting hides a picture ComfyUI has lost, but removing the record (`DELETE /api/picture-jobs/:id`) and pruning old rows aren't built.
- [ ] Batching quick Queue clicks per model: today one global Drawing setting (`comfy.batchClicks`); make it per drawing preset or model family (`src/lib/comfy/drawModels.ts`), because some models batch and some don't (Krea 2 doesn't).
- [ ] Settings are saved on every tick while sliding Strength (all settings, including the workflow text). Debounce it if it is noticeable on the NAS.
- [ ] A Scale menu (1×, 1.5×) that resizes the starting picture before re-drawing it.
- [ ] Import from ComfyUI's history (`GET /history?max_items=200`, `listHistory` in `client.ts`) for pictures made before the log existed or in ComfyUI itself: take entries tagged `storytime` or with files starting `StoryTime`; read the prompt back from the stored workflow (`prompt[2]`) with the node-finding in `workflow.ts`.
- [ ] Pictures from other stories, as one more view beside Other chapters.
- [ ] Maybe: the full-size viewer for Other chapters' pictures and the saved header and footer (they open in a new tab now), and pin / reject for pictures in Other chapters.

**Reference pictures and characters**
- [ ] Instruct prompts written by the AI should say which reference is which ("image 2 is Jim").
- [ ] Use as story style picture in a picture's ☰ menu; include the style picture in the JSON export.
- [ ] A per-character "look" as a fixed tag string taken from the codex; a LoRA per story as a workflow setting.
- [ ] Later: a region per character for two-character scenes (IP-Adapter `attn_mask`), the face adapter, Flux Redux for the Flux family.

**Inpainting**
- [ ] Masks with the edit models (Qwen-Image-Edit, Kontext): needs a decision on where "edit by instruction, only here" lives in Refine. Technically small: add `mask?` to `EditParams`, call `redrawOnlyMask(wf, mask, "11", "13", …)` in `buildEdit`, and allow masks on edits in `maskOf`, `sameJob` and `pictureJobs.ts` (which rejects them today).
- [ ] Flux Fill and inpaint-trained checkpoints (phase F), and outpainting. Only worth it if Flux redraws still show seams.

**Codex**

Background: an entry's AI text is built from its facts (one per aspect, such as "Ears: tall fox ears", dated to the chapter where it became true); the entry's notes are the owner's own and are not sent to the AI. A character can have forms (human, vixen…); only facts for every form or the current form are sent. The codex lives in the Story Bible's Codex section (`/s/<story>/review?tab=codex`, narrowed to a chapter with `&chapter=`); `/c/<chapter>/codex` redirects there. The codex check (review run task "codex", `src/lib/ai/codexCheckAi.ts`) reads a posted chapter and leaves suggestions: the chapter's Codex section only counts them ("To review"), and they are reviewed on the entry's page at the chapter they were made at. Each entry has one page, `/s/<story>/codex/<entry>?at=<chapter>`.
- [ ] Shared codex, known gaps: "Share this entry" turns each of the entry's earlier ops into a full set of changes against the shared entry, so a keyword added retroactively at an earlier chapter, which the old fold carried down to later chapters, is not carried down for a shared entry. A kept `codex:` picture reference to a shared picture is fetched through the story that made it, so it breaks if that story stops linking the entry. Shared pictures have no history list (only the current one shows).
- [ ] Tune the codex check prompt (`systemCodexCheck` in `codexCheckAi.ts`). It has only been tried against the fake AI. Needs the owner's examples: the story exported as JSON, the cheaper model's name, and which suggestions were missing or wrong for 2–3 transformation chapters. Prompt history helps here.
- [ ] Close-up details: an "always / close-up" switch on each fact, and a "close-up scene" toggle on the drafting page. Close-up facts (detailed anatomy, the fine points of a transformation) go to the AI only for scenes marked close-up, so everyday prompts stay short. Needs a column on `codex_facts`, the switch in `CodexFacts.tsx`, the toggle in the draft, and `describeEntry` taking whether the scene is close-up.
- [ ] "Draft with AI" for a new entry. `draftEntry` / `entryRequest` in `src/lib/ai/codexAi.ts` are unused since the old notes-writing buttons went.
- [ ] Undo after Accept on a codex suggestion. Today a mistaken accept is fixed by changing or removing the fact on the entry page. Needs the accept to record the ops it made so they can be removed.
- [ ] "Remove from this chapter only" is not offered in the writing page's codex drawer, because the chapter being written isn't saved yet and would lose the entry too. It could be held in the draft like other changes (a retire at the chapter plus a revive at each child, made on save).
- [ ] Quality hints, the rest (`src/lib/codexHints.ts`): near-duplicate aspects ("Ears" and "Ear shape"); facts for a form the character never takes on any branch.
- [ ] "Tidy this entry" (`src/lib/ai/tidyAi.ts`) works on the facts live at the chapter: an earlier version of a fact (before it last changed) keeps its old aspect name. A "rename everywhere" for an aspect, across every version and entry, would finish the job.
- [ ] "Ask the codex": a question box ("Where is Oda now?", "Has Mara met the queen?") answered by the AI from the chapters on this branch, quoting them, with an "Update the entry" button that turns the answer into suggestions.
- [ ] Admin tool: deleting a chapter (`scripts/adminCore.mjs`) doesn't remove its `chapter_facts`, `chapter_fact_checks`, `summary_checks`, continuity verdicts or codex pictures, so the delete may fail on foreign keys. Codex facts and suggestions are already handled.

**Story review and tags**
- [ ] A short label field on tags (a tag has only a name).
- [ ] Name variants in the codex-gap check ("Jon" and "John"); only exact names and aliases match now.
- [ ] Optional check: tense, point of view or tone drifting from the story's style.
- [ ] Which tags count as changes in the continuity check is fixed in code (`CHANGE_EVENT_TAGS`: tf, tg); make it a setting if wanted.
- [ ] State tags (a stretch like `species: wolf` from one chapter to another, folded along a path). Not wanted for now.
- [ ] A nightly review run for chapters changed that day. Only if asked.

**The trash**
- [ ] Emptying the trash: trashed branches are kept for good; deleting them for real (admin script or a button) isn't built.

**Server and code**
- [ ] Route the remaining one-off AI calls (codex scan, tag suggestions, summaries, Write prompt, Refine's prompt) through a server `POST /api/ai/chat` stream, so the browser never calls providers and no CORS setup is needed.
- [ ] A `/api/comfy/view` proxy so the Refine canvas can load ComfyUI pictures without CORS.
- [ ] `src/lib/aiRuns/api.ts` goes through a self fetch to the server's own API; it could use SQLite directly.
- [ ] Fix the one known lint error, in `src/components/OutlineSummaries.tsx` (set-state-in-effect).
