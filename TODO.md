# TODO

Planned work that hasn't been started. Each item says what it is for, how it could be built, and what is still undecided.

## Illustrate chapter page

These build on the page at `src/app/c/[id]/illustrate/page.tsx`, with `ImagePromptPanel` and `ComfyGenerate` in `src/components/`, and the ComfyUI code in `src/lib/comfy/`. All ComfyUI calls are made from the browser, never from the StoryTime server.

### 1. Record how each picture was made (do this first)

Items 2, 3 and 4 all need to know, for a picture, what prompt and settings made it and which chapter it was made for. ComfyUI's own history can't be relied on: it is kept in memory and lost when ComfyUI restarts. Its output files survive a restart, but the API has no way to list them.

- **A job log in StoryTime.**
  - New migration: a `picture_jobs` table with the columns `id`, `chapter_id`, `story_id`, `prompt_id`, `prompt`, `negative`, `checkpoint`, `width`, `height`, `seed`, `count`, `moment`, `source` (null, or which picture an img2img job started from), `denoise`, `created_at`, and `images` (a JSON list of ComfyUI `{filename, subfolder, type}`).
  - `ComfyGenerate` writes a row once a job finishes, through a new `POST /api/picture-jobs`. Readers: `GET /api/picture-jobs?story=…`, newest first, paged, and later `GET /api/picture-jobs?chapter=…`.
  - The pictures themselves stay in ComfyUI. The log only stores where they are, and the page shows them through ComfyUI's `/view`. If a file has been deleted on the ComfyUI machine, its tile says so instead of showing a broken image.
- **Tag the job in ComfyUI as well**, so jobs can be matched up while ComfyUI's history still has them:
  - Send `extra_data: { storytime: { chapterId, storyId } }` with `POST /prompt`. ComfyUI keeps it in the history entry.
  - Set `filename_prefix` on every `SaveImage` node to something like `StoryTime/<story id>/<chapter id>`. In `fillWorkflow`, overwrite only the built-in `StoryTime` prefix or a `{{prefix}}` placeholder, so a custom workflow's own prefix is left alone.
- **Remember how the saved header and footer pictures were made.**
  - Same migration: add `job_id`, `prompt` and `negative` columns to `chapter_images`. They are null for uploads.
  - `ComfyGenerate.use()` sends them along with the picture. The `PUT` route takes them as query parameters, or a small JSON part, since the body is the image.
  - Add them to the JSON export and import (`src/lib/export.ts`, `src/lib/import.ts`), and to `scripts/adminCore.mjs` `deleteItem`.
- Tests: an API test for the job log routes, a migration check, and an export/import round trip that includes the new columns. Extend `illustrate-comfy.e2e.mjs` so it checks that a row is written and that `extra_data` and the filename prefix reach the fake ComfyUI.
- Undecided: should old log rows be pruned (by age, or by a count per story)? Rows are small, so probably not at first.

### 2. Past pictures, including other chapters'

What it's for: a picture made for one chapter can turn out to suit another, such as the one before.

- A **"Past pictures"** section on the Illustrate page, under the new candidates. It is read from the job log (item 1) for the whole story, newest first.
  - Group the pictures by the chapter they were made for, with the chapter's title, and add a filter for "this chapter" or "this story".
  - Load more as you scroll, or with a "Show more" button.
- Each tile reuses the candidate card: "Use as header picture", "Use as footer picture", "Open full size", plus "Load prompt" (item 3) and "Start from this" (item 4). Using a picture saves it to the chapter whose page is open, whichever chapter it was made for.
- Turn the candidate tile in `ComfyGenerate.tsx` into its own component, so new and past pictures share it.
- Optional extra: import from ComfyUI's history (`GET /history?max_items=200`), for pictures made before the log existed or made in ComfyUI itself. Take only entries tagged `storytime` or whose files start with `StoryTime`. The prompt text can be read back from the workflow stored in the entry (`prompt[2]`), using the same node-finding logic as `promptNodes`.
- Undecided: pictures from other stories would be one more filter. Leave them out unless asked.

### 3. See the chapter while illustrating

What it's for: checking that a picture matches the chapter without leaving the page.

- The page already loads the chapter's text and summaries (the `path` prop: `body`, `summary`, `path_summary`), so no new data is needed.
- A **"Chapter"** panel near the top of the page:
  - It shows the chapter's summary, falling back to "No summary yet" with a link to the chapter.
  - Below the summary, a "Show the whole chapter" `<details>` with the full text, styled like the reading page. Remember whether it was open (`localStorage`, wrapped in try/catch).
  - Optionally, a "Story so far" `<details>` with the previous chapter's `path_summary`, the same text the prompt is written from.
- On wide screens, the panel could sit in a sticky column beside the prompt, so the text stays in view while scrolling to the pictures. On a phone it stays a collapsed block above the prompt.
- Undecided (ask before building): a collapsible block above the prompt, or a side column on desktop.
- Tests: an e2e check that the summary is shown, that the full text opens and contains the chapter body, and that nothing overflows at 390px.

### 4. Bring back the prompt a picture was made with

What it's for: going back to a chosen picture's prompt, changing it and making more.

- Needs item 1, which stores the prompt with each saved picture and each logged job.
- Under the Header picture and Footer picture cards, show "Made from: …" with the prompt cut short, and a **"Load prompt"** button. Past-picture tiles (item 2) get the same button.
- "Load prompt" fills in the Prompt and Negative prompt fields, and also the checkpoint, size and seed if wanted. The seed is the useful one: the same seed with a slightly changed prompt gives a close variation.
- Wiring: the prompt fields live in `ImagePromptPanel`, while the image editors are separate components on the server-rendered page. Choose one:
  - (a) Move the prompt state into a small client wrapper that holds the panel and the editors.
  - (b) Use a tiny context, or a custom DOM event (`storytime:load-prompt`).
  
  (a) is cleaner.
- Add an optional "Reuse seed" checkbox next to "Make more". It uses the loaded seed instead of a random one, and `fillWorkflow` already accepts a seed.
- Tests: an e2e test that makes a picture, uses it, reloads the page, clicks Load prompt, and checks the fields.

### 5. Image to image, with a strength control

What it's for: making variations of a picture you already have, with a slider for how far they may drift.

- Starting picture: any candidate, past picture, or the chapter's saved header or footer picture ("Start from this" on each tile or card). The chosen one shows as a small thumbnail with a "Clear" button. With nothing chosen, the page makes pictures from the prompt alone as it does now.
- Getting the picture to ComfyUI: `POST /upload/image`, multipart, with fields `image` and `type=input`. The reply gives the name to put in a `LoadImage` node.
  - A picture already in ComfyUI's output folder could be referred to as `"name.png [output]"` without uploading. Check that the installed ComfyUI version accepts that before relying on it.
  - The saved header or footer is fetched from StoryTime's `/api/chapters/:id/images/:slot` and then uploaded.
- Workflow, in `src/lib/comfy/workflow.ts`:
  - Add a built-in img2img variant: `LoadImage` → `VAEEncode` (with the checkpoint's VAE) → `KSampler.latent_image`, with `denoise` set to the strength. For more than one picture, add `RepeatLatentBatch` with `amount = count`.
  - For custom workflows, add `{{image}}` and `{{denoise}}` placeholders. With no placeholders, detect the `EmptyLatentImage` and rewire it automatically, as `fillWorkflow` does for the prompt.
  - Extend `describeWorkflow` so Settings says whether a workflow can do img2img.
- Controls:
  - A **Strength** slider from 0.05 to 1.0, saved in `settings.comfy.denoise` (schema default about 0.55, with `.catch`).
  - Help text: "Low keeps the picture close; high changes more."
  - The Size menu is disabled while a starting picture is chosen, because the size comes from the picture. Optionally, offer a scale (1×, 1.5×) for upscaling passes.
- The job log (item 1) records `source` and `denoise`, so a variation's history can be followed.
- Tests:
  - Unit tests for the img2img workflow building, both built-in and placeholder.
  - Extend `fakeComfy.mjs` with `/upload/image`.
  - An e2e test that starts from a candidate and checks that the queued workflow has a `LoadImage` with the uploaded name and the chosen denoise.
- Undecided: inpainting (masking part of the picture) would be a separate later step, and isn't covered here.

### Order

Item 1 comes first, because items 2, 4 and 5 depend on it. After that, 3 and 4 (small), then 2, then 5. Item 3 doesn't depend on any other and can be done at any time.

## Also planned (from the pictures plan)

- **Cover picture:** a version of the Illustrate page for the story's cover. The prompt is harder because the story branches, so it might be written from the premise, the codex and the first chapter, or from a chosen path.
- **Consistent characters:**
  - A per-character "look" (a fixed tag string, or a reference picture for IP-Adapter) taken from the codex, so the same person looks the same in every chapter.
  - A LoRA per story could be a workflow setting.
