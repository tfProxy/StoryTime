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
- [ ] Codex: fold and unfold Characters / Places / Things; Accept, Edit and Dismiss a suggestion on an entry's card; "New entry from here"; "New entry from the shared codex…".
- [ ] A codex entry's page: the ⋯ menu (Edit, Pictures, History, Share, Remove from this chapter only, Retire), the folding sections, and a fact's Edit / Remove / History.
- [ ] Summaries: "Fix the N summaries", then a chapter's Save ▾ menu.
- [ ] The writing page: the model pickers at the top, and the Finish section opening once the chapter has text.
- [ ] The Refine screen.

**On a real ComfyUI**
- [ ] Earlier pictures: make some, pin one, reload (only it shows), use one from All, restart ComfyUI, check they still load from `/view`.
- [ ] Start from a picture with the built-in workflow, then with your own exported workflow (with and without `{{image}}`). Check the upload works through your CORS setup and that a 1344 × 768 start picture fits in memory. A workflow with `KSamplerAdvanced` has no `denoise`, so StoryTime says it can't start from a picture; see whether that matters.
- [ ] Reference pictures (IP-Adapter): install `ComfyUI_IPAdapter_plus` and the model files (`docs/pictures.md`). For an Illustrious or NoobAI checkpoint and a furry merge, try a character as a reference for a new scene, a header as the reference for its footer, a style reference, a codex picture, and the story style picture. Note the strengths that work and what each reference adds to the time, then change the defaults. Confirm NoobAI's own adapter beats the SDXL one on Illustrious and furry merges.
- [ ] Refine inpainting: paint a small area (a hand or a face) on a real picture and Go at strength 0.6; compare with before the change (seam, detail, time). Also try a mask near the picture's edge, a picture whose size isn't a multiple of 16, and each **Under the paint** choice. The redraw now runs only the steps its strength needs, so compare two or three pictures for look.

**With your own AI models**
- [ ] Story review: Find tags, Help me write it, Check continuity, and the summary check. Prompt quality with a small local model is unknown.
- [ ] The codex check with the cheaper model: post (or "Check this chapter with AI" on) 2–3 chapters where a body or form changes, and note what the suggestions miss or get wrong. This feeds "Tune the codex check prompt" below.
- [ ] "Flesh out with AI" on a character with few facts: are the invented facts specific and consistent with the story, does "Stay close to the story" keep to the chapters, and does the focus box steer it?
- [ ] Turn notes into facts on the existing entries that have notes only (they give the AI nothing until they have facts).

**On the Windows machine**
- [ ] Run `npm run test:e2e` with Edge (`AGENTS.md`); if any file fails only there, note which and why in `AGENTS.md`.

## To build

Roughly in order of usefulness. Nothing here is agreed to start without asking where it goes in the UI.

**Tidying the app**
- [ ] Fewer Settings tabs: fold "Qwen edit" and "Flux edit" into Drawing, and Outline and Queue into one general tab.
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
- [ ] Upload a picture for a codex entry; codex thumbnails in the writing page's codex drawer.
- [ ] A per-character "look" as a fixed tag string taken from the codex; a LoRA per story as a workflow setting.
- [ ] Later: a region per character for two-character scenes (IP-Adapter `attn_mask`), the face adapter, Flux Redux for the Flux family.

**Inpainting**
- [ ] Masks with the edit models (Qwen-Image-Edit, Kontext): needs a decision on where "edit by instruction, only here" lives in Refine. Technically small: add `mask?` to `EditParams`, call `redrawOnlyMask(wf, mask, "11", "13", …)` in `buildEdit`, and allow masks on edits in `maskOf`, `sameJob` and `pictureJobs.ts` (which rejects them today).
- [ ] Flux Fill and inpaint-trained checkpoints (phase F), and outpainting. Only worth it if Flux redraws still show seams.

**Codex**

Background: an entry's AI text is built from its facts (one per aspect, such as "Ears: tall fox ears", dated to the chapter where it became true); the entry's notes are the owner's own and are not sent to the AI. A character can have forms (human, vixen…); only facts for every form or the current form are sent. The codex lives in the Story Bible's Codex section (`/s/<story>/review?tab=codex`, narrowed to a chapter with `&chapter=`); `/c/<chapter>/codex` redirects there. The codex check (review run task "codex", `src/lib/ai/codexCheckAi.ts`) reads a posted chapter and leaves suggestions, shown on the cards of the entries they are about. Each entry has one page, `/s/<story>/codex/<entry>?at=<chapter>`.
- [ ] Shared codex, known gaps: "Share this entry" turns each of the entry's earlier ops into a full set of changes against the shared entry, so a keyword added retroactively at an earlier chapter, which the old fold carried down to later chapters, is not carried down for a shared entry. A kept `codex:` picture reference to a shared picture is fetched through the story that made it, so it breaks if that story stops linking the entry. Shared pictures have no history list (only the current one shows).
- [ ] Tune the codex check prompt (`SYSTEM_CODEX_CHECK` in `codexCheckAi.ts`). It has only been tried against the fake AI. Needs the owner's examples: the story exported as JSON, the cheaper model's name, and which suggestions were missing or wrong for 2–3 transformation chapters. Prompt history helps here.
- [ ] Close-up details: an "always / close-up" switch on each fact, and a "close-up scene" toggle on the drafting page. Close-up facts (detailed anatomy, the fine points of a transformation) go to the AI only for scenes marked close-up, so everyday prompts stay short. Needs a column on `codex_facts`, the switch in `CodexFacts.tsx`, the toggle in the draft, and `describeEntry` taking whether the scene is close-up.
- [ ] AI help for one entry on its page: "Update from the story" (the AI re-reads the chapters since the entry last changed and leaves suggestions on the entry, like the codex check but for one entry) and "Draft with AI" for a new entry. `draftEntry` / `entryRequest` in `src/lib/ai/codexAi.ts` are unused since the old notes-writing buttons went.
- [ ] Undo after Accept on a codex suggestion. Today a mistaken accept is fixed by changing or removing the fact on the entry page. Needs the accept to record the ops it made so they can be removed.
- [ ] "Remove from this chapter only" is not offered in the writing page's codex drawer, because the chapter being written isn't saved yet and would lose the entry too. It could be held in the draft like other changes (a retire at the chapter plus a revive at each child, made on save).
- [ ] Staleness badge: "mentioned in 6 chapters since last updated" on an entry's card, and a sort that puts the most out-of-date first. Count chapters on the branch after the entry's last change whose text mentions its name or a keyword.
- [ ] Compare the codex between two chapters: pick two chapters and see, per entry, what changed between them. On one branch (earlier vs later) it reads as a transformation summary (Sex: male → female, Ears: human → fox ears, Form: human → vixen, new keywords, entries that appeared or left); across two branches it shows how a character differs by the path taken. "Compare with: [chapter]" on the entry page, and a whole-codex view in the Story Bible. The data is there (the codex can be folded at any chapter); it is a page to build.
- [ ] Quality hints, the rest: the entry page shows them (`src/lib/codexHints.ts`, above the Facts). Still to do: a ⚠ count on the entry's card in the Story Bible (the cards there are whole-story summaries without facts); fix buttons (Turn notes into facts, keep one of two duplicate aspects); near-duplicate aspects ("Ears" and "Ear shape"); facts for a form the character never takes on any branch; too many always-included entries (a story-wide hint for the Codex section).
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
